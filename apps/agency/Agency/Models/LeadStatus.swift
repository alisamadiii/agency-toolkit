import SwiftUI

/// Mirrors `LEAD_STATUSES` in apps/lead-finder/src/db/schema.ts. Keep the raw values in sync.
enum LeadStatus: String, CaseIterable, Identifiable {
  case new
  case designing
  case designReady = "design_ready"
  case contacted
  case won
  case lost
  case skipped
  case hidden

  var id: Self { self }

  var title: String {
    switch self {
    case .new: "New"
    case .designing: "Designing"
    case .designReady: "Design Ready"
    case .contacted: "Contacted"
    case .won: "Won"
    case .lost: "Lost"
    case .skipped: "Skipped"
    case .hidden: "Hidden"
    }
  }

  var symbol: String {
    switch self {
    case .new: "sparkle"
    case .designing: "paintbrush"
    case .designReady: "checkmark.seal"
    case .contacted: "phone"
    case .won: "trophy"
    case .lost: "xmark.circle"
    case .skipped: "forward"
    case .hidden: "eye.slash"
    }
  }

  var tint: Color {
    switch self {
    case .new: .blue
    case .designing: .orange
    case .designReady: .teal
    case .contacted: .indigo
    case .won: .green
    case .lost: .red
    case .skipped, .hidden: .gray
    }
  }
}
