import SwiftUI

/// Value pushed on the root NavigationStack to open a route.
struct RouteRef: Hashable {
  let id: String
  let name: String
}

/// Numbered stop marker used on the map and in lists.
struct StopBadge: View {
  let number: Int
  let status: StopStatus
  var size: CGFloat = 28
  var isCurrent = false

  var body: some View {
    ZStack {
      Circle()
        .fill(fill)
        .overlay(Circle().strokeBorder(.white, lineWidth: isCurrent ? 3 : 2))
        .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
      switch status {
      case .pending:
        Text("\(number)").font(.system(size: size * 0.45, weight: .bold, design: .rounded))
      case .visited:
        Image(systemName: "checkmark").font(.system(size: size * 0.42, weight: .bold))
      case .failed:
        Image(systemName: "xmark").font(.system(size: size * 0.42, weight: .bold))
      }
    }
    .foregroundStyle(.white)
    .frame(width: size, height: size)
    .contentTransition(.symbolEffect(.replace))
    .animation(.snappy, value: status)
  }

  private var fill: Color {
    switch status {
    case .pending: .blue
    case .visited: .green
    case .failed: .red
    }
  }
}

/// Map marker for the start ("S") and the end (house).
struct EndpointPin: View {
  let symbol: String?
  var body: some View {
    ZStack {
      Circle()
        .fill(.black)
        .overlay(Circle().strokeBorder(.white, lineWidth: 2))
        .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
      if let symbol {
        Image(systemName: symbol).font(.system(size: 13, weight: .bold))
      } else {
        Text("S").font(.system(size: 14, weight: .heavy, design: .rounded))
      }
    }
    .foregroundStyle(.white)
    .frame(width: 28, height: 28)
  }
}

struct CandidateRow: View {
  let lead: RouteCandidate

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(lead.name)
      HStack(spacing: 6) {
        if let status = lead.leadStatus {
          Label(status.title, systemImage: status.symbol)
            .labelStyle(.titleAndIcon)
            .foregroundStyle(status.tint)
        }
        Text(lead.category.replacingOccurrences(of: "_", with: " "))
        Spacer(minLength: 0)
        Text("\(lead.distanceMiles, format: .number.precision(.fractionLength(1))) mi")
          .monospacedDigit()
      }
      .font(.caption)
      .foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
  }
}

/// Multi-select list of leads with search and a status filter. Used to create a route and to add stops.
struct LeadPickerSection: View {
  let candidates: [RouteCandidate]
  let search: String
  let statusFilter: LeadStatus?
  let selectedCount: Int

  private var filtered: [RouteCandidate] {
    let needle = search.trimmingCharacters(in: .whitespaces)
    return candidates.filter { lead in
      if let statusFilter, lead.leadStatus != statusFilter { return false }
      guard !needle.isEmpty else { return true }
      return lead.name.localizedCaseInsensitiveContains(needle)
        || (lead.address?.localizedCaseInsensitiveContains(needle) ?? false)
        || lead.category.localizedCaseInsensitiveContains(needle)
    }
  }

  var body: some View {
    Section {
      ForEach(filtered) { lead in
        CandidateRow(lead: lead).tag(lead.placeID)
      }
    } header: {
      Text("Leads")
    } footer: {
      if selectedCount > RoutesService.maxStops {
        Text("Google can order up to \(RoutesService.maxStops) stops. Remove \(selectedCount - RoutesService.maxStops).")
          .foregroundStyle(.red)
      } else if filtered.isEmpty {
        Text("No leads match.")
      }
    }
  }
}

/// Status filter menu shared by the pickers.
struct LeadStatusFilterMenu: View {
  @Binding var statusFilter: LeadStatus?

  var body: some View {
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
}
