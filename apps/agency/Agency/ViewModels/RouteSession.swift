import CoreLocation
import Foundation
import SwiftUI

/// One open route: its stops in visiting order, ETAs, and the actions from the bottom panel.
/// Writes are optimistic and roll back if Neon refuses.
@Observable
final class RouteSession {
  let routeID: String
  private(set) var route: RouteRow?
  private(set) var stops: [RouteStop] = []
  private(set) var isLoading = false
  private(set) var isOptimizing = false
  var error: String?
  /// Bumped on every visit/fail so the view can play haptics.
  private(set) var feedback: (id: Int, success: Bool) = (0, true)

  /// Minutes spent at each stop, from Settings.
  private var visitMinutes: Int { RouteSettings.visitMinutes }

  init(routeID: String) {
    self.routeID = routeID
  }

  // MARK: - Derived

  var ordered: [RouteStop] { stops.sorted { $0.position < $1.position } }
  var pending: [RouteStop] { ordered.filter(\.isPending) }
  var currentStop: RouteStop? { pending.first }
  var upNext: [RouteStop] { Array(pending.dropFirst()) }
  var doneCount: Int { stops.count - pending.count }
  var progress: Double { stops.isEmpty ? 0 : Double(doneCount) / Double(stops.count) }
  var isFinished: Bool { route?.routeStatus == .done }

  var start: Coordinate? { route.map { Coordinate(lat: $0.startLat, lng: $0.startLng) } }
  var end: Coordinate? {
    guard let route, let lat = route.endLat, let lng = route.endLng else { return nil }
    return Coordinate(lat: lat, lng: lng)
  }

  /// Stops to pin on the map. MapKit stacks pins by latitude, so a pending stop in the same
  /// plaza as the current one (a few meters away) would cover it; those wait until it's done.
  var mapStops: [RouteStop] {
    guard let current = currentStop else { return ordered }
    return ordered.filter { stop in
      stop.id == current.id || !stop.isPending
        || LeadTracker.haversineMiles(stop.lat, stop.lng, current.lat, current.lng) > 0.02
    }
  }

  /// Round trip: start and end are the same spot, so the map shows only the house.
  var startsAtEnd: Bool {
    guard let start, let end else { return false }
    return LeadTracker.haversineMiles(start.lat, start.lng, end.lat, end.lng) < 0.1
  }

  /// Arrival time per pending stop: now + each drive + the visit time at every stop before it.
  var etas: [String: Date] {
    var time = Date.now
    var result: [String: Date] = [:]
    for stop in pending {
      time += TimeInterval(stop.legDurationSeconds ?? 0)
      result[stop.id] = time
      time += TimeInterval(visitMinutes * 60)
    }
    return result
  }

  /// When the last stop is done and, if the route ends at home, you're back.
  var finishETA: Date? {
    guard let last = pending.last, let arrival = etas[last.id] else { return nil }
    return arrival + TimeInterval(visitMinutes * 60) + TimeInterval(route?.returnDurationSeconds ?? 0)
  }

  // MARK: - Loading

