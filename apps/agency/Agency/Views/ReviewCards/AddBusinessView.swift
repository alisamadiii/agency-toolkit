import SwiftData
import SwiftUI

/// Finds a place on Google and saves it to Lead Tracker as a lead.
struct AddBusinessView: View {
  @Environment(\.modelContext) private var context
  @Environment(\.dismiss) private var dismiss
  @Environment(LeadSync.self) private var leadSync

  private enum Mode: String, CaseIterable, Identifiable {
    case search = "Search"
    case placeID = "Place ID"
    var id: Self { self }
  }

  @State private var mode: Mode = .search
  @State private var query = ""
  @State private var placeID = ""
  @State private var results: [PlaceResult] = []
  @State private var selected: PlaceResult?
  @State private var category = ""
  @State private var categories: [String] = []
  @State private var status: LeadStatus = .new
  @State private var isLoading = false
  @State private var isSaving = false
  @State private var errorMessage: String?
  @State private var showSettings = false
  @FocusState private var focused: Bool

  private var hasKey: Bool { Keychain.get(.placesAPIKey) != nil }

  var body: some View {
    NavigationStack {
      Form {
        if let selected {
          confirmSections(selected)
        } else {
          Picker("Find by", selection: $mode) {
            ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
          }
          .pickerStyle(.segmented)
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets())

          if !hasKey {
            Section {
              Button("Add Places API key in Settings") { showSettings = true }
            } footer: {
              Text("Searching and looking up a place ID both call Google Places.")
            }
          }

          switch mode {
          case .search: searchSections
          case .placeID: placeIDSections
          }
        }

        if let errorMessage {
          Section {
            Label(errorMessage, systemImage: "exclamationmark.triangle")
              .foregroundStyle(.red)
          }
        }
      }
      .navigationTitle(selected == nil ? "Add Lead" : "New Lead")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          if selected != nil {
            Button("Back") { withAnimation { selected = nil } }
          } else {
            Button("Cancel") { dismiss() }
          }
        }
        if let selected {
          ToolbarItem(placement: .confirmationAction) {
            if isSaving {
              ProgressView()
            } else {
              Button("Add") { Task { await save(selected) } }
                .disabled(category.isEmpty)
            }
          }
        }
      }
      .sheet(isPresented: $showSettings) { SettingsView() }
      .onChange(of: mode) { _, _ in errorMessage = nil }
      .onAppear { focused = true }
      .interactiveDismissDisabled(isSaving)
    }
  }

  // MARK: Search

  @ViewBuilder private var searchSections: some View {
    Section {
      HStack {
        TextField("Business name and city", text: $query)
          .focused($focused)
          .submitLabel(.search)
          .onSubmit { Task { await runSearch() } }
        if isLoading { ProgressView() }
      }
    } footer: {
      Text("Example: “Salah Barbershop Jacksonville”")
    }

    if !results.isEmpty {
      Section("Results") {
        ForEach(results) { place in
          Button {
            Task { await choose(place) }
          } label: {
            PlaceRow(place: place)
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  // MARK: Place ID

  @ViewBuilder private var placeIDSections: some View {
    Section {
      HStack {
        TextField("ChIJ…", text: $placeID)
          .focused($focused)
          .font(.body.monospaced())
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.go)
          .onSubmit { Task { await lookUp() } }
        if placeID.isEmpty {
          Button("Paste") {
            placeID = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            Task { await lookUp() }
          }
          .buttonStyle(.borderless)
        } else {
          Button {
            placeID = ""
          } label: {
            Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
          }
          .buttonStyle(.borderless)
        }
      }
      Button {
        Task { await lookUp() }
      } label: {
        HStack {
          Text("Look up")
          Spacer()
          if isLoading { ProgressView() }
        }
      }
      .disabled(placeID.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
    }
  }

  // MARK: Confirm

  @ViewBuilder private func confirmSections(_ place: PlaceResult) -> some View {
    Section {
      PlaceRow(place: place)
    }
    if alreadyLead(place) {
      Section {
        Label("Already in Lead Tracker.", systemImage: "info.circle")
          .foregroundStyle(.secondary)
      }
    }
    Section {
      Picker("Category", selection: $category) {
        ForEach(categories, id: \.self) { Text($0.capitalized).tag($0) }
      }
      Picker("Status", selection: $status) {
        ForEach(LeadStatus.allCases.filter { $0 != .hidden }) { status in
          Label(status.title, systemImage: status.symbol).tag(status)
        }
      }
    } footer: {
      Text("Saved to Lead Tracker like any lead the daily search finds. Set a status other than New if Claude shouldn't design it.")
    }
  }

  // MARK: Actions

  private func runSearch() async {
    let text = query.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else { return }
    await load { results = try await PlacesService.search(text) }
    if results.isEmpty, errorMessage == nil { errorMessage = "No places found." }
  }

  private func lookUp() async {
    await load {
      let place = try await PlacesService.details(placeID: placeID)
      try await prepare(place)
    }
  }

  private func choose(_ place: PlaceResult) async {
    await load { try await prepare(place) }
  }

  /// Search results already carry location and type, so no second Places call is needed.
  private func prepare(_ place: PlaceResult) async throws {
    let settings = try await leadSync.loadSettings()
    let known = Set(settings.categories + leadCategories())
    categories = known.sorted()
    category = LeadTracker.guessCategory(primaryType: place.primaryType, from: categories)
    status = .new
    withAnimation { selected = place }
  }

  private func save(_ place: PlaceResult) async {
    isSaving = true
    errorMessage = nil
    defer { isSaving = false }
    do {
      try await leadSync.add(place, category: category, status: status, context: context)
      UINotificationFeedbackGenerator().notificationOccurred(.success)
      dismiss()
    } catch {
      errorMessage = error.localizedDescription
      UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
  }

  private func load(_ work: () async throws -> Void) async {
    isLoading = true
    errorMessage = nil
    defer { isLoading = false }
    do { try await work() } catch { errorMessage = error.localizedDescription }
  }

  private func leadCategories() -> [String] {
    let all = (try? context.fetch(FetchDescriptor<Business>())) ?? []
    return all.compactMap(\.category)
  }

  private func alreadyLead(_ place: PlaceResult) -> Bool {
    let id = place.id
    var descriptor = FetchDescriptor<Business>(predicate: #Predicate { $0.placeID == id && $0.isLead })
    descriptor.fetchLimit = 1
    return ((try? context.fetchCount(descriptor)) ?? 0) > 0
  }
}

struct PlaceRow: View {
  let place: PlaceResult

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(place.name)
        .foregroundStyle(.primary)
      if !place.address.isEmpty {
        Text(place.address)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      if let rating = place.rating {
        HStack(spacing: 4) {
          Image(systemName: "star.fill").font(.caption2)
          Text(rating, format: .number.precision(.fractionLength(1)))
          if let count = place.ratingCount {
            Text("(\(count))")
          }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 2)
    .contentShape(Rectangle())
  }
}
