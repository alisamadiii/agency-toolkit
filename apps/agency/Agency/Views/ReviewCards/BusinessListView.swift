import SwiftData
import SwiftUI

struct BusinessListView: View {
  @Environment(\.modelContext) private var context
  @Environment(LeadSync.self) private var leadSync
  /// Nearest to home (566 Kit St) first; ties go to the stronger lead (review_count * rating).
  @Query(sort: [SortDescriptor(\Business.distanceMiles), SortDescriptor(\Business.score, order: .reverse)])
  private var businesses: [Business]

  @State private var statusFilter: LeadStatus?
  @State private var search = ""
  @State private var showAdd = false
  @State private var showSettings = false

  private var filtered: [Business] {
    let needle = search.trimmingCharacters(in: .whitespaces)
    return businesses.filter { business in
      guard business.isLead, business.status != .hidden else { return false }
      if let statusFilter, business.status != statusFilter { return false }
      guard !needle.isEmpty else { return true }
      return business.name.localizedCaseInsensitiveContains(needle)
        || business.address.localizedCaseInsensitiveContains(needle)
        || (business.category?.localizedCaseInsensitiveContains(needle) ?? false)
    }
  }

  var body: some View {
    List {
      ForEach(filtered) { business in
        NavigationLink(value: business) {
          BusinessRow(business: business)
        }
        .contextMenu { statusMenu(for: business) }
      }
    }
    .overlay { emptyState }
    .searchable(text: $search, prompt: "Search businesses")
    .refreshable { await leadSync.sync(into: context) }
    .task { await leadSync.sync(into: context) }
    .navigationTitle("Leads")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Picker("Status", selection: $statusFilter) {
            Text("All").tag(LeadStatus?.none)
            ForEach(LeadStatus.allCases.filter { $0 != .hidden }) { status in
              Label(status.title, systemImage: status.symbol).tag(LeadStatus?.some(status))
            }
          }
        } label: {
          Image(systemName: statusFilter == nil
            ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .accessibilityLabel("Filter by status")
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          showAdd = true
        } label: {
          Image(systemName: "plus")
        }
        .accessibilityLabel("Add lead")
        .disabled(!leadSync.isConnected)
      }
    }
    .sheet(isPresented: $showAdd) { AddBusinessView() }
    .sheet(isPresented: $showSettings) { SettingsView() }
    .onChange(of: showSettings) { _, open in
      if !open { Task { await leadSync.sync(into: context) } }
    }
  }

  @ViewBuilder private func statusMenu(for business: Business) -> some View {
    Picker("Status", selection: Binding(
      get: { business.status ?? .new },
      set: { status in
        UISelectionFeedbackGenerator().selectionChanged()
        Task { await leadSync.setStatus(status, for: business) }
      }
    )) {
      ForEach(LeadStatus.allCases) { status in
        Label(status.title, systemImage: status.symbol).tag(status)
      }
    }
  }

  @ViewBuilder private var emptyState: some View {
    if filtered.isEmpty {
      if !search.isEmpty {
        ContentUnavailableView.search(text: search)
      } else if !leadSync.isConnected {
        ContentUnavailableView {
          Label("Connect Lead Tracker", systemImage: "externaldrive.badge.icloud")
        } description: {
          Text("Paste the Lead Tracker connection string in Settings to load your leads.")
        } actions: {
          Button("Open Settings") { showSettings = true }
            .buttonStyle(.borderedProminent)
        }
      } else if leadSync.isSyncing {
        ProgressView("Loading leads…")
      } else if let error = leadSync.error {
        ContentUnavailableView {
          Label("Couldn't Load Leads", systemImage: "exclamationmark.triangle")
        } description: {
          Text(error)
        } actions: {
          Button("Try Again") { Task { await leadSync.sync(into: context) } }
        }
      } else {
        ContentUnavailableView {
          Label(statusFilter.map { "No \($0.title) Leads" } ?? "No Leads", systemImage: "person.crop.rectangle.stack")
        } description: {
          Text("Pull to refresh, or add a business as a lead.")
        } actions: {
          Button("Add Lead") { showAdd = true }
        }
      }
    }
  }
}

private struct BusinessRow: View {
  let business: Business

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .firstTextBaseline) {
        Text(business.name)
        Spacer(minLength: 8)
        if business.cardsWrittenAt != nil || !business.cards.isEmpty {
          Image(systemName: "wave.3.right")
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Has cards")
        }
      }
      Text(business.address)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(1)
      HStack(spacing: 6) {
        if let status = business.status {
          HStack(spacing: 3) {
            Image(systemName: status.symbol)
            Text(status.title)
          }
          .foregroundStyle(status.tint)
        }
        if let category = business.categoryTitle {
          Text(category.capitalized)
            .foregroundStyle(.tertiary)
        }
        Spacer(minLength: 0)
        Text("\(business.distanceMiles, format: .number.precision(.fractionLength(1))) mi")
          .monospacedDigit()
          .foregroundStyle(.secondary)
      }
      .font(.caption)
    }
    .padding(.vertical, 2)
  }
}
