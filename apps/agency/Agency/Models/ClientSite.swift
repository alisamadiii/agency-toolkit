import Foundation

/// `_meta.json` in a client folder. Only `name` is required; everything else may be missing.
nonisolated struct ClientSiteMeta: Codable, Sendable {
  struct Design: Codable, Sendable {
    let chatUrl: String?
    let title: String?
    let notes: String?
  }

  struct Business: Codable, Sendable {
    let placeId: String?
    let name: String?
    let address: String?
    let phone: String?
    let category: String?
  }

  let name: String
  let industry: String?
  let slug: String?
  let leadId: String?
  let uploadedAt: String?
  let design: Design?
  let business: Business?
}

/// One client website in R2: folder `<slug>--<placeId>`, where placeId is `leads.place_id`.
nonisolated struct ClientSite: Codable, Identifiable, Hashable, Sendable {
  let folder: String
  let slug: String
  let placeID: String
  var meta: ClientSiteMeta?

  var id: String { folder }
  var name: String { meta?.name ?? slug.replacingOccurrences(of: "-", with: " ").capitalized }

  /// Splits on the first `--`. The place ID is case-sensitive and may itself contain `-`/`_`.
  /// Legacy folders without `--` return nil and are ignored.
  init?(folder: String) {
    guard let range = folder.range(of: "--") else { return nil }
    let slug = String(folder[..<range.lowerBound])
    let placeID = String(folder[range.upperBound...])
    guard !slug.isEmpty, !placeID.isEmpty else { return nil }
    self.folder = folder
    self.slug = slug
    self.placeID = placeID
  }

  static func == (lhs: ClientSite, rhs: ClientSite) -> Bool { lhs.folder == rhs.folder }
  func hash(into hasher: inout Hasher) { hasher.combine(folder) }
}

/// Every object in a client folder, keyed by path inside the folder ("index.html", "css/site.css").
nonisolated struct SiteManifest: Codable, Sendable {
  var objects: [String: R2Object]
  var checkedAt: Date

  var hasPresentation: Bool { objects["presentation.html"] != nil }
  var hasVideo: Bool { objects["preview.mp4"] != nil }

  /// Website pages for the Pages menu: html files except the deck, Home first.
  var pages: [String] {
    objects.keys
      .filter { $0.hasSuffix(".html") && $0 != "presentation.html" && $0.split(separator: "/").count <= 2 }
      .filter { !$0.contains("/") || $0.hasSuffix("/index.html") }
      .sorted { lhs, rhs in
        if lhs == "index.html" { return true }
        if rhs == "index.html" { return false }
        return lhs < rhs
      }
  }

  /// Hub rules: "" → index.html, "about" → about | about.html | about/index.html. `_meta.json` is never served.
  func resolve(_ path: String) -> String? {
    var path = path.removingPercentEncoding ?? path
    while path.hasPrefix("/") { path.removeFirst() }
    if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
    let candidates = [path, path + ".html", path + "/index.html"]
    return candidates.first { $0 != "_meta.json" && objects[$0] != nil }
  }

  static func title(for page: String) -> String {
    if page == "index.html" { return "Home" }
    let name = page.hasSuffix("/index.html")
      ? String(page.dropLast("/index.html".count))
      : String(page.dropLast(".html".count))
    return name.replacingOccurrences(of: "-", with: " ").capitalized
  }
}
