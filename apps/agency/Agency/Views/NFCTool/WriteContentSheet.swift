import SwiftUI

/// Asks what to write: free URL/text, or a Google review link for a searched business.
/// Nothing is saved; the chosen content is handed back through `onWrite`.
struct WriteContentSheet: View {
  @Environment(\.dismiss) private var dismiss

  @Binding var input: String
  let onWrite: (NFCContent) -> Void

  @State private var useReviewLink = false
  @State private var query = ""
  @State private var results: [PlaceResult] = []
  @State private var selected: PlaceResult?
  @State private var isLoading = false
  @State private var errorMessage: String?
  @State private var showSettings = false
  @FocusState private var focused: Bool

  private var hasKey: Bool { Keychain.get(.placesAPIKey) != nil }

  private var content: NFCContent? {
    if useReviewLink {
      return selected.map { .url(ReviewLink.url(placeID: $0.id)) }
    }
    return NFCToolView.content(from: input)
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Toggle("Google Review Link", isOn: $useReviewLink.animation())
        } footer: {
          Text(useReviewLink
            ? "Search a business and pick it. The card opens its Google “write a review” pop-up."
            : "Links like example.com are saved as https URLs. Anything else is saved as plain text.")
        }

        if useReviewLink {
          reviewSections
        } else {
          Section {
            TextField("URL or text", text: $input, axis: .vertical)
              .focused($focused)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .keyboardType(.URL)
          }
        }

        if let errorMessage {
          Section {
            Label(errorMessage, systemImage: "exclamationmark.triangle")
              .foregroundStyle(.red)
          }
        }
      }
      .navigationTitle("Write to Card")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Write") {
            guard let content else { return }
            onWrite(content)
            dismiss()
          }
          .disabled(content == nil)
        }
      }
      .sheet(isPresented: $showSettings) { SettingsView() }
      .onChange(of: useReviewLink) { _, _ in
        errorMessage = nil
        focused = true
      }
      .onAppear { focused = true }
    }
  }

  // MARK: Review link

  @ViewBuilder private var reviewSections: some View {
    if !hasKey {
      Section {
        Button("Add Places API key in Settings") { showSettings = true }
      }
    }

    if let selected {
      Section {
        PlaceRow(place: selected)
        LabeledContent("Review Link") {
          Text(ReviewLink.url(placeID: selected.id).absoluteString)
            .font(.footnote.monospaced())
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.trailing)
            .textSelection(.enabled)
        }
        Button("Choose Another Business") {
          withAnimation { self.selected = nil }
        }
      } header: {
        Text("Selected")
      }
    } else {
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
              withAnimation { selected = place }
            } label: {
              PlaceRow(place: place)
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
  }

  private func runSearch() async {
    let text = query.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else { return }
    isLoading = true
    errorMessage = nil
    defer { isLoading = false }
    do {
      results = try await PlacesService.search(text)
      if results.isEmpty { errorMessage = "No places found." }
    } catch {
      errorMessage = error.localizedDescription
    }
  }
}
