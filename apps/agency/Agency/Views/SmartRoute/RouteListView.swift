import SwiftUI

/// Smart Route home: every route, newest first, grouped by state.
struct RouteListView: View {
  @Environment(Router.self) private var router
  @State private var routes: [RouteSummary] = []
  @State private var isLoading = true
  @State private var error: String?
  @State private var showNew = false
  @State private var pendingDelete: RouteSummary?

  private var isConnected: Bool { Keychain.get(.leadTrackerURL) != nil }

  var body: some View {
    List {
      if let error {
        Section {
          Label(error, systemImage: "exclamationmark.triangle")
            .foregroundStyle(.red)
            .font(.footnote)
        }
      }
      section("Active", status: .active)
      section("Planned", status: .planned)
      section("Done", status: .done)
    }
    .overlay { emptyState }
    .refreshable { await load() }
    .task { await load() }
    .navigationTitle("Smart Route")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          showNew = true
        } label: {
          Image(systemName: "plus")
        }
        .disabled(!isConnected)
        .accessibilityLabel("New route")
      }
    }
    .sheet(isPresented: $showNew) {
      NewRouteView { ref in
        router.path.append(ref)
      }
    }
    .confirmationDialog(
      "Delete \(pendingDelete?.name ?? "route")?",
      isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
      titleVisibility: .visible,
      presenting: pendingDelete
    ) { route in
      Button("Delete Route", role: .destructive) {
        Task { await delete(route) }
      }
    } message: { _ in
      Text("The route and its visit marks are removed. Leads and their statuses stay as they are.")
    }
  }

  @ViewBuilder
  private func section(_ title: String, status: RouteStatus) -> some View {
    let rows = routes.filter { $0.routeStatus == status }
    if !rows.isEmpty {
      Section(title) {
        ForEach(rows) { route in
          NavigationLink(value: RouteRef(id: route.id, name: route.name)) {
            RouteSummaryRow(route: route)
          }
          .swipeActions {
            Button("Delete", systemImage: "trash", role: .destructive) {
              pendingDelete = route
            }
          }
        }
      }
    }
  }

  @ViewBuilder
  private var emptyState: some View {
    if !isConnected {
      ContentUnavailableView(
        "Connect Lead Tracker", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
        description: Text("Add the Lead Tracker connection string in Settings to plan routes through your leads.")
      )
    } else if routes.isEmpty && isLoading {
      ProgressView()
    } else if routes.isEmpty && error == nil {
      ContentUnavailableView {
        Label("No Routes", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
      } description: {
        Text("Pick the leads you want to visit and get the quickest order to drive them.")
      } actions: {
        Button("New Route") { showNew = true }
          .buttonStyle(.borderedProminent)
      }
    }
  }

  private func load() async {
    guard isConnected else {
      isLoading = false
      return
    }
    defer { isLoading = false }
    do {
      let loaded = try await RoutePlanner.fetchRoutes()
      withAnimation { routes = loaded }
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func delete(_ route: RouteSummary) async {
    let previous = routes
    withAnimation { routes.removeAll { $0.id == route.id } }
    do {
      try await RoutePlanner.delete(routeID: route.id)
    } catch {
      withAnimation { routes = previous }
      self.error = error.localizedDescription
    }
  }
}

private struct RouteSummaryRow: View {
  let route: RouteSummary

  var body: some View {
    HStack(spacing: 12) {
      Gauge(value: route.totalStops == 0 ? 0 : Double(route.doneStops) / Double(route.totalStops)) {
        EmptyView()
      } currentValueLabel: {
        Text("\(route.doneStops)")
      }
      .gaugeStyle(.accessoryCircularCapacity)
      .tint(route.routeStatus == .done ? .green : .blue)
      .scaleEffect(0.7)
      .frame(width: 40, height: 40)

      VStack(alignment: .leading, spacing: 2) {
        Text(route.name)
        Text("\(route.doneStops) of \(route.totalStops) stops · \(route.createdAt.formatted(.dateTime.month(.abbreviated).day()))")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    }
  }
}
