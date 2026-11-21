import Foundation

/// One row of `leads` as the phone sees it. The `agency_ios` role can only read these columns.
nonisolated struct Lead: Decodable, Sendable {
  let placeID: String
  let name: String
  let category: String
  let address: String?
  let rating: Double
  let reviewCount: Int
  let status: String
  let reviewLink: String?
  /// Unix seconds; Postgres timestamps are selected as epoch numbers to skip date parsing.
  let cardsWrittenEpoch: Double?
  let firstSeenEpoch: Double
  /// Straight-line miles from home (566 Kit St), set by lead-finder on insert.
  let distanceMiles: Double

  var firstSeenAt: Date { Date(timeIntervalSince1970: firstSeenEpoch) }
  /// lead-finder's list order: review_count * rating, highest first.
  var score: Double { Double(reviewCount) * rating }

  var cardsWrittenAt: Date? { cardsWrittenEpoch.map { Date(timeIntervalSince1970: $0) } }

  enum CodingKeys: String, CodingKey {
    case placeID = "place_id"
    case name, category, address, rating, status
    case reviewCount = "review_count"
    case reviewLink = "review_link"
    case cardsWrittenEpoch = "cards_written_epoch"
    case firstSeenEpoch = "first_seen_epoch"
    case distanceMiles = "distance_miles"
  }
}

/// The bits of lead-finder's `settings` row the app needs to add a lead.
nonisolated struct LeadSettings: Decodable, Sendable {
  let homeLat: Double
  let homeLng: Double
  let categories: [String]

  enum CodingKeys: String, CodingKey {
    case homeLat = "home_lat"
    case homeLng = "home_lng"
    case categories
  }
}

nonisolated enum LeadTrackerError: LocalizedError {
  case noLocation
  case notSaved

  var errorDescription: String? {
    switch self {
    case .noLocation: "Google didn't return a location for that place."
    case .notSaved: "Lead Tracker didn't save the lead."
    }
  }
}

