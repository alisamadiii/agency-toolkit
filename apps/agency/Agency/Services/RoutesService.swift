import CoreLocation
import Foundation

nonisolated struct Coordinate: Codable, Hashable, Sendable {
  let lat: Double
  let lng: Double

  var clLocation: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lng) }
}

/// A point the Routes API drives through: a business (by place ID, so it routes to the
/// real entrance) or a plain coordinate (start, home).
nonisolated enum Waypoint: Sendable {
  case place(String)
  case coordinate(Coordinate)
}

nonisolated struct RouteLeg: Sendable {
  let durationSeconds: Int
  let distanceMeters: Int
  let polyline: String?
}

nonisolated struct ComputedRoute: Sendable {
  /// Optimized order as indexes into the intermediates that were sent.
  let order: [Int]
  /// One leg per hop: origin → stop 1 → … → destination.
  let legs: [RouteLeg]
  let distanceMeters: Int
  let durationSeconds: Int
}

nonisolated enum RoutesError: LocalizedError {
  case tooManyStops
  case noRoute
  case http(status: Int, message: String)

  var errorDescription: String? {
    switch self {
    case .tooManyStops: "Google can order up to \(RoutesService.maxStops) stops at a time."
    case .noRoute: "Google couldn't find a driving route through those stops."
    case .http(403, let message):
      "Google Routes (403): \(message) Enable “Routes API” on your Google key in Google Cloud."
    case .http(let status, let message): "Google Routes (\(status)): \(message)"
    }
  }
}

/// Google Routes API `computeRoutes`. With `optimizeWaypointOrder` Google picks the stop order
/// that's quickest on real roads with current traffic, which is what makes the route "smart":
/// ordering by straight-line distance sends you across rivers and highways the long way.
nonisolated enum RoutesService {
  /// Routes API limit for intermediate waypoints.
  static let maxStops = 25

  private static let fieldMask = [
    "routes.optimizedIntermediateWaypointIndex",
    "routes.legs.duration",
    "routes.legs.distanceMeters",
    "routes.legs.polyline.encodedPolyline",
    "routes.distanceMeters",
    "routes.duration",
  ].joined(separator: ",")

  static func compute(
    from origin: Coordinate, to destination: Waypoint, via intermediates: [Waypoint], optimize: Bool
  ) async throws -> ComputedRoute {
    guard intermediates.count <= maxStops else { throw RoutesError.tooManyStops }
    guard let key = Keychain.get(.placesAPIKey) else { throw PlacesError.missingKey }

    var request = URLRequest(url: URL(string: "https://routes.googleapis.com/directions/v2:computeRoutes")!)
    request.httpMethod = "POST"
    request.timeoutInterval = 30
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setGoogleAPIKey(key)
    request.setValue(fieldMask, forHTTPHeaderField: "X-Goog-FieldMask")
    request.httpBody = try JSONEncoder().encode(Body(
      origin: WaypointBody(.coordinate(origin)),
      destination: WaypointBody(destination),
      intermediates: intermediates.map(WaypointBody.init),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      optimizeWaypointOrder: optimize && intermediates.count > 1
    ))

    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error.message
        ?? String(data: data, encoding: .utf8) ?? ""
      throw RoutesError.http(status: status, message: message)
    }
    guard let route = try? JSONDecoder().decode(Response.self, from: data).routes?.first,
          let legs = route.legs, legs.count == intermediates.count + 1
    else { throw RoutesError.noRoute }

    let order = route.optimizedIntermediateWaypointIndex ?? []
    return ComputedRoute(
      order: order.count == intermediates.count ? order : Array(intermediates.indices),
      legs: legs.map {
        RouteLeg(durationSeconds: seconds($0.duration), distanceMeters: $0.distanceMeters ?? 0,
                 polyline: $0.polyline?.encodedPolyline)
      },
      distanceMeters: route.distanceMeters ?? 0,
      durationSeconds: seconds(route.duration)
    )
  }

  /// "1234s" → 1234
  private static func seconds(_ value: String?) -> Int {
    Int(Double(value?.replacingOccurrences(of: "s", with: "") ?? "") ?? 0)
  }

  private struct Body: Encodable {
    let origin: WaypointBody
    let destination: WaypointBody
    let intermediates: [WaypointBody]
    let travelMode: String
    let routingPreference: String
    let optimizeWaypointOrder: Bool
  }

  private struct WaypointBody: Encodable {
    struct LatLng: Encodable { let latitude: Double; let longitude: Double }
    struct Location: Encodable { let latLng: LatLng }
    var placeId: String?
    var location: Location?

    init(_ waypoint: Waypoint) {
      switch waypoint {
      case .place(let id): placeId = id
      case .coordinate(let c): location = Location(latLng: LatLng(latitude: c.lat, longitude: c.lng))
      }
    }
  }

  private struct Response: Decodable {
    struct Polyline: Decodable { let encodedPolyline: String? }
    struct Leg: Decodable {
      let duration: String?
      let distanceMeters: Int?
      let polyline: Polyline?
    }
    struct Route: Decodable {
      let optimizedIntermediateWaypointIndex: [Int]?
      let legs: [Leg]?
      let distanceMeters: Int?
      let duration: String?
    }
    let routes: [Route]?
  }

  private struct ErrorResponse: Decodable {
    struct Body: Decodable { let message: String }
    let error: Body
  }
}

/// Google's encoded polyline format → coordinates for `MapPolyline`.
nonisolated enum Polyline {
  static func decode(_ encoded: String) -> [CLLocationCoordinate2D] {
    var coordinates: [CLLocationCoordinate2D] = []
    let bytes = Array(encoded.utf8)
    var index = 0, lat = 0, lng = 0

    func next() -> Int? {
      var result = 0, shift = 0
      while index < bytes.count {
        let byte = Int(bytes[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20 { return (result & 1) != 0 ? ~(result >> 1) : (result >> 1) }
      }
      return nil
    }

    while index < bytes.count {
      guard let dLat = next(), let dLng = next() else { break }
      lat += dLat
      lng += dLng
      coordinates.append(CLLocationCoordinate2D(latitude: Double(lat) / 1e5, longitude: Double(lng) / 1e5))
    }
    return coordinates
  }
}
