import SwiftUI

struct SettingsView: View {
  @Environment(\.dismiss) private var dismiss
  @State private var apiKey = Keychain.get(.placesAPIKey) ?? ""
  @State private var testState: TestState = .idle
  @State private var databaseURL = Keychain.get(.leadTrackerURL) ?? ""
  @State private var dbTest: TestState = .idle
  @State private var routesTest: TestState = .idle
  @State private var cloudflareToken = Keychain.get(.cloudflareToken) ?? ""
  @State private var cloudflareAccount = Keychain.get(.cloudflareAccountID) ?? ""
  @State private var sitesTest: TestState = .idle
  @State private var isRefreshingSites = false
  @State private var siteStats: SiteCache.Stats?
  @State private var confirmClearSites = false
  @AppStorage(RouteSettings.visitMinutesKey) private var visitMinutes = RouteSettings.defaultVisitMinutes

  private enum TestState: Equatable {
    case idle, testing, ok(String), failed(String)
  }

  var body: some View {
    NavigationStack {
      Form {
        leadTrackerSection

        Section {
          SecureField("API key", text: $apiKey)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onChange(of: apiKey) { _, value in
              Keychain.set(.placesAPIKey, value)
              testState = .idle
            }
          Button {
            Task { await testKey() }
          } label: {
            HStack {
              Text("Test key")
              Spacer()
              switch testState {
              case .idle: EmptyView()
              case .testing: ProgressView()
              case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
              case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
              }
            }
          }
          .disabled(apiKey.isEmpty || testState == .testing)
        } header: {
          Text("Google Places")
        } footer: {
          VStack(alignment: .leading, spacing: 6) {
            switch testState {
            case .ok(let name): Text("Key works. Looked up “\(name)”.")
            case .failed(let message): Text(message).foregroundStyle(.red)
            default: Text("Used to search businesses, look up place IDs and order Smart Route stops. Enable “Places API (New)” and “Routes API” on the key in Google Cloud.")
            }
            Link("Open Google Cloud credentials", destination: URL(string: "https://console.cloud.google.com/google/maps-apis/credentials")!)
              .font(.footnote)
          }
        }

        Section {
          Stepper(value: $visitMinutes, in: 1...60) {
            LabeledContent("Time at each stop", value: "\(visitMinutes) min")
          }
          Button {
            Task { await testRoutes() }
          } label: {
            HStack {
              Text("Test Routes API")
              Spacer()
              switch routesTest {
              case .idle: EmptyView()
              case .testing: ProgressView()
              case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
              case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
              }
            }
          }
          .disabled(apiKey.isEmpty || routesTest == .testing)
        } header: {
          Text("Smart Route")
        } footer: {
          switch routesTest {
          case .ok(let summary): Text(summary)
          case .failed(let message): Text(message).foregroundStyle(.red)
          default: Text("Added to every stop's arrival time. Routes use the Google key above.")
          }
        }

        clientWebsitesSection

        Section("About") {
          LabeledContent("Version", value: Bundle.main.shortVersion)
          LabeledContent("NFC", value: NFCService().isAvailable ? "Available" : "Not on this device")
        }
      }
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
  }

  private var clientWebsitesSection: some View {
    Section {
      SecureField("R2 API token (cfat_…)", text: $cloudflareToken)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .onChange(of: cloudflareToken) { _, value in
          Keychain.set(.cloudflareToken, value)
          Keychain.set(.r2AccessKeyID, "")
          sitesTest = .idle
        }
      TextField("Account ID", text: $cloudflareAccount)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .font(.subheadline)
        .onChange(of: cloudflareAccount) { _, value in
          Keychain.set(.cloudflareAccountID, value)
          Keychain.set(.r2AccessKeyID, "")
        }
      Button {
        Task { await testSites() }
      } label: {
        HStack {
          Text("Test connection")
          Spacer()
          switch sitesTest {
          case .idle: EmptyView()
          case .testing: ProgressView()
          case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
          case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
          }
        }
      }
      .disabled(cloudflareToken.isEmpty || sitesTest == .testing)

      Button {
        Task { await refreshSites() }
      } label: {
        HStack {
          Label("Refresh now", systemImage: "arrow.clockwise")
          Spacer()
          if isRefreshingSites { ProgressView() }
        }
      }
      .disabled(cloudflareToken.isEmpty || isRefreshingSites)

      if let siteStats {
        LabeledContent("Last refreshed") {
          Text(siteStats.refreshedAt.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Never")
        }
        LabeledContent("Saved offline") {
          Text("\(siteStats.cachedSites) of \(siteStats.totalSites) sites · \(siteStats.bytes.formatted(.byteCount(style: .file)))")
        }
        Button("Clear Cache", role: .destructive) { confirmClearSites = true }
          .disabled(siteStats.bytes == 0)
      }
    } header: {
      Text("Client Websites")
    } footer: {
      switch sitesTest {
      case .ok(let summary): Text(summary)
      case .failed(let message): Text(message).foregroundStyle(.red)
      default:
        Text("Reads the client-websites R2 bucket. Sites are kept offline until you tap Refresh now. Token: R2 → Manage API tokens → Object Read only on client-websites; paste its Token value. Account ID is on the R2 overview page.")
      }
    }
    .task { siteStats = await SiteCache.shared.stats() }
    .confirmationDialog("Clear saved websites?", isPresented: $confirmClearSites, titleVisibility: .visible) {
      Button("Clear Cache", role: .destructive) {
        Task {
          await SiteCache.shared.clear()
          siteStats = await SiteCache.shared.stats()
        }
      }
    } message: {
      Text("They download again the next time you open them.")
    }
  }

  private func testSites() async {
    sitesTest = .testing
    do {
      let folders = try await R2Client.listFolders()
      let sites = folders.compactMap(ClientSite.init(folder:))
      cloudflareAccount = Keychain.get(.cloudflareAccountID) ?? cloudflareAccount
      sitesTest = .ok("Connected. \(sites.count) client websites.")
    } catch {
      sitesTest = .failed(error.localizedDescription)
    }
  }

  private func refreshSites() async {
    isRefreshingSites = true
    defer { isRefreshingSites = false }
    do {
      let at = try await SiteCache.shared.refreshAll()
      sitesTest = .ok("Refreshed \(at.formatted(date: .omitted, time: .shortened)).")
    } catch {
      sitesTest = .failed(error.localizedDescription)
    }
    siteStats = await SiteCache.shared.stats()
  }

  private var leadTrackerSection: some View {
    Section {
      SecureField("postgresql://agency_ios:…", text: $databaseURL)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .onChange(of: databaseURL) { _, value in
          Keychain.set(.leadTrackerURL, value)
          dbTest = .idle
        }
      Button {
        Task { await testDatabase() }
      } label: {
        HStack {
          Text("Test connection")
          Spacer()
          switch dbTest {
          case .idle: EmptyView()
          case .testing: ProgressView()
          case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
          case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
          }
        }
      }
      .disabled(databaseURL.isEmpty || dbTest == .testing)
    } header: {
      Text("Lead Tracker")
    } footer: {
      switch dbTest {
      case .ok(let summary): Text(summary)
      case .failed(let message): Text(message).foregroundStyle(.red)
      default:
        Text("Connection string for the agency_ios role on the Lead Tracker Neon database. It can read lead basics and change only status, review link and card time.")
      }
    }
  }

  private func testDatabase() async {
    dbTest = .testing
    do {
      let leads = try await LeadTracker.fetchLeads(connectionString: databaseURL.trimmingCharacters(in: .whitespacesAndNewlines))
      dbTest = .ok("Connected. \(leads.count) leads.")
    } catch {
      dbTest = .failed(error.localizedDescription)
    }
  }

  private func testRoutes() async {
    routesTest = .testing
    do {
      // Two Googleplex-area points: proves the key can call Routes with stop ordering.
      let route = try await RoutesService.compute(
        from: Coordinate(lat: 37.4220, lng: -122.0841),
        to: .coordinate(Coordinate(lat: 37.4220, lng: -122.0841)),
        via: [.coordinate(Coordinate(lat: 37.4275, lng: -122.1697)), .coordinate(Coordinate(lat: 37.3861, lng: -122.0839))],
        optimize: true
      )
      routesTest = .ok("Routes API works. Test loop: \(route.durationSeconds / 60) min.")
    } catch {
      routesTest = .failed(error.localizedDescription)
    }
  }

  private func testKey() async {
    testState = .testing
    do {
      // Googleplex: a stable place ID that always resolves.
      let place = try await PlacesService.details(placeID: "ChIJj61dQgK6j4AR4GeTYWZsKWw")
      testState = .ok(place.name)
    } catch {
      testState = .failed(error.localizedDescription)
    }
  }
}

extension Bundle {
  var shortVersion: String {
    let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
    let build = infoDictionary?["CFBundleVersion"] as? String ?? "?"
    return "\(version) (\(build))"
  }
}

#Preview {
  SettingsView()
}
