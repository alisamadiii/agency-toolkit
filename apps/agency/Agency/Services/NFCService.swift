@preconcurrency import CoreNFC
import Foundation

/// What we learned from one tap.
nonisolated struct TagReadResult: Sendable, Equatable {
  /// Chip UID, hex, uppercase.
  let uid: String
  /// URL stored in the first NDEF URI record, if any.
  let url: URL?
  /// Text stored in the first NDEF Text record, if any.
  let text: String?
  /// Whether the tag is NDEF and writable.
  let isWritable: Bool
  /// Writable bytes on the chip.
  let capacity: Int
}

nonisolated enum NFCError: LocalizedError {
  case unavailable
  case cancelled
  case unsupportedTag
  case notNDEF
  case readOnly
  case tooLarge(needed: Int, capacity: Int)
  case verifyMismatch
  case system(String)

  var errorDescription: String? {
    switch self {
    case .unavailable: "This device can't read NFC tags."
    case .cancelled: "Cancelled."
    case .unsupportedTag: "That card isn't a supported NFC tag."
    case .notNDEF: "That card isn't NDEF formatted."
    case .readOnly: "That card is locked (read-only) and can't be written."
    case .tooLarge(let needed, let capacity): "Content needs \(needed) bytes; card holds \(capacity)."
    case .verifyMismatch: "Written, but reading it back gave something different."
    case .system(let message): message
    }
  }
}

/// What gets written to a card: one NDEF record.
nonisolated enum NFCContent: Sendable, Equatable {
  case url(URL)
  case text(String)
}

/// One tag session per call. Writes a single URI or Text record; never locks the tag.
@Observable
final class NFCService {
  var isAvailable: Bool { NFCTagReaderSession.readingAvailable }

  /// Keep a strong reference while a session runs; Core NFC only holds the delegate weakly.
  private var driver: TagSessionDriver?

  func read(prompt: String = "Hold the card to the top of your iPhone to check it.") async throws -> TagReadResult {
    try await run(.read, prompt: prompt)
  }

  func write(_ url: URL) async throws -> TagReadResult {
    try await write(.url(url), prompt: "Hold the card to the top of your iPhone to write the review link.")
  }

  func write(_ content: NFCContent, prompt: String) async throws -> TagReadResult {
    try await run(.write(content), prompt: prompt)
  }

  private func run(_ operation: TagOperation, prompt: String) async throws -> TagReadResult {
    guard isAvailable else { throw NFCError.unavailable }
    let result: TagReadResult = try await withCheckedThrowingContinuation { continuation in
      let driver = TagSessionDriver(operation: operation) { result in
        continuation.resume(with: result)
      }
      self.driver = driver
      driver.begin(prompt: prompt)
    }
    driver = nil
    return result
  }
}

nonisolated enum TagOperation: Sendable {
  case read
  case write(NFCContent)
}

/// Runs on Core NFC's own queue. Finishes exactly once.
private nonisolated final class TagSessionDriver: NSObject, NFCTagReaderSessionDelegate, @unchecked Sendable {
  private let operation: TagOperation
  private let completion: @Sendable (Result<TagReadResult, NFCError>) -> Void
  private let lock = NSLock()
  private var finished = false
  private var session: NFCTagReaderSession?
  /// The tag we connected to; kept here so Core NFC's @Sendable callbacks don't capture it.
  private var tag: NFCNDEFTag?

  init(operation: TagOperation, completion: @escaping @Sendable (Result<TagReadResult, NFCError>) -> Void) {
    self.operation = operation
    self.completion = completion
  }

  func begin(prompt: String) {
    guard let session = NFCTagReaderSession(pollingOption: [.iso14443, .iso15693], delegate: self, queue: nil) else {
      finish(.failure(.unavailable))
      return
    }
    session.alertMessage = prompt
    self.session = session
    session.begin()
  }

  // MARK: NFCTagReaderSessionDelegate

  func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

  func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
    let code = (error as? NFCReaderError)?.code
    if code == .readerSessionInvalidationErrorUserCanceled {
      finish(.failure(.cancelled))
    } else {
      finish(.failure(.system(error.localizedDescription)))
    }
  }

  func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
    guard tags.count == 1, let tag = tags.first else {
      session.alertMessage = "More than one card detected. Hold just one."
      session.restartPolling()
      return
    }

    let identifier: Data
    switch tag {
    case .miFare(let mifare):
      self.tag = mifare
      identifier = mifare.identifier
    case .iso15693(let iso):
      self.tag = iso
      identifier = iso.identifier
    default:
      fail(.unsupportedTag)
      return
    }
    let uid = identifier.map { String(format: "%02X", $0) }.joined()

    session.connect(to: tag) { [self] error in
      if let error {
        fail(.system(error.localizedDescription))
        return
      }
      guard let tag = self.tag else { return }
      tag.queryNDEFStatus { [self] status, capacity, error in
        if let error {
          fail(.system(error.localizedDescription))
          return
        }
        guard status != .notSupported else {
          fail(.notNDEF)
          return
        }
        switch operation {
        case .read:
          readBack(uid: uid, writable: status == .readWrite, capacity: capacity, expecting: nil)
        case .write(let content):
          guard status == .readWrite else {
            fail(.readOnly)
            return
          }
          let encoded: NFCNDEFPayload? = switch content {
          case .url(let url): NFCNDEFPayload.wellKnownTypeURIPayload(url: url)
          case .text(let text): NFCNDEFPayload.wellKnownTypeTextPayload(string: text, locale: Locale(identifier: "en"))
          }
          guard let payload = encoded else {
            fail(.system("Couldn't encode the content."))
            return
          }
          let message = NFCNDEFMessage(records: [payload])
          let needed = Int(message.length)
          guard needed <= capacity else {
            fail(.tooLarge(needed: needed, capacity: capacity))
            return
          }
          guard let tag = self.tag else { return }
          tag.writeNDEF(message) { [self] error in
            if let error {
              fail(.system(error.localizedDescription))
              return
            }
            readBack(uid: uid, writable: true, capacity: capacity, expecting: content)
          }
        }
      }
    }
  }

  // MARK: Helpers

  /// Reads the tag and finishes. When `expecting` is set, the stored record must match it.
  private func readBack(uid: String, writable: Bool, capacity: Int, expecting: NFCContent?) {
    guard let tag else { return }
    tag.readNDEF { [self] message, error in
      var url: URL?
      var text: String?
      if let error {
        // Blank tags report a zero-length message; everything else is a real failure.
        let code = (error as? NFCReaderError)?.code
        guard code == .ndefReaderSessionErrorZeroLengthMessage else {
          fail(.system(error.localizedDescription))
          return
        }
      } else {
        let records = message?.records ?? []
        url = records.lazy.compactMap { $0.wellKnownTypeURIPayload() }.first
        text = records.lazy.compactMap { $0.wellKnownTypeTextPayload().0 }.first
      }
      let matches = switch expecting {
      case nil: true
      case .url(let expected): url == expected
      case .text(let expected): text == expected
      }
      guard matches else {
        fail(.verifyMismatch)
        return
      }
      session?.alertMessage = expecting == nil ? "Card read." : "Written to the card."
      session?.invalidate()
      finish(.success(TagReadResult(uid: uid, url: url, text: text, isWritable: writable, capacity: capacity)))
    }
  }

  private func fail(_ error: NFCError) {
    session?.invalidate(errorMessage: error.localizedDescription)
    finish(.failure(error))
  }

  private func finish(_ result: Result<TagReadResult, NFCError>) {
    lock.lock()
    let first = !finished
    finished = true
    lock.unlock()
    guard first else { return }
    completion(result)
  }
}
