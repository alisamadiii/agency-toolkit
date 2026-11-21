import Foundation
import SwiftData

/// Mirrors Lead Tracker's leads into SwiftData so card records can hang off them.
/// Lead Tracker is the only source of businesses; nothing is kept as a local-only "manual" business.
@Observable
final class LeadSync {
  private(set) var isSyncing = false
  private(set) var lastSyncedAt: Date?
  private(set) var error: String?
  /// From lead-finder's settings row; loaded on demand for adding leads.
  private(set) var settings: LeadSettings?

  var isConnected: Bool { Keychain.get(.leadTrackerURL) != nil }

  func sync(into context: ModelContext) async {
    guard isConnected, !isSyncing else { return }
    isSyncing = true
    defer { isSyncing = false }
    do {
      await promoteLocalBusinesses(in: context)
      let leads = try await LeadTracker.fetchLeads()
      try apply(leads, to: context)
      lastSyncedAt = .now
      error = nil
      for lead in leads where lead.reviewLink == nil {
        try? await LeadTracker.fillMissingLink(placeID: lead.placeID)
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  func loadSettings() async throws -> LeadSettings {
    if let settings { return settings }
    let loaded = try await LeadTracker.settings()
    settings = loaded
    return loaded
  }

  /// Inserts the place into Lead Tracker, then refreshes the local list.
  func add(_ place: PlaceResult, category: String, status: LeadStatus, context: ModelContext) async throws {
    let home = try await loadSettings()
    try await LeadTracker.addLead(place, category: category, status: status, home: home)
    await sync(into: context)
  }

  /// Optimistic: updates the row at once, rolls back if Neon refuses.
  func setStatus(_ status: LeadStatus, for business: Business) async {
    guard business.isLead, business.status != status else { return }
    let previous = business.leadStatus
    business.leadStatus = status.rawValue
    do {
      try await LeadTracker.setStatus(placeID: business.placeID, status: status)
      error = nil
    } catch {
      business.leadStatus = previous
      self.error = error.localizedDescription
    }
  }

  // MARK: - Internals

  /// Businesses added on the phone before Lead Tracker was the only source become real leads,
  /// so their card records show up again. Needs the Places key; skipped quietly without it.
  private func promoteLocalBusinesses(in context: ModelContext) async {
    guard Keychain.get(.placesAPIKey) != nil,
          let local = try? context.fetch(FetchDescriptor<Business>(predicate: #Predicate { !$0.isLead && $0.leadStatus == nil })),
          !local.isEmpty,
          let home = try? await loadSettings()
    else { return }
    for business in local {
      guard let place = try? await PlacesService.details(placeID: business.placeID) else { continue }
      let category = LeadTracker.guessCategory(primaryType: place.primaryType, from: home.categories)
      let status: LeadStatus = business.cards.isEmpty ? .new : .contacted
      try? await LeadTracker.addLead(place, category: category, status: status, home: home)
    }
  }

  private func apply(_ leads: [Lead], to context: ModelContext) throws {
    let existing = try context.fetch(FetchDescriptor<Business>())
    var byID = Dictionary(existing.map { ($0.placeID, $0) }, uniquingKeysWith: { first, _ in first })
    let incoming = Set(leads.map(\.placeID))

    for lead in leads {
      let business = byID[lead.placeID] ?? {
        let new = Business(placeID: lead.placeID, name: lead.name, address: lead.address ?? "")
        context.insert(new)
        byID[lead.placeID] = new
        return new
      }()
      business.isLead = true
      business.name = lead.name
      business.address = lead.address ?? ""
      business.rating = lead.rating
      business.ratingCount = lead.reviewCount
      business.category = lead.category
      business.leadStatus = lead.status
      business.storedReviewLink = lead.reviewLink
      business.cardsWrittenAt = lead.cardsWrittenAt
      business.score = lead.score
      business.firstSeenAt = lead.firstSeenAt
      business.distanceMiles = lead.distanceMiles
    }

    // Leads that disappeared (deleted or hidden): drop them unless cards were written for them,
    // in which case the record is kept (not shown) so the card history survives.
    for business in existing where business.isLead && !incoming.contains(business.placeID) {
      if business.cards.isEmpty {
        context.delete(business)
      } else {
        business.isLead = false
        business.leadStatus = LeadStatus.hidden.rawValue
      }
    }
    try context.save()
  }
}
