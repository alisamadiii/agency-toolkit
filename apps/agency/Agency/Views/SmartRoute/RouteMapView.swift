import MapKit
import SwiftUI

/// The driving screen: map with the ordered stops on top, the current stop and actions below.
/// Modelled on SoloRoute: Navigate hands off to Google Maps, then mark the stop Visited or Failed.
struct RouteMapView: View {
  let ref: RouteRef

  @State private var session: RouteSession
  @State private var camera: MapCameraPosition = .automatic
  @State private var visitedStop: RouteStop?
  @State private var failedStop: RouteStop?
  @State private var showStops = false
  @State private var showAdd = false
  @State private var showRename = false
  @State private var draftName = ""
  /// R2 website for the current stop's lead, if one was uploaded.
  @State private var currentSite: ClientSite?

  init(ref: RouteRef) {
    self.ref = ref
    _session = State(initialValue: RouteSession(routeID: ref.id))
  }

  static let failureReasons = ["Closed", "Owner not in", "Not interested", "Wrong address", "Other"]

  var body: some View {
    mapLayer
      .confirmationDialog(
        "Visited \(visitedStop?.name ?? "")",
        isPresented: Binding(get: { visitedStop != nil }, set: { if !$0 { visitedStop = nil } }),
        titleVisibility: .visible,
        presenting: visitedStop
      ) { stop in
        Button("Keep \(stop.lead?.title ?? "Status")") {
          Task { await session.markVisited(stop, leadStatus: nil) }
        }
        ForEach(LeadStatus.allCases.filter { $0 != .hidden && $0.rawValue != stop.leadStatus }) { status in
          Button("Set to \(status.title)") {
            Task { await session.markVisited(stop, leadStatus: status) }
          }
        }
      } message: { _ in
        Text("Update this lead's status in Lead Tracker?")
      }
      .confirmationDialog(
        "Couldn't visit \(failedStop?.name ?? "")",
        isPresented: Binding(get: { failedStop != nil }, set: { if !$0 { failedStop = nil } }),
        titleVisibility: .visible,
        presenting: failedStop
      ) { stop in
        Button("Retry Later Today") {
          Task { await session.markFailed(stop, reason: "Retry later", retryLater: true) }
        }
        ForEach(Self.failureReasons, id: \.self) { reason in
          Button(reason, role: .destructive) {
            Task { await session.markFailed(stop, reason: reason, retryLater: false) }
          }
        }
      } message: { _ in
        Text("Retry moves the stop to the end of the route. A reason skips it.")
      }
      .sheet(isPresented: $showStops) {
        RouteStopsSheet(session: session)
      }
      .sheet(isPresented: $showAdd) {
        AddStopsView(
          excluding: Set(session.stops.map(\.placeID)),
          remaining: max(0, RoutesService.maxStops - session.pending.count)
        ) { ids in
          Task { await session.addStops(ids) }
        }
      }
      .alert("Rename Route", isPresented: $showRename) {
        TextField("Name", text: $draftName)
        Button("Cancel", role: .cancel) {}
        Button("Save") { Task { await session.rename(draftName) } }
      }
  }

