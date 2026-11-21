import Foundation

nonisolated struct PlaceResult: Identifiable, Hashable, Sendable {
  let id: String
  let name: String
  let address: String
  let rating: Double?
  let ratingCount: Int?
  var latitude: Double?
  var longitude: Double?
  var primaryType: String?
  var phone: String?
  var mapsURL: String?
}

nonisolated enum PlacesError: LocalizedError {
  case missingKey
  case badPlaceID
  case http(status: Int, message: String)
  case decoding

  var errorDescription: String? {
    switch self {
    case .missingKey: "Add your Google Places API key in Settings first."
    case .badPlaceID: "That doesn't look like a place ID."
    case .http(let status, let message): "Google Places (\(status)): \(message)"
    case .decoding: "Unexpected response from Google Places."
    }
  }
}

/// Google Places API (New). Key comes from the Keychain.
nonisolated enum PlacesService {
  private static let fields =
    "id,displayName,formattedAddress,rating,userRatingCount,location,primaryType,nationalPhoneNumber,googleMapsUri"

  static func search(_ query: String) async throws -> [PlaceResult] {
    let key = try apiKey()
    var request = URLRequest(url: URL(string: "https://places.googleapis.com/v1/places:searchText")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setGoogleAPIKey(key)
    request.setValue(fields.split(separator: ",").map { "places.\($0)" }.joined(separator: ","),
                     forHTTPHeaderField: "X-Goog-FieldMask")
    request.httpBody = try JSONEncoder().encode(["textQuery": query])
    let data = try await send(request)
    let decoded = try decode(SearchResponse.self, from: data)
    return (decoded.places ?? []).map(PlaceResult.init)
  }

  static func details(placeID: String) async throws -> PlaceResult {
    let key = try apiKey()
    let id = placeID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !id.isEmpty, !id.contains(" "),
          let url = URL(string: "https://places.googleapis.com/v1/places/\(id)")
    else { throw PlacesError.badPlaceID }
    var request = URLRequest(url: url)
    request.setGoogleAPIKey(key)
    request.setValue(fields, forHTTPHeaderField: "X-Goog-FieldMask")
    let data = try await send(request)
    return PlaceResult(try decode(Place.self, from: data))
  }

  // MARK: - Plumbing

  private static func apiKey() throws -> String {
    guard let key = Keychain.get(.placesAPIKey) else { throw PlacesError.missingKey }
    return key
  }

  private static func send(_ request: URLRequest) async throws -> Data {
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error.message
        ?? String(data: data, encoding: .utf8) ?? ""
      throw PlacesError.http(status: status, message: message)
    }
    return data
  }

  private static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
    do { return try JSONDecoder().decode(type, from: data) } catch { throw PlacesError.decoding }
  }

  fileprivate struct SearchResponse: Decodable { let places: [Place]? }
  fileprivate struct Place: Decodable {
    struct LocalizedText: Decodable { let text: String }
    let id: String
    let displayName: LocalizedText?
    let formattedAddress: String?
    let rating: Double?
    let userRatingCount: Int?
    struct Location: Decodable { let latitude: Double; let longitude: Double }
    let location: Location?
    let primaryType: String?
    let nationalPhoneNumber: String?
    let googleMapsUri: String?
  }
  private struct ErrorResponse: Decodable {
    struct Body: Decodable { let message: String }
    let error: Body
  }
}

private nonisolated extension PlaceResult {
  init(_ place: PlacesService.Place) {
    self.init(
      id: place.id,
      name: place.displayName?.text ?? "Unnamed place",
      address: place.formattedAddress ?? "",
      rating: place.rating,
      ratingCount: place.userRatingCount,
      latitude: place.location?.latitude,
      longitude: place.location?.longitude,
      primaryType: place.primaryType,
      phone: place.nationalPhoneNumber,
      mapsURL: place.googleMapsUri
    )
  }
}

nonisolated extension URLRequest {
  /// Google API key plus the app's bundle ID, which Google checks when the key is
  /// restricted to iOS apps (the Maps SDKs send it automatically; plain REST calls must add it).
  mutating func setGoogleAPIKey(_ key: String) {
    setValue(key, forHTTPHeaderField: "X-Goog-Api-Key")
    if let bundleID = Bundle.main.bundleIdentifier {
      setValue(bundleID, forHTTPHeaderField: "X-Ios-Bundle-Identifier")
    }
  }
}