  func load() async {
    isLoading = true
    defer { isLoading = false }
    do {
      async let route = RoutePlanner.fetchRoute(routeID)
      async let stops = RoutePlanner.fetchStops(routeID)
      (self.route, self.stops) = try await (route, stops)
      error = nil
      // Cache the stops' client websites now so they open offline at each stop.
      let placeIDs = self.stops.map(\.placeID)
      Task.detached(priority: .utility) { await SiteCache.shared.prefetch(placeIDs: placeIDs) }
      if self.route?.optimizedEpoch == nil, !self.stops.isEmpty {
        await optimize()
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  // MARK: - Ordering

  /// Asks Google for the quickest order of the pending stops (or, with `reorder: false`, just
  /// fresh drive times for the current order) and saves it. Before the first visit the drive
  /// starts at the route's start point; after that, at the phone's current location.
  func optimize(reorder: Bool = true) async {
    guard let route, !isOptimizing else { return }
    let pending = self.pending
    guard !pending.isEmpty else { return }
    isOptimizing = true
    defer { isOptimizing = false }

    var origin = Coordinate(lat: route.startLat, lng: route.startLng)
    if doneCount > 0, let here = await LocationService.shared.current() { origin = here }

    // Ending at home: every pending stop is a waypoint. Ending at the last stop: Google needs a
    // fixed destination, so the stop farthest from the origin is the end and the rest are ordered.
    var intermediates = pending
    var last: RouteStop?
    let destination: Waypoint
    if let end {
      destination = .coordinate(end)
    } else {
      let pick = reorder
        ? pending.max { distance(origin, $0) < distance(origin, $1) }!
        : pending.last!
      last = pick
      intermediates.removeAll { $0.id == pick.id }
      destination = .place(pick.placeID)
    }

    do {
      let result = try await RoutesService.compute(
        from: origin, to: destination, via: intermediates.map { .place($0.placeID) }, optimize: reorder
      )
      let sequence = result.order.map { intermediates[$0] } + (last.map { [$0] } ?? [])
      let firstPosition = doneCount == 0 ? 0 : (ordered.filter { !$0.isPending }.map(\.position).max() ?? -1) + 1
      let plans = sequence.enumerated().map { index, stop in
        let leg = result.legs[index]
        return StopPlan(id: stop.id, position: firstPosition + index, dur: leg.durationSeconds,
                        dist: leg.distanceMeters, poly: leg.polyline)
      }
      let returnLeg = end == nil ? nil : result.legs.last.map { ($0.durationSeconds, $0.distanceMeters, $0.polyline) }

      try await RoutePlanner.saveOptimization(
        routeID: routeID, stops: plans, distanceMeters: result.distanceMeters,
        durationSeconds: result.durationSeconds, returnLeg: returnLeg
      )
      for plan in plans {
        guard let index = stops.firstIndex(where: { $0.id == plan.id }) else { continue }
        stops[index].position = plan.position
        stops[index].legDurationSeconds = plan.dur
        stops[index].legDistanceMeters = plan.dist
        stops[index].legPolyline = plan.poly
      }
      self.route?.returnDurationSeconds = returnLeg?.0
      self.route?.returnPolyline = returnLeg?.2
      self.route?.optimizedEpoch = Date.now.timeIntervalSince1970
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  // MARK: - Stop actions

  /// Marks the stop visited and, if a status was picked, updates the lead in Lead Tracker.
  func markVisited(_ stop: RouteStop, leadStatus: LeadStatus?) async {
    await mark(stop, status: .visited, reason: nil, position: nil)
    feedback = (feedback.id + 1, true)
    guard let leadStatus, leadStatus.rawValue != stop.leadStatus else { return }
    do {
      try await LeadTracker.setStatus(placeID: stop.placeID, status: leadStatus)
      if let index = stops.firstIndex(where: { $0.id == stop.id }) { stops[index].leadStatus = leadStatus.rawValue }
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// `retryLater` keeps the stop pending but moves it to the end, then refreshes drive times.
  func markFailed(_ stop: RouteStop, reason: String, retryLater: Bool) async {
    feedback = (feedback.id + 1, false)
    if retryLater {
      let end = (stops.map(\.position).max() ?? 0) + 1
      await mark(stop, status: .pending, reason: reason, position: end)
      await optimize(reorder: false)
    } else {
      await mark(stop, status: .failed, reason: reason, position: nil)
    }
  }

  /// Puts a visited or failed stop back on the list in its old place.
  func undo(_ stop: RouteStop) async {
    await mark(stop, status: .pending, reason: nil, position: nil)
    await optimize(reorder: false)
  }

  /// Adds leads, then re-orders everything still to visit.
  func addStops(_ placeIDs: [String]) async {
    guard !placeIDs.isEmpty else { return }
    do {
      try await RoutePlanner.addStops(routeID: routeID, placeIDs: placeIDs)
      stops = try await RoutePlanner.fetchStops(routeID)
      await optimize()
    } catch {
      self.error = error.localizedDescription
    }
  }

  func finish() async {
    await setRouteStatus(.done)
  }

  func reopen() async {
    await setRouteStatus(.active)
  }

  func rename(_ name: String) async {
    let trimmed = name.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty, let previous = route?.name else { return }
    route?.name = trimmed
    do {
      try await RoutePlanner.rename(routeID: routeID, name: trimmed)
    } catch {
      route?.name = previous
      self.error = error.localizedDescription
    }
  }

  // MARK: - Navigation

  /// Next stop, or the end point once every stop is done.
  func navigate() {
    if let stop = currentStop {
      MapsLauncher.open(to: Coordinate(lat: stop.lat, lng: stop.lng), placeID: stop.placeID)
    } else if let end {
      MapsLauncher.open(to: end)
    }
  }

  /// Decoded leg shapes, cached so the map doesn't re-decode on every redraw.
  @ObservationIgnored private var shapes: [String: [CLLocationCoordinate2D]] = [:]

  func coordinates(_ polyline: String) -> [CLLocationCoordinate2D] {
    if let cached = shapes[polyline] { return cached }
    let decoded = Polyline.decode(polyline)
    shapes[polyline] = decoded
    return decoded
  }

  // MARK: - Internals

  private func mark(_ stop: RouteStop, status: StopStatus, reason: String?, position: Int?) async {
    guard let index = stops.firstIndex(where: { $0.id == stop.id }) else { return }
    let previous = stops[index]
    let previousRouteStatus = route?.status
    withAnimation(.snappy) {
      stops[index].status = status.rawValue
      stops[index].failureReason = reason
      if let position { stops[index].position = position }
      if route?.routeStatus == .planned { route?.status = RouteStatus.active.rawValue }
    }
    do {
      try await RoutePlanner.markStop(stop.id, status: status, reason: reason, position: position)
      error = nil
    } catch {
      withAnimation(.snappy) {
        if let index = stops.firstIndex(where: { $0.id == stop.id }) { stops[index] = previous }
        if let previousRouteStatus { route?.status = previousRouteStatus }
      }
      self.error = error.localizedDescription
    }
  }

  private func setRouteStatus(_ status: RouteStatus) async {
    guard let previous = route?.status else { return }
    route?.status = status.rawValue
    do {
      try await RoutePlanner.setStatus(routeID: routeID, status: status)
    } catch {
      route?.status = previous
      self.error = error.localizedDescription
    }
  }

  private func distance(_ from: Coordinate, _ stop: RouteStop) -> Double {
    LeadTracker.haversineMiles(from.lat, from.lng, stop.lat, stop.lng)
  }
}

/// Smart Route preferences (Settings → Smart Route).
enum RouteSettings {
  static let visitMinutesKey = "routeVisitMinutes"
  static let defaultVisitMinutes = 10

  static var visitMinutes: Int {
    let stored = UserDefaults.standard.integer(forKey: visitMinutesKey)
    return stored > 0 ? stored : defaultVisitMinutes
  }
}
