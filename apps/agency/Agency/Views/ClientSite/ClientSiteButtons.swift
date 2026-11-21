import SwiftUI

/// Small capsule "Website" button for the route's current stop card.
struct WebsitePreviewButton: View {
  let site: ClientSite
  @State private var presented: ClientSite?

  var body: some View {
    Button {
      presented = site
    } label: {
      Label("Website", systemImage: "safari")
        .font(.caption.weight(.semibold))
    }
    .buttonStyle(.bordered)
    .buttonBorderShape(.capsule)
    .controlSize(.mini)
    .fullScreenCover(item: $presented) { site in
      ClientSiteView(site: site)
    }
  }
}

/// "Preview Website" row for the lead detail screen.
struct LeadWebsiteRow: View {
  let placeID: String
  @State private var site: ClientSite?
  @State private var looked = false
  @State private var presented: ClientSite?

  var body: some View {
    Group {
      if let site {
        Button {
          presented = site
        } label: {
          Label {
            VStack(alignment: .leading, spacing: 2) {
              Text("Preview Website")
              if let industry = site.meta?.industry {
                Text(industry).font(.caption).foregroundStyle(.secondary)
              }
            }
          } icon: {
            Image(systemName: "safari")
          }
        }
      } else if looked {
        Label("No website uploaded yet", systemImage: "safari")
          .foregroundStyle(.secondary)
      } else {
        HStack {
          Label("Looking for a website…", systemImage: "safari")
            .foregroundStyle(.secondary)
          Spacer()
          ProgressView()
        }
      }
    }
    .task(id: placeID) {
      site = await SiteCache.shared.site(for: placeID)
      looked = true
    }
    .fullScreenCover(item: $presented) { site in
      ClientSiteView(site: site)
    }
  }
}
