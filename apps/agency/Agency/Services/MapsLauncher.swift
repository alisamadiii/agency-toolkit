import UIKit

/// SoloRoute-style hand-off: the app has no turn-by-turn of its own.
/// Opens Google Maps in driving navigation, or Apple Maps if Google Maps isn't installed.
enum MapsLauncher {
  static func open(to destination: Coordinate, placeID: String? = nil) {
    UIApplication.shared.open(url(to: destination, placeID: placeID))
  }

  static func url(to destination: Coordinate, placeID: String?) -> URL {
    let latLng = "\(destination.lat),\(destination.lng)"
    if UIApplication.shared.canOpenURL(URL(string: "comgooglemaps://")!) {
      // Universal link: opens the Google Maps app straight into navigation.
      var components = URLComponents(string: "https://www.google.com/maps/dir/")!
      components.queryItems = [
        URLQueryItem(name: "api", value: "1"),
        URLQueryItem(name: "destination", value: latLng),
        URLQueryItem(name: "travelmode", value: "driving"),
        URLQueryItem(name: "dir_action", value: "navigate"),
      ] + (placeID.map { [URLQueryItem(name: "destination_place_id", value: $0)] } ?? [])
      return components.url!
    }
    return URL(string: "maps://?daddr=\(latLng)&dirflg=d")!
  }
}
