import Foundation
import SwiftData
import UIKit

/// Result of the last tap, shown under the actions on the business screen.
enum CardOutcome: Equatable {
  case written(label: String, movedFrom: String?)
  case verified(label: String)
  case belongsToOther(businessName: String)
  case wrongLink(String?)
  case failed(String)

  var isGood: Bool {
    switch self {
    case .written, .verified: true
    default: false
    }
  }

  var symbol: String { isGood ? "checkmark.circle.fill" : "xmark.circle.fill" }

  var title: String {
    switch self {
    case .written(let label, nil): "\(label) written"
    case .written(let label, .some(let from)): "\(label) written (moved from \(from))"
    case .verified(let label): "\(label) is correct"
    case .belongsToOther(let name): "This card belongs to \(name)"
    case .wrongLink(nil): "Card is empty"
    case .wrongLink(.some): "Card has a different link"
    case .failed(let message): message
    }
  }

  var detail: String? {
    switch self {
    case .wrongLink(.some(let link)): link
    case .written(_, .some): "It now points to this business."
    default: nil
    }
  }

  /// Mismatches can be fixed by writing again.
  var offersRewrite: Bool {
    switch self {
    case .belongsToOther, .wrongLink, .failed: true
    default: false
    }
  }
}

/// Drives write/verify taps for one business and records the cards it sees.
@Observable
final class CardProgrammer {
  private(set) var outcome: CardOutcome?
  private(set) var isBusy = false
  /// Result of saving the write to Lead Tracker, shown under the NFC buttons.
  private(set) var syncNote: String?

  private let nfc: NFCService
  private let business: Business
  private let context: ModelContext

  init(business: Business, context: ModelContext, nfc: NFCService = NFCService()) {
    self.business = business
    self.context = context
    self.nfc = nfc
  }

  var nfcAvailable: Bool { nfc.isAvailable }

  func dismissOutcome() { outcome = nil }

  func write() async {
    await perform {
      let tag = try await nfc.write(business.reviewURL)
      let (card, movedFrom) = upsertCard(uid: tag.uid)
      card.writtenAt = .now
      card.lastVerifiedAt = .now
      if business.isLead {
        business.cardsWrittenAt = .now
        Task { await saveToLeadTracker() }
      }
      return .written(label: card.label, movedFrom: movedFrom)
    }
  }

  func verify() async {
    await perform {
      let tag = try await nfc.read()
      guard let url = tag.url else { return .wrongLink(nil) }
      if url == business.reviewURL {
        let (card, _) = upsertCard(uid: tag.uid)
        card.lastVerifiedAt = .now
        return .verified(label: card.label)
      }
      if let placeID = ReviewLink.placeID(from: url), let other = findBusiness(placeID: placeID) {
        return .belongsToOther(businessName: other.name)
      }
      return .wrongLink(url.absoluteString)
    }
  }

  // MARK: - Internals

  /// Card write already succeeded; a failure here only shows a note.
  private func saveToLeadTracker() async {
    syncNote = "Saving to Lead Tracker…"
    do {
      try await LeadTracker.markCardWritten(placeID: business.placeID, reviewLink: business.reviewURL)
      if business.storedReviewLink == nil { business.storedReviewLink = business.reviewURL.absoluteString }
      syncNote = "Saved to Lead Tracker."
    } catch {
      syncNote = "Card is fine, but Lead Tracker wasn't updated: \(error.localizedDescription)"
    }
  }

  private func perform(_ work: () async throws -> CardOutcome) async {
    guard !isBusy else { return }
    isBusy = true
    defer { isBusy = false }
    do {
      let result = try await work()
      try context.save()
      outcome = result
      UINotificationFeedbackGenerator().notificationOccurred(result.isGood ? .success : .warning)
    } catch NFCError.cancelled {
      // User closed the system sheet. Nothing to say.
    } catch {
      outcome = .failed(error.localizedDescription)
      UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
  }

  /// Finds or creates the card for this chip and attaches it to this business.
  /// Returns the previous owner's name when the card moved from another business.
  private func upsertCard(uid: String) -> (NFCCard, movedFrom: String?) {
    var descriptor = FetchDescriptor<NFCCard>(predicate: #Predicate { $0.uid == uid })
    descriptor.fetchLimit = 1
    if let existing = try? context.fetch(descriptor).first {
      guard existing.business?.persistentModelID != business.persistentModelID else { return (existing, nil) }
      let from = existing.business?.name
      existing.business = business
      existing.label = business.nextCardLabel
      return (existing, from)
    }
    let card = NFCCard(uid: uid, label: business.nextCardLabel, business: business)
    context.insert(card)
    return (card, nil)
  }

  private func findBusiness(placeID: String) -> Business? {
    var descriptor = FetchDescriptor<Business>(predicate: #Predicate { $0.placeID == placeID })
    descriptor.fetchLimit = 1
    return try? context.fetch(descriptor).first
  }
}
