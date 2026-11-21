import Foundation
import SwiftData

/// A Google Business Profile the user programs cards for.
@Model
final class Business {
  @Attribute(.unique) var placeID: String
  var name: String
  var address: String
  var rating: Double?
  var ratingCount: Int?
  var createdAt: Date

  // Lead Tracker (Neon) fields. Defaults keep SwiftData's lightweight migration happy.
  /// True while this business exists as a non-hidden row in Lead Tracker.
  var isLead: Bool = false
  var category: String?
  var leadStatus: String?
  /// `leads.review_link`. Wins over the derived link so an owner's g.page link can be used.
  var storedReviewLink: String?
  /// `leads.nfc_cards_written_at`.
  var cardsWrittenAt: Date?
  /// lead-finder's sort key: review_count * rating.
  var score: Double = 0
  /// `leads.first_seen_at`.
  var firstSeenAt: Date = Date.distantPast
  /// `leads.distance_miles`: straight-line miles from home. The list sorts nearest first.
  var distanceMiles: Double = 0

  @Relationship(deleteRule: .cascade, inverse: \NFCCard.business)
  var cards: [NFCCard] = []

  init(placeID: String, name: String, address: String, rating: Double? = nil, ratingCount: Int? = nil) {
    self.placeID = placeID
    self.name = name
    self.address = address
    self.rating = rating
    self.ratingCount = ratingCount
    self.createdAt = .now
  }

  /// Opens the "write a review" dialog on top of the profile. Derived, never stored.
  var reviewURL: URL {
    if let storedReviewLink, let url = URL(string: storedReviewLink), url.scheme == "https" { return url }
    return ReviewLink.url(placeID: placeID)
  }

  var status: LeadStatus? { leadStatus.flatMap(LeadStatus.init(rawValue:)) }

  /// "auto repair"
  var categoryTitle: String? { category?.replacingOccurrences(of: "_", with: " ") }

  var sortedCards: [NFCCard] {
    cards.sorted { $0.writtenAt < $1.writtenAt }
  }

  var nextCardLabel: String { "Card \(cards.count + 1)" }
}