/// Reads leads from lead-finder's Neon database and writes back card info.
nonisolated enum LeadTracker {
  /// Live straight-line miles from the current home point (`settings.home_lat/lng`, 566 Kit St).
  /// `leads.distance_miles` is not used: it was saved against whatever home was set at insert
  /// time and goes stale when home moves. Needs `FROM leads, (SELECT home_lat, home_lng …) home`.
  static let distanceSQL = """
    COALESCE(2 * 3958.8 * asin(least(1, sqrt(
      power(sin(radians(lat - home.home_lat) / 2), 2)
      + cos(radians(home.home_lat)) * cos(radians(lat)) * power(sin(radians(lng - home.home_lng) / 2), 2)
    ))), distance_miles)::float8
    """

  /// Every lead except hidden ones, nearest to home first.
  static func fetchLeads(connectionString: String? = nil) async throws -> [Lead] {
    try await NeonClient.query(
      """
      SELECT place_id, name, category, address, rating::float8 AS rating, review_count, status,
             review_link, extract(epoch FROM nfc_cards_written_at)::float8 AS cards_written_epoch,
             extract(epoch FROM first_seen_at)::float8 AS first_seen_epoch,
             \(distanceSQL) AS distance_miles
      FROM leads, (SELECT home_lat, home_lng FROM settings LIMIT 1) home
      WHERE status <> 'hidden'
      ORDER BY distance_miles ASC, review_count * rating DESC NULLS LAST
      """,
      connectionString: connectionString
    )
  }

  static func settings() async throws -> LeadSettings {
    let rows: [LeadSettings] = try await NeonClient.query(
      "SELECT home_lat::float8 AS home_lat, home_lng::float8 AS home_lng, categories FROM settings LIMIT 1"
    )
    guard let first = rows.first else { throw NeonError.decoding("no settings row") }
    return first
  }

  /// Inserts a place as a lead, the same shape lead-finder's daily job saves.
  /// `details` stays empty; `pnpm lead:refresh <place_id>` fills it before a design.
  /// If the place is already a lead nothing changes, except a hidden lead comes back as the chosen status.
  static func addLead(_ place: PlaceResult, category: String, status: LeadStatus, home: LeadSettings) async throws {
    guard let lat = place.latitude, let lng = place.longitude else { throw LeadTrackerError.noLocation }
    let miles = haversineMiles(lat, lng, home.homeLat, home.homeLng)
    let rows: [PlaceIDRow] = try await NeonClient.query(
      """
      INSERT INTO leads (place_id, name, category, primary_type, address, phone, lat, lng, distance_miles,
                         google_maps_url, rating, review_count, review_link, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7::float8, $8::float8, $9::float8, $10, $11::real, $12::int, $13, $14)
      ON CONFLICT (place_id) DO UPDATE
        SET status = CASE WHEN leads.status = 'hidden' THEN EXCLUDED.status ELSE leads.status END
      RETURNING place_id
      """,
      [
        place.id, place.name, category, place.primaryType, place.address.isEmpty ? nil : place.address,
        place.phone, String(lat), String(lng), String((miles * 10).rounded() / 10), place.mapsURL,
        String(place.rating ?? 0), String(place.ratingCount ?? 0),
        ReviewLink.url(placeID: place.id).absoluteString, status.rawValue,
      ]
    )
    guard !rows.isEmpty else { throw LeadTrackerError.notSaved }
  }

  /// Best guess at lead-finder's category from Google's primary type; falls back to the first category.
  static func guessCategory(primaryType: String?, from categories: [String]) -> String {
    let type = primaryType?.lowercased() ?? ""
    let rules: [(keys: [String], match: String)] = [
      (["barber", "hair", "beauty", "salon"], "barber"),
      (["car", "auto", "tire", "vehicle", "tow", "motor"], "auto"),
      (["restaurant", "cafe", "bakery", "food", "bar", "meal", "pizza", "grill"], "restaurant"),
      (["pest", "exterminat"], "pest"),
      (["handyman", "contractor", "plumb", "electric", "roof", "paint", "home"], "handyman"),
    ]
    for rule in rules where rule.keys.contains(where: type.contains) {
      if let category = categories.first(where: { $0.lowercased().contains(rule.match) }) { return category }
    }
    return categories.first ?? "other"
  }

  /// Same formula as lead-finder's `haversineMiles` (src/lib/geo.ts).
  static func haversineMiles(_ lat1: Double, _ lng1: Double, _ lat2: Double, _ lng2: Double) -> Double {
    let rad = Double.pi / 180
    let dLat = (lat2 - lat1) * rad
    let dLng = (lng2 - lng1) * rad
    let h = pow(sin(dLat / 2), 2) + cos(lat1 * rad) * cos(lat2 * rad) * pow(sin(dLng / 2), 2)
    return 2 * 3958.8 * asin(min(1, sqrt(h)))
  }

  /// Called after a card is written: keeps any existing link, stamps the write time.
  static func markCardWritten(placeID: String, reviewLink: URL) async throws {
    let _: [Empty] = try await NeonClient.query(
      """
      UPDATE leads SET review_link = COALESCE(review_link, $2),
                       nfc_cards_written_at = now(), updated_at = now()
      WHERE place_id = $1
      """,
      [placeID, reviewLink.absoluteString]
    )
  }

  /// Safety net for leads saved without a link (e.g. inserted by an older lead-finder).
  static func fillMissingLink(placeID: String) async throws {
    let _: [Empty] = try await NeonClient.query(
      "UPDATE leads SET review_link = $2 WHERE place_id = $1 AND review_link IS NULL",
      [placeID, ReviewLink.url(placeID: placeID).absoluteString]
    )
  }

  /// Same rule as lead-finder's `updateLead`: Design Ready also flips the `design_ready` flag,
  /// so the design picker (status = 'new' AND NOT design_ready) skips the lead.
  static func setStatus(placeID: String, status: LeadStatus) async throws {
    let _: [Empty] = try await NeonClient.query(
      """
      UPDATE leads SET status = $2,
                       design_ready = CASE WHEN $2 = 'design_ready' THEN true ELSE design_ready END,
                       updated_at = now()
      WHERE place_id = $1
      """,
      [placeID, status.rawValue]
    )
  }

  private struct Empty: Decodable {}
  private struct PlaceIDRow: Decodable { let place_id: String }
}
