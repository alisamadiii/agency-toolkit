import SwiftData
import SwiftUI

struct BusinessDetailView: View {
  @Environment(\.modelContext) private var context
  @Environment(LeadSync.self) private var leadSync
  @Bindable var business: Business
  @State private var pendingStatus: LeadStatus?
  @State private var programmer: CardProgrammer?
  @State private var copied = false
  @State private var renaming: NFCCard?
  @State private var renameText = ""
  @State private var pendingDelete: NFCCard?

  var body: some View {
    List {
      headerSection
      if business.isLead {
        statusSection
      }
      if SiteCache.isConfigured {
        Section("Website") {
          LeadWebsiteRow(placeID: business.placeID)
        }
      }
      linkSection
      if let programmer {
        actionsSection(programmer)
      }
      cardsSection
    }
    .navigationTitle(business.name)
    .navigationBarTitleDisplayMode(.inline)
    .onAppear {
      if programmer == nil {
        programmer = CardProgrammer(business: business, context: context)
      }
    }
    .alert("Rename card", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
      TextField("Label", text: $renameText)
      Button("Save") {
        renaming?.label = renameText.trimmingCharacters(in: .whitespaces)
        renaming = nil
      }
      Button("Cancel", role: .cancel) { renaming = nil }
    }
    .confirmationDialog(
      "Forget \(pendingDelete?.label ?? "card")?",
      isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
      titleVisibility: .visible
    ) {
      Button("Forget", role: .destructive) {
        if let card = pendingDelete {
          withAnimation { context.delete(card) }
        }
        pendingDelete = nil
      }
    } message: {
      Text("Only the record is removed. The card itself keeps its link.")
    }
  }

  // MARK: Sections

  private var headerSection: some View {
    Section {
      VStack(alignment: .leading, spacing: 4) {
        Text(business.name).font(.headline)
        if let category = business.categoryTitle {
          Text(category.capitalized).font(.subheadline).foregroundStyle(.secondary)
        }
        if !business.address.isEmpty {
          Text(business.address).font(.subheadline).foregroundStyle(.secondary)
        }
        if let rating = business.rating {
          HStack(spacing: 4) {
            Image(systemName: "star.fill").font(.caption2)
            Text(rating, format: .number.precision(.fractionLength(1)))
            if let count = business.ratingCount { Text("· \(count) reviews") }
          }
          .font(.caption)
          .foregroundStyle(.secondary)
        }
      }
      .padding(.vertical, 2)
    }
  }

  private var statusSection: some View {
    Section {
      Picker(selection: Binding(
        get: { business.status ?? .new },
        set: { status in
          if status == .hidden {
            pendingStatus = status
          } else {
            UISelectionFeedbackGenerator().selectionChanged()
            Task { await leadSync.setStatus(status, for: business) }
          }
        }
      )) {
        ForEach(LeadStatus.allCases) { status in
          Label(status.title, systemImage: status.symbol).tag(status)
        }
      } label: {
        Label("Status", systemImage: (business.status ?? .new).symbol)
          .foregroundStyle((business.status ?? .new).tint)
      }
      .pickerStyle(.menu)
    } footer: {
      if let error = leadSync.error {
        Text(error).foregroundStyle(.red)
      } else {
        Text("Saved to Lead Tracker. Anything but New keeps Claude from picking this lead for a design.")
      }
    }
    .confirmationDialog(
      "Hide \(business.name)?",
      isPresented: Binding(get: { pendingStatus != nil }, set: { if !$0 { pendingStatus = nil } }),
      titleVisibility: .visible
    ) {
      Button("Hide Lead", role: .destructive) {
        Task { await leadSync.setStatus(.hidden, for: business) }
        pendingStatus = nil
      }
    } message: {
      Text("Hidden leads drop out of the list here and in Lead Finder.")
    }
  }

  private var linkSection: some View {
    Section {
      Text(business.reviewURL.absoluteString)
        .font(.footnote.monospaced())
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
      Button {
        UIPasteboard.general.url = business.reviewURL
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.spring) { copied = true }
        Task {
          try? await Task.sleep(for: .seconds(1.5))
          withAnimation(.spring) { copied = false }
        }
      } label: {
        Label(copied ? "Copied" : "Copy Link", systemImage: copied ? "checkmark" : "doc.on.doc")
          .contentTransition(.symbolEffect(.replace))
      }
      ShareLink(item: business.reviewURL) {
        Label("Share Link", systemImage: "square.and.arrow.up")
      }
      Link(destination: business.reviewURL) {
        Label("Open in Safari", systemImage: "safari")
      }
    } header: {
      Text("Review Link")
    } footer: {
      Text("Opens the Google review box on top of the business profile.")
    }
  }

  private func actionsSection(_ programmer: CardProgrammer) -> some View {
    Section {
      Button {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task { await programmer.write() }
      } label: {
        Label("Write to Card", systemImage: "wave.3.right")
      }
      Button {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task { await programmer.verify() }
      } label: {
        Label("Verify Card", systemImage: "checkmark.shield")
      }
      if let outcome = programmer.outcome {
        OutcomeRow(outcome: outcome) {
          Task { await programmer.write() }
        }
        .transition(.move(edge: .top).combined(with: .opacity))
      }
    } header: {
      Text("NFC")
    } footer: {
      if !programmer.nfcAvailable {
        Text("NFC isn't available on this device. Use a real iPhone.")
      } else if let note = programmer.syncNote {
        Text(note)
      } else {
        Text("Write puts the review link on a blank or old card. Verify reads a card and checks it points here. Cards are never locked.")
      }
    }
    .disabled(!programmer.nfcAvailable || programmer.isBusy)
    .animation(.spring, value: programmer.outcome)
  }

  private var cardsSection: some View {
    Section {
      if business.cards.isEmpty {
        Text("No cards written yet.")
          .foregroundStyle(.secondary)
      } else {
        ForEach(business.sortedCards) { card in
          CardRow(card: card)
            .swipeActions(edge: .trailing) {
              Button(role: .destructive) {
                pendingDelete = card
              } label: {
                Label("Forget", systemImage: "trash")
              }
              Button {
                renameText = card.label
                renaming = card
              } label: {
                Label("Rename", systemImage: "pencil")
              }
              .tint(.orange)
            }
        }
      }
    } header: {
      Text("Cards")
    }
  }
}

private struct OutcomeRow: View {
  let outcome: CardOutcome
  let rewrite: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label {
        VStack(alignment: .leading, spacing: 2) {
          Text(outcome.title)
          if let detail = outcome.detail {
            Text(detail)
              .font(.footnote.monospaced())
              .foregroundStyle(.secondary)
          }
        }
      } icon: {
        Image(systemName: outcome.symbol)
          .foregroundStyle(outcome.isGood ? .green : .red)
      }
      if outcome.offersRewrite {
        Button("Rewrite This Card", action: rewrite)
          .font(.subheadline)
      }
    }
    .padding(.vertical, 2)
  }
}

private struct CardRow: View {
  let card: NFCCard

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack {
        Text(card.label)
        Spacer()
        Text(card.uid)
          .font(.caption.monospaced())
          .foregroundStyle(.tertiary)
      }
      HStack(spacing: 4) {
        Text("Written \(card.writtenAt, format: .dateTime.day().month().year())")
        if let verified = card.lastVerifiedAt {
          Text("· Verified \(verified, format: .relative(presentation: .named))")
        }
      }
      .font(.caption)
      .foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
  }
}
