import Foundation

/// A lead that can be put on a route. Read straight from Neon, not from SwiftData.
nonisolated struct RouteCandidate: Decodable, Identifiable, Hashable, Sendable {
  let placeID: String
  let name: String
  let category: String
  let address: String?
  let status: String
  let lat: Double
  let lng: Double
  let distanceMiles: Double

  var id: String { placeID }

  enum CodingKeys: String, CodingKey {
    case placeID = "place_id"
    case name, category, address, status, lat, lng
    case distanceMiles = "distance_miles"
  }
}

/// One row of the route list.
nonisolated struct RouteSummary: Decodable, Identifiable, Hashable, Sendable {
  let id: String
  let name: String
  let status: String
  let totalStops: Int
  let doneStops: Int
  let createdEpoch: Double

  var createdAt: Date { Date(timeIntervalSince1970: createdEpoch) }
  var routeStatus: RouteStatus { RouteStatus(rawValue: status) ?? .planned }

  enum CodingKeys: String, CodingKey {
    case id, name, status
    case totalStops = "total_stops"
    case doneStops = "done_stops"
    case createdEpoch = "created_epoch"
  }
}

/// Mirrors `ROUTE_STATUSES` in apps/lead-finder/src/db/schema.ts.
nonisolated enum RouteStatus: String, Sendable {
  case planned, active, done
}

/// Mirrors `STOP_STATUSES` in apps/lead-finder/src/db/schema.ts.
nonisolated enum StopStatus: String, Sendable {
  case pending, visited, failed
}

nonisolated struct RouteRow: Decodable, Sendable {
  let id: String
  var name: String
  var status: String
  let startLat: Double
  let startLng: Double
  let endLat: Double?
  let endLng: Double?
  var returnDurationSeconds: Int?
  var returnPolyline: String?
  var optimizedEpoch: Double?

  var routeStatus: RouteStatus { RouteStatus(rawValue: status) ?? .planned }
  var endsAtHome: Bool { endLat != nil && endLng != nil }

  enum CodingKeys: String, CodingKey {
    case id, name, status
    case startLat = "start_lat"
    case startLng = "start_lng"
    case endLat = "end_lat"
    case endLng = "end_lng"
    case returnDurationSeconds = "return_duration_seconds"
    case returnPolyline = "return_polyline"
    case optimizedEpoch = "optimized_epoch"
  }
}

/// A stop joined with its lead's name, address and location.
nonisolated struct RouteStop: Decodable, Identifiable, Hashable, Sendable {
  let id: String
  let placeID: String
  var position: Int
  var status: String
  var failureReason: String?
  var legDurationSeconds: Int?
  var legDistanceMeters: Int?
  var legPolyline: String?
  let name: String
  let address: String?
  let lat: Double
  let lng: Double
  var leadStatus: String

  var stopStatus: StopStatus { StopStatus(rawValue: status) ?? .pending }
  var isPending: Bool { stopStatus == .pending }
  /// "2905 Townsend Blvd" from "2905 Townsend Blvd, Jacksonville, FL 32277, USA".
  var street: String? { address?.split(separator: ",").first.map(String.init) }

  enum CodingKeys: String, CodingKey {
    case id, position, status, name, address, lat, lng
    case placeID = "place_id"
    case failureReason = "failure_reason"
    case legDurationSeconds = "leg_duration_seconds"
    case legDistanceMeters = "leg_distance_meters"
    case legPolyline = "leg_polyline"
    case leadStatus = "lead_status"
  }
}

extension RouteCandidate {
  var leadStatus: LeadStatus? { LeadStatus(rawValue: status) }
}

extension RouteStop {
  var lead: LeadStatus? { LeadStatus(rawValue: leadStatus) }
}

/// New order and drive legs for some stops, saved after a Routes API call.
nonisolated struct StopPlan: Encodable, Sendable {
  let id: String
  let position: Int
  let dur: Int?
  let dist: Int?
  let poly: String?
}

