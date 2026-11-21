import CoreLocation

/// One-shot "where am I" for route planning. Asks for When In Use permission the first time.
@MainActor
final class LocationService {
  static let shared = LocationService()
  private let manager = CLLocationManager()

  /// Current position, or nil if permission is denied or no fix arrives within `timeout`.
  func current(timeout: Duration = .seconds(10)) async -> Coordinate? {
    switch manager.authorizationStatus {
    case .denied, .restricted: return nil
    case .notDetermined: manager.requestWhenInUseAuthorization()
    default: break
    }
    return await withTaskGroup(of: Coordinate?.self) { group in
      group.addTask {
        do {
          for try await update in CLLocationUpdate.liveUpdates() {
            if let location = update.location, location.horizontalAccuracy >= 0, location.horizontalAccuracy < 200 {
              return Coordinate(lat: location.coordinate.latitude, lng: location.coordinate.longitude)
            }
          }
        } catch {}
        return nil
      }
      group.addTask {
        try? await Task.sleep(for: timeout)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }
}
