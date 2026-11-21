import SwiftUI

/// Pick leads, choose where the day starts and ends, then create the route.
/// The map screen orders the stops with Google as soon as it opens.
struct NewRouteView: View {
  let onCreate: (RouteRef) -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var candidates: [RouteCandidate] = []
  @State private var home: Coordinate?
  @State private var selection = Set<String>()
  @State private var name = Self.defaultName()
  @State private var start: StartPoint = .currentLocation
  @State private var end: EndPoint = .home
  @State private var search = ""
  @State private var statusFilter: LeadStatus?
  @State private var isLoading = true
  @State private var isCreating = false
  @State private var error: String?

  enum StartPoint: String, CaseIterable, Identifiable {
    case currentLocation = "Current location"
    case home = "Home"
    var id: Self { self }
  }

  enum EndPoint: String, CaseIterable, Identifiable {
    case home = "Back home"
    case lastStop = "At the last stop"
    var id: Self { self }
  }

  private var canCreate: Bool {
    !selection.isEmpty && selection.count <= RoutesService.maxStops && !isCreating
      && !name.trimmingCharacters(in: .whitespaces).isEmpty
  }

  var body: some View {
    NavigationStack {
      List(selection: $selection) {
        Section {
          TextField("Name", text: $name)
          Picker("Start", selection: $start) {
            ForEach(StartPoint.allCases) { Text($0.rawValue).tag($0) }
          }
          Picker("End", selection: $end) {
            ForEach(EndPoint.allCases) { Text($0.rawValue).tag($0) }
          }
        } footer: {
          if let error {
            Text(error).foregroundStyle(.red)
          } else {
            Text("Google orders the stops for the quickest drive on real roads. Home is the home point in Lead Tracker settings.")
          }
        }

        LeadPickerSection(candidates: candidates, search: search, statusFilter: statusFilter,
                          selectedCount: selection.count)
      }
      .environment(\.editMode, .constant(.active))
      .overlay {
        if isLoading { ProgressView() }
      }
      .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search leads")
      .navigationTitle("New Route")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .topBarTrailing) {
          LeadStatusFilterMenu(statusFilter: $statusFilter)
        }
        ToolbarItem(placement: .confirmationAction) {
          if isCreating {
            ProgressView()
          } else {
            Button(selection.isEmpty ? "Create" : "Create (\(selection.count))") {
              Task { await create() }
            }
            .disabled(!canCreate)
          }
        }
      }
      .task { await load() }
      .sensoryFeedback(.selection, trigger: selection)
    }
  }

  private func load() async {
    defer { isLoading = false }
    do {
      async let leads = RoutePlanner.candidates()
      async let settings = LeadTracker.settings()
      let (loadedLeads, loadedSettings) = try await (leads, settings)
      candidates = loadedLeads
      home = Coordinate(lat: loadedSettings.homeLat, lng: loadedSettings.homeLng)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func create() async {
    guard let home else {
      error = "Lead Tracker has no home point yet."
      return
    }
    isCreating = true
    defer { isCreating = false }
    var origin = home
    if start == .currentLocation {
      if let here = await LocationService.shared.current() {
        origin = here
      } else {
        error = "Couldn't get your location, so the route starts at home."
      }
    }
    // Keep lead-finder's list order so stops have a stable order before Google re-orders them.
    let placeIDs = candidates.map(\.placeID).filter(selection.contains)
    let trimmed = name.trimmingCharacters(in: .whitespaces)
    do {
      let id = try await RoutePlanner.create(
        name: trimmed, start: origin, end: end == .home ? home : nil, placeIDs: placeIDs
      )
      dismiss()
      onCreate(RouteRef(id: id, name: trimmed))
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// "Thursday, Nov 20"
  private static func defaultName() -> String {
    Date.now.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
  }
}

/// Adds leads to a route that's already planned or underway.
struct AddStopsView: View {
  let excluding: Set<String>
  let remaining: Int
  let onAdd: ([String]) -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var candidates: [RouteCandidate] = []
  @State private var selection = Set<String>()
  @State private var search = ""
  @State private var statusFilter: LeadStatus?
  @State private var isLoading = true
  @State private var error: String?

  var body: some View {
    NavigationStack {
      List(selection: $selection) {
        if let error {
          Text(error).foregroundStyle(.red)
        }
        LeadPickerSection(candidates: candidates, search: search, statusFilter: statusFilter,
                          selectedCount: selection.count + (RoutesService.maxStops - remaining))
      }
      .environment(\.editMode, .constant(.active))
      .overlay {
        if isLoading { ProgressView() }
      }
      .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search leads")
      .navigationTitle("Add Stops")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .topBarTrailing) {
          LeadStatusFilterMenu(statusFilter: $statusFilter)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(selection.isEmpty ? "Add" : "Add (\(selection.count))") {
            onAdd(candidates.map(\.placeID).filter(selection.contains))
            dismiss()
          }
          .disabled(selection.isEmpty || selection.count > remaining)
        }
      }
      .task {
        defer { isLoading = false }
        do {
          candidates = try await RoutePlanner.candidates().filter { !excluding.contains($0.placeID) }
        } catch {
          self.error = error.localizedDescription
        }
      }
    }
  }
}