  private var mapLayer: some View {
    Map(position: $camera) {
      UserAnnotation()
      mapContent
    }
    .mapControls {
      MapUserLocationButton()
      MapCompass()
    }
    .safeAreaInset(edge: .bottom, spacing: 0) { panel }
    .navigationTitle(session.route?.name ?? ref.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { toolbarMenu }
    .task { await session.load() }
    .task(id: session.currentStop?.placeID) { await loadCurrentSite() }
    .onChange(of: session.route?.optimizedEpoch) {
      withAnimation { camera = .automatic }
    }
    .sensoryFeedback(trigger: session.feedback.id) {
      session.feedback.success ? .success : .warning
    }
  }

  private func loadCurrentSite() async {
    var site: ClientSite?
    if let placeID = session.currentStop?.placeID {
      site = await SiteCache.shared.site(for: placeID)
    }
    withAnimation(.snappy) { currentSite = site }
  }

  // MARK: - Map

  @MapContentBuilder
  private var mapContent: some MapContent {
    let ordered = session.ordered
    ForEach(ordered) { stop in
      if let polyline = stop.legPolyline {
        MapPolyline(coordinates: session.coordinates(polyline))
          .stroke(stop.isPending ? Color.blue : Color.blue.opacity(0.35),
                  style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
      }
    }
    if let polyline = session.route?.returnPolyline {
      MapPolyline(coordinates: session.coordinates(polyline))
        .stroke(Color.blue, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
    }

    if let start = session.start, !session.startsAtEnd {
      Annotation("Start", coordinate: start.clLocation, anchor: .center) {
        EndpointPin(symbol: nil)
      }
      .annotationTitles(.hidden)
    }
    if let end = session.end {
      Annotation("Home", coordinate: end.clLocation, anchor: .center) {
        EndpointPin(symbol: "house.fill")
      }
      .annotationTitles(.hidden)
    }

    ForEach(session.mapStops) { stop in
      Annotation(stop.name, coordinate: CLLocationCoordinate2D(latitude: stop.lat, longitude: stop.lng),
                 anchor: .center) {
        StopBadge(number: number(of: stop), status: stop.stopStatus,
                  size: stop.id == session.currentStop?.id ? 36 : 28,
                  isCurrent: stop.id == session.currentStop?.id)
      }
      .annotationTitles(stop.id == session.currentStop?.id ? .automatic : .hidden)
    }
  }

  // MARK: - Bottom panel

  private var panel: some View {
    VStack(alignment: .leading, spacing: 14) {
      header

      if let error = session.error {
        HStack(alignment: .firstTextBaseline) {
          Label(error, systemImage: "exclamationmark.triangle.fill")
            .font(.footnote)
            .foregroundStyle(.red)
          Spacer(minLength: 8)
          Button("Retry") { Task { await session.optimize() } }
            .font(.footnote.bold())
        }
      }

      if let stop = session.currentStop {
        Button {
          showStops = true
        } label: {
          CurrentStopCard(stop: stop, number: number(of: stop), eta: session.etas[stop.id],
                          reservesAccessory: currentSite != nil)
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottomTrailing) {
          if let currentSite {
            WebsitePreviewButton(site: currentSite)
              .padding(12)
              .transition(.opacity)
          }
        }

        if let next = session.upNext.first {
          VStack(alignment: .leading, spacing: 6) {
            Text("UP NEXT")
              .font(.caption.weight(.semibold))
              .foregroundStyle(.secondary)
            StopLine(stop: next, number: number(of: next), eta: session.etas[next.id])
          }
        }

        Button {
          session.navigate()
        } label: {
          Label("Navigate", systemImage: "location.north.fill")
            .font(.headline)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)

        HStack(spacing: 12) {
          Button {
            failedStop = stop
          } label: {
            Label("Failed", systemImage: "xmark")
              .font(.headline)
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.bordered)
          .tint(.red)

          Button {
            visitedStop = stop
          } label: {
            Label("Visited", systemImage: "checkmark")
              .font(.headline)
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .tint(.green)
        }
        .controlSize(.large)
      } else if !session.stops.isEmpty {
        finishedSection
      } else if session.isLoading {
        ProgressView().frame(maxWidth: .infinity)
      }
    }
    .padding(.horizontal)
    .padding(.top, 16)
    .padding(.bottom, 8)
    .background {
      UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22)
        .fill(Color(.systemBackground))
        .shadow(color: .black.opacity(0.12), radius: 10, y: -2)
        .ignoresSafeArea(edges: .bottom)
    }
    .disabled(session.isOptimizing)
  }

  private var header: some View {
    HStack(alignment: .center, spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        Group {
          if session.isOptimizing {
            HStack(spacing: 6) {
              ProgressView().controlSize(.small)
              Text("Finding the fastest order…")
            }
          } else if let finish = session.finishETA {
            Text("\(session.doneCount)/\(session.stops.count) · done ~\(finish.formatted(date: .omitted, time: .shortened))")
          } else {
            Text("\(session.doneCount)/\(session.stops.count) stops")
          }
        }
        .font(.headline)
        .monospacedDigit()
        ProgressView(value: session.progress)
          .tint(.green)
          .animation(.snappy, value: session.progress)
      }
      Spacer(minLength: 4)
      Button {
        showAdd = true
      } label: {
        Label("Add stop", systemImage: "plus")
      }
      .buttonStyle(.bordered)
      .buttonBorderShape(.capsule)
      .disabled(session.isFinished || session.pending.count >= RoutesService.maxStops)
    }
  }

  @ViewBuilder
  private var finishedSection: some View {
    VStack(spacing: 12) {
      Label(session.isFinished ? "Route finished" : "All stops done",
            systemImage: "checkmark.circle.fill")
        .font(.title3.bold())
        .foregroundStyle(.green)
        .frame(maxWidth: .infinity)
      let visited = session.stops.filter { $0.stopStatus == .visited }.count
      Text("\(visited) visited · \(session.stops.count - visited) failed")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)

      if session.end != nil {
        Button {
          session.navigate()
        } label: {
          Label("Drive Home", systemImage: "house.fill")
            .font(.headline)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
      }
      if !session.isFinished {
        Button {
          Task { await session.finish() }
        } label: {
          Text("Finish Route")
            .font(.headline)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(.green)
        .controlSize(.large)
      }
    }
  }

  private var toolbarMenu: some ToolbarContent {
    ToolbarItem(placement: .topBarTrailing) {
      Menu {
        Button("All Stops", systemImage: "list.number") { showStops = true }
        Button("Re-optimize", systemImage: "arrow.triangle.swap") {
          Task { await session.optimize() }
        }
        .disabled(session.pending.count < 2 || session.isOptimizing)
        Button("Rename", systemImage: "pencil") {
          draftName = session.route?.name ?? ref.name
          showRename = true
        }
        Divider()
        if session.isFinished {
          Button("Reopen Route", systemImage: "arrow.uturn.backward") { Task { await session.reopen() } }
        } else {
          Button("Finish Route", systemImage: "flag.checkered") { Task { await session.finish() } }
        }
      } label: {
        Image(systemName: "ellipsis.circle")
      }
    }
  }

  private func number(of stop: RouteStop) -> Int {
    (session.ordered.firstIndex { $0.id == stop.id } ?? 0) + 1
  }
}

private struct CurrentStopCard: View {
  let stop: RouteStop
  let number: Int
  let eta: Date?
  /// Leaves room under "arriving" for the Website button drawn on top.
  var reservesAccessory = false

  var body: some View {
    HStack(spacing: 14) {
      StopBadge(number: number, status: stop.stopStatus, size: 44)
      VStack(alignment: .leading, spacing: 2) {
        Text(stop.name)
          .font(.title3.weight(.semibold))
          .lineLimit(2)
        if let street = stop.street {
          Text(street)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      if let eta {
        VStack(alignment: .trailing, spacing: 2) {
          Text(eta, format: .dateTime.hour().minute())
            .font(.headline)
            .monospacedDigit()
          Text("arriving")
            .font(.caption)
            .foregroundStyle(.secondary)
          if reservesAccessory {
            Color.clear.frame(width: 1, height: 26)
          }
        }
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    .contentShape(RoundedRectangle(cornerRadius: 14))
  }
}

/// Compact stop row: badge, name, street and ETA or outcome.
struct StopLine: View {
  let stop: RouteStop
  let number: Int
  let eta: Date?

  var body: some View {
    HStack(spacing: 12) {
      StopBadge(number: number, status: stop.stopStatus, size: 26)
      VStack(alignment: .leading, spacing: 1) {
        Text(stop.name).lineLimit(1)
        if let street = stop.street {
          Text(street)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      switch stop.stopStatus {
      case .pending:
        if let eta {
          Text(eta, format: .dateTime.hour().minute())
            .font(.subheadline)
            .monospacedDigit()
            .foregroundStyle(.secondary)
        }
      case .visited:
        Text("Visited").font(.caption).foregroundStyle(.green)
      case .failed:
        Text(stop.failureReason ?? "Failed").font(.caption).foregroundStyle(.red)
      }
    }
  }
}

/// Every stop in order. Done stops can be undone.
private struct RouteStopsSheet: View {
  let session: RouteSession
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        let ordered = session.ordered
        let pending = ordered.filter(\.isPending)
        let done = ordered.filter { !$0.isPending }
        if !pending.isEmpty {
          Section("To Visit") {
            ForEach(pending) { stop in
              StopLine(stop: stop, number: number(stop, in: ordered), eta: session.etas[stop.id])
            }
          }
        }
        if !done.isEmpty {
          Section {
            ForEach(done) { stop in
              StopLine(stop: stop, number: number(stop, in: ordered), eta: nil)
                .swipeActions {
                  Button("Undo", systemImage: "arrow.uturn.backward") {
                    Task { await session.undo(stop) }
                  }
                  .tint(.orange)
                }
                .contextMenu {
                  Button("Undo", systemImage: "arrow.uturn.backward") {
                    Task { await session.undo(stop) }
                  }
                }
            }
          } header: {
            Text("Done")
          } footer: {
            Text("Swipe left on a stop to put it back on the route.")
          }
        }
      }
      .navigationTitle("\(session.stops.count) Stops")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func number(_ stop: RouteStop, in ordered: [RouteStop]) -> Int {
    (ordered.firstIndex { $0.id == stop.id } ?? 0) + 1
  }
}
