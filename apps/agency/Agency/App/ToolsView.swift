import SwiftUI

/// Every tool on the home list. New tools add a case here and a destination below.
enum Tool: Hashable {
  case reviewCards
  case smartRoute
}

/// Root screen: one row per tool.
/// All navigation destinations are registered here, on the root stack, so value-based
/// links deeper in the app (e.g. a business row) always resolve.
struct ToolsView: View {
  @State private var showSettings = false
  @State private var leadSync = LeadSync()
  @State private var router = Router()
  #if DEBUG
  @State private var debugSite: ClientSite?
  #endif

  var body: some View {
    NavigationStack(path: $router.path) {
      List {
        Section {
          NavigationLink(value: Tool.reviewCards) {
            ToolRow(
              title: "Leads",
              subtitle: "Lead Tracker, status and NFC review cards",
              symbol: "wave.3.right.circle.fill",
              tint: .blue
            )
          }
          NavigationLink(value: Tool.smartRoute) {
            ToolRow(
              title: "Smart Route",
              subtitle: "Plan and drive lead visits",
              symbol: "point.topleft.down.to.point.bottomright.curvepath.fill",
              tint: .green
            )
          }
        } footer: {
          Text("More tools will show up here as they are built.")
        }
      }
      .navigationTitle("Agency")
      .navigationDestination(for: Tool.self) { tool in
        switch tool {
        case .reviewCards: BusinessListView()
        case .smartRoute: RouteListView()
        }
      }
      .navigationDestination(for: Business.self) { business in
        BusinessDetailView(business: business)
      }
      .navigationDestination(for: RouteRef.self) { ref in
        RouteMapView(ref: ref)
      }
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            showSettings = true
          } label: {
            Image(systemName: "gearshape")
          }
          .accessibilityLabel("Settings")
        }
      }
      .sheet(isPresented: $showSettings) {
        SettingsView()
      }
    }
    .environment(leadSync)
    .environment(router)
    #if DEBUG
    // `SIMCTL_CHILD_AGENCY_SITE=<placeId>` opens that lead's client website on launch.
    .task {
      if let placeID = ProcessInfo.processInfo.environment["AGENCY_SITE"] {
        debugSite = await SiteCache.shared.site(for: placeID)
      }
    }
    .fullScreenCover(item: $debugSite) { ClientSiteView(site: $0) }
    #endif
    .onAppear {
      #if DEBUG
      // Simulator screenshots: `SIMCTL_CHILD_AGENCY_OPEN=reviewCards|smartRoute`
      // and `SIMCTL_CHILD_AGENCY_ROUTE=<route uuid>` to open a route's map.
      let env = ProcessInfo.processInfo.environment
      guard router.path.isEmpty else { return }
      switch env["AGENCY_OPEN"] {
      case "reviewCards": router.path.append(Tool.reviewCards)
      case "smartRoute":
        router.path.append(Tool.smartRoute)
        if let id = env["AGENCY_ROUTE"] { router.path.append(RouteRef(id: id, name: "Route")) }
      default: break
      }
      #endif
    }
  }
}

private struct ToolRow: View {
  let title: String
  let subtitle: String
  let symbol: String
  let tint: Color

  var body: some View {
    Label {
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
        Text(subtitle)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    } icon: {
      Image(systemName: symbol)
        .font(.title2)
        .foregroundStyle(tint)
    }
    .padding(.vertical, 4)
  }
}

#Preview {
  ToolsView()
    .modelContainer(for: [Business.self, NFCCard.self], inMemory: true)
}