/// Smart Route storage: `routes` and `route_stops` in the Lead Tracker database.
/// The phone owns these tables; lead-finder's dashboard doesn't read them.
nonisolated enum RoutePlanner {
  /// Leads that can go on a route, nearest to home first.
  static func candidates() async throws -> [RouteCandidate] {
    try await NeonClient.query(
      """
      SELECT place_id, name, category, address, status, lat::float8 AS lat, lng::float8 AS lng,
             \(LeadTracker.distanceSQL) AS distance_miles
      FROM leads, (SELECT home_lat, home_lng FROM settings LIMIT 1) home
      WHERE status <> 'hidden'
      ORDER BY distance_miles ASC, review_count * rating DESC NULLS LAST
      """
    )
  }

  static func fetchRoutes() async throws -> [RouteSummary] {
    try await NeonClient.query(
      """
      SELECT r.id::text AS id, r.name, r.status,
             extract(epoch FROM r.created_at)::float8 AS created_epoch,
             count(s.id)::int AS total_stops,
             (count(s.id) FILTER (WHERE s.status <> 'pending'))::int AS done_stops
      FROM routes r LEFT JOIN route_stops s ON s.route_id = r.id
      GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100
      """
    )
  }

  static func fetchRoute(_ id: String) async throws -> RouteRow {
    let rows: [RouteRow] = try await NeonClient.query(
      """
      SELECT id::text AS id, name, status, start_lat, start_lng, end_lat, end_lng,
             return_duration_seconds, return_polyline,
             extract(epoch FROM optimized_at)::float8 AS optimized_epoch
      FROM routes WHERE id = $1::uuid
      """,
      [id]
    )
    guard let row = rows.first else { throw NeonError.decoding("route not found") }
    return row
  }

  static func fetchStops(_ routeID: String) async throws -> [RouteStop] {
    try await NeonClient.query(
      """
      SELECT s.id::text AS id, s.place_id, s.position, s.status, s.failure_reason,
             s.leg_duration_seconds, s.leg_distance_meters, s.leg_polyline,
             l.name, l.address, l.lat::float8 AS lat, l.lng::float8 AS lng, l.status AS lead_status
      FROM route_stops s JOIN leads l ON l.place_id = s.place_id
      WHERE s.route_id = $1::uuid ORDER BY s.position
      """,
      [routeID]
    )
  }

  /// Creates the route and its stops in one statement. `end` nil = end at the last stop.
  static func create(name: String, start: Coordinate, end: Coordinate?, placeIDs: [String]) async throws -> String {
    let rows: [IDRow] = try await NeonClient.query(
      """
      WITH r AS (
        INSERT INTO routes (name, start_lat, start_lng, end_lat, end_lng)
        VALUES ($1, $2::float8, $3::float8, $4::float8, $5::float8) RETURNING id
      ), s AS (
        INSERT INTO route_stops (route_id, place_id, position)
        SELECT r.id, p.place_id, (p.ord - 1)::int
        FROM r, json_array_elements_text($6::json) WITH ORDINALITY AS p(place_id, ord)
        RETURNING 1
      )
      SELECT id::text AS id FROM r
      """,
      [name, String(start.lat), String(start.lng), end.map { String($0.lat) }, end.map { String($0.lng) },
       try json(placeIDs)]
    )
    guard let id = rows.first?.id else { throw NeonError.decoding("route not created") }
    return id
  }

  /// Saves a Routes API result: stop order and legs, plus the drive back to the end point.
  static func saveOptimization(
    routeID: String, stops: [StopPlan], distanceMeters: Int, durationSeconds: Int,
    returnLeg: (duration: Int, distance: Int, polyline: String?)?
  ) async throws {
    let _: [Empty] = try await NeonClient.query(
      """
      WITH d AS (
        SELECT * FROM json_to_recordset($2::json) AS x(id uuid, position int, dur int, dist int, poly text)
      ), u AS (
        UPDATE route_stops s SET position = d.position, leg_duration_seconds = d.dur,
               leg_distance_meters = d.dist, leg_polyline = d.poly
        FROM d WHERE s.id = d.id AND s.route_id = $1::uuid RETURNING 1
      )
      UPDATE routes SET distance_meters = $3::int, duration_seconds = $4::int,
             return_duration_seconds = $5::int, return_distance_meters = $6::int, return_polyline = $7,
             optimized_at = now(), updated_at = now()
      WHERE id = $1::uuid
      """,
      [routeID, try json(stops), String(distanceMeters), String(durationSeconds),
       returnLeg.map { String($0.duration) }, returnLeg.map { String($0.distance) }, returnLeg?.polyline]
    )
  }

  /// Marks a stop. The first marked stop also flips the route to active.
  static func markStop(_ stopID: String, status: StopStatus, reason: String?, position: Int?) async throws {
    let _: [Empty] = try await NeonClient.query(
      """
      WITH s AS (
        UPDATE route_stops SET status = $2, failure_reason = $3,
               visited_at = CASE WHEN $2 = 'pending' THEN NULL ELSE now() END,
               position = COALESCE($4::int, position)
        WHERE id = $1::uuid RETURNING route_id
      )
      UPDATE routes SET status = CASE WHEN routes.status = 'planned' THEN 'active' ELSE routes.status END,
             started_at = COALESCE(started_at, now()), updated_at = now()
      FROM s WHERE routes.id = s.route_id
      """,
      [stopID, status.rawValue, reason, position.map(String.init)]
    )
  }

  /// Appends leads after the current last stop; leads already on the route are skipped.
  static func addStops(routeID: String, placeIDs: [String]) async throws {
    let _: [Empty] = try await NeonClient.query(
      """
      INSERT INTO route_stops (route_id, place_id, position)
      SELECT $1::uuid, p.place_id,
             (SELECT coalesce(max(position), -1) FROM route_stops WHERE route_id = $1::uuid) + p.ord::int
      FROM json_array_elements_text($2::json) WITH ORDINALITY AS p(place_id, ord)
      ON CONFLICT (route_id, place_id) DO NOTHING
      """,
      [routeID, try json(placeIDs)]
    )
  }

  static func setStatus(routeID: String, status: RouteStatus) async throws {
    let _: [Empty] = try await NeonClient.query(
      """
      UPDATE routes SET status = $2,
             finished_at = CASE WHEN $2 = 'done' THEN now() ELSE NULL END, updated_at = now()
      WHERE id = $1::uuid
      """,
      [routeID, status.rawValue]
    )
  }

  static func rename(routeID: String, name: String) async throws {
    let _: [Empty] = try await NeonClient.query(
      "UPDATE routes SET name = $2, updated_at = now() WHERE id = $1::uuid", [routeID, name]
    )
  }

  static func delete(routeID: String) async throws {
    let _: [Empty] = try await NeonClient.query("DELETE FROM routes WHERE id = $1::uuid", [routeID])
  }

  private static func json(_ value: some Encodable) throws -> String {
    String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
  }

  private struct Empty: Decodable {}
  private struct IDRow: Decodable { let id: String }
}
