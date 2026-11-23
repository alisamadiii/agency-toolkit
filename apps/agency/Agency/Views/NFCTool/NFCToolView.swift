import SwiftUI
import UIKit

/// Result of the last tap on the NFC tool screen.
private enum ToolOutcome: Equatable {
  case read(TagReadResult)
  case written(TagReadResult)
  case failed(String)

  var tag: TagReadResult? {
    switch self {
    case .read(let tag), .written(let tag): tag
    case .failed: nil
    }
  }

  var isGood: Bool { tag != nil }

  var title: String {
    switch self {
    case .written: "Written to card"
    case .read(let tag) where tag.url == nil && tag.text == nil: "Card is empty"
    case .read: "Card read"
    case .failed(let message): message
    }
  }
}

/// Standalone NFC tool: verify (read) any card, or write a URL or text to it.
/// Not tied to a lead; nothing is saved.
struct NFCToolView: View {
  @State private var nfc = NFCService()
  @State private var outcome: ToolOutcome?
  @State private var isBusy = false
  @State private var showWritePrompt = false
  @State private var input = ""
  @State private var pendingWrite: NFCContent?

  var body: some View {
    List {
      Section {
        Button {
          UIImpactFeedbackGenerator(style: .medium).impactOccurred()
          Task { await verify() }
        } label: {
          Label("Verify Card", systemImage: "checkmark.shield")
        }
        Button {
          showWritePrompt = true
        } label: {
          Label("Write to Card", systemImage: "square.and.pencil")
        }
      } footer: {
        if !nfc.isAvailable {
          Text("NFC isn't available on this device. Use a real iPhone.")
        } else {
          Text("Verify reads a card and shows what's on it. Write asks for a URL, text or a business's Google review link, then puts it on the card. Cards are never locked.")
        }
      }
      .disabled(!nfc.isAvailable || isBusy)

      if let outcome {
        resultSection(outcome)
      }
    }
    .navigationTitle("NFC Cards")
    .animation(.spring, value: outcome)
    // The NFC system sheet starts only after this sheet is gone.
    .sheet(isPresented: $showWritePrompt, onDismiss: startPendingWrite) {
      WriteContentSheet(input: $input) { pendingWrite = $0 }
    }
  }

  private func resultSection(_ outcome: ToolOutcome) -> some View {
    Section {
      Label {
        Text(outcome.title)
      } icon: {
        Image(systemName: outcome.isGood ? "checkmark.circle.fill" : "xmark.circle.fill")
          .foregroundStyle(outcome.isGood ? .green : .red)
      }
      if let tag = outcome.tag {
        if let url = tag.url {
          LabeledContent("Link") {
            Link(url.absoluteString, destination: url)
              .font(.footnote.monospaced())
              .multilineTextAlignment(.trailing)
          }
        }
        if let text = tag.text {
          LabeledContent("Text") {
            Text(text)
              .font(.footnote.monospaced())
              .textSelection(.enabled)
          }
        }
        LabeledContent("UID") {
          Text(tag.uid)
            .font(.footnote.monospaced())
            .textSelection(.enabled)
        }
        LabeledContent("Writable", value: tag.isWritable ? "Yes" : "No")
        LabeledContent("Capacity", value: "\(tag.capacity) bytes")
      }
    } header: {
      Text("Last Tap")
    }
    .transition(.move(edge: .top).combined(with: .opacity))
  }

  // MARK: - Actions

  private func verify() async {
    await perform { .read(try await nfc.read()) }
  }

  private func startPendingWrite() {
    guard let content = pendingWrite else { return }
    pendingWrite = nil
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    Task { await write(content) }
  }

  private func write(_ content: NFCContent) async {
    await perform {
      .written(try await nfc.write(content, prompt: "Hold the card to the top of your iPhone to write it."))
    }
  }

  private func perform(_ work: () async throws -> ToolOutcome) async {
    guard !isBusy else { return }
    isBusy = true
    defer { isBusy = false }
    do {
      let result = try await work()
      outcome = result
      UINotificationFeedbackGenerator().notificationOccurred(.success)
    } catch NFCError.cancelled {
      // User closed the system sheet. Nothing to say.
    } catch {
      outcome = .failed(error.localizedDescription)
      UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
  }

  /// URLs with a known scheme, or bare domains like `example.com`, become URL records; the rest is text.
  static func content(from raw: String) -> NFCContent? {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return nil }
    if let url = URL(string: value), let scheme = url.scheme?.lowercased(),
       ["http", "https", "tel", "mailto", "sms"].contains(scheme) {
      return .url(url)
    }
    let looksLikeDomain = !value.contains(" ")
      && value.range(of: #"^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(/.*)?$"#, options: .regularExpression) != nil
    if looksLikeDomain, let url = URL(string: "https://\(value)") {
      return .url(url)
    }
    return .text(value)
  }
}

#Preview {
  NavigationStack { NFCToolView() }
}
