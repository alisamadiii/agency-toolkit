import Foundation

/// Google's public "write a review" deep link. Works from a place ID alone.
nonisolated enum ReviewLink {
  private static let base = "https://search.google.com/local/writereview"

  static func url(placeID: String) -> URL {
    var components = URLComponents(string: base)!
    components.queryItems = [URLQueryItem(name: "placeid", value: placeID)]
    return components.url!
  }

  /// Place ID from a review link, or nil if the URL is something else.
  static func placeID(from url: URL) -> String? {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.host?.lowercased() == "search.google.com",
          components.path == "/local/writereview"
    else { return nil }
    return components.queryItems?.first { $0.name == "placeid" }?.value
  }
}
