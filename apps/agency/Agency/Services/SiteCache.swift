import Foundation

/// Offline copy of the client websites. Lifetime cache: once a site list, manifest or file is on
/// disk it is served from there forever; R2 is only hit on a miss or when the user taps
/// Settings → Refresh now. Lives in Application Support so iOS doesn't purge it.
///
/// Layout: `ClientSites/index.json`, then per folder `manifest.json` and `files/<path>`.
actor SiteCache {
  static let shared = SiteCache()

  private struct Index: Codable {
    var sites: [ClientSite]
    var fetchedAt: Date
  }

  private let root: URL
  private var index: Index?
  private var manifests: [String: SiteManifest] = [:]

  init() {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    root = support.appending(path: "ClientSites", directoryHint: .isDirectory)
  }

  nonisolated static var isConfigured: Bool { Keychain.get(.cloudflareToken) != nil }

  // MARK: - Sites

  /// Every client site. Fetched from R2 only the first time.
  func sites() async throws -> [ClientSite] {
    if let index { return index.sites }
    if let saved: Index = read("index.json") {
      index = saved
      return saved.sites
    }
    return try await fetchIndex().sites
  }

  /// The site whose folder ends with `--<placeID>` (exact, case-sensitive), or nil.
  func site(for placeID: String) async -> ClientSite? {
    guard Self.isConfigured else { return nil }
    return try? await sites().first { $0.placeID == placeID }
  }

  // MARK: - Files

  func manifest(for site: ClientSite) async throws -> SiteManifest {
    if let cached = manifests[site.folder] { return cached }
    if let saved: SiteManifest = read("\(site.folder)/manifest.json") {
      manifests[site.folder] = saved
      return saved
    }
    return try await fetchManifest(site.folder)
  }

  /// A file inside the site, from disk or (first time) from R2.
  func file(_ path: String, in site: ClientSite) async throws -> (data: Data, contentType: String?) {
    let manifest = try await manifest(for: site)
    let local = fileURL(site.folder, path)
    if let data = try? Data(contentsOf: local) {
      return (data, manifest.objects[path]?.contentType)
    }
    let (data, type) = try await R2Client.get("\(site.folder)/\(path)")
    write(data, to: local)
    return (data, manifest.objects[path]?.contentType ?? type)
  }

  /// Local copy of `preview.mp4`, downloaded on first play.
  func video(for site: ClientSite) async throws -> URL {
    let local = fileURL(site.folder, "preview.mp4")
    if FileManager.default.fileExists(atPath: local.path()) { return local }
    try await R2Client.download("\(site.folder)/preview.mp4", to: local)
    return local
  }

  /// Caches the site files (not the video) for these leads, so they open offline at the stop.
  func prefetch(placeIDs: [String]) async {
    guard Self.isConfigured, let all = try? await sites() else { return }
    let wanted = Set(placeIDs)
    for site in all where wanted.contains(site.placeID) {
      guard let manifest = try? await manifest(for: site) else { continue }
      for path in manifest.objects.keys where path != "preview.mp4" && path != "_meta.json" {
        if !FileManager.default.fileExists(atPath: fileURL(site.folder, path).path()) {
          _ = try? await file(path, in: site)
        }
      }
    }
  }

  // MARK: - Revalidate (Settings → Refresh now)

  /// Re-lists folders and metas, then re-checks every cached site: changed files (new ETag) are
  /// downloaded again, removed ones deleted. Throws only if R2 can't be reached; the cache stays as is.
  @discardableResult
  func refreshAll() async throws -> Date {
    let fresh = try await fetchIndex()
    let live = Set(fresh.sites.map(\.folder))
    for folder in cachedFolders() where !live.contains(folder) {
      try? FileManager.default.removeItem(at: root.appending(path: folder))
      manifests[folder] = nil
    }
    for site in fresh.sites where cachedFolders().contains(site.folder) {
      let old: SiteManifest? = manifests[site.folder] ?? read("\(site.folder)/manifest.json")
      guard let new = try? await fetchManifest(site.folder) else { continue }
      for (path, object) in old?.objects ?? [:] where new.objects[path]?.etag != object.etag {
        let local = fileURL(site.folder, path)
        let wasCached = FileManager.default.fileExists(atPath: local.path())
        try? FileManager.default.removeItem(at: local)
        // Keep it offline-ready: re-download what was cached (except the big video, done on next play).
        if wasCached, new.objects[path] != nil, path != "preview.mp4" {
          _ = try? await file(path, in: site)
        }
      }
    }
    return fresh.fetchedAt
  }

  func clear() {
    try? FileManager.default.removeItem(at: root)
    index = nil
    manifests = [:]
  }

  struct Stats: Sendable {
    let bytes: Int64
    let cachedSites: Int
    let totalSites: Int
    let refreshedAt: Date?
  }

  func stats() -> Stats {
    let saved: Index? = index ?? read("index.json")
    var bytes: Int64 = 0
    if let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey]) {
      for case let url as URL in walker {
        bytes += Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
      }
    }
    return Stats(bytes: bytes, cachedSites: cachedFolders().count,
                 totalSites: saved?.sites.count ?? 0, refreshedAt: saved?.fetchedAt)
  }

  // MARK: - Fetching

  private func fetchIndex() async throws -> Index {
    let folders = try await R2Client.listFolders()
    var sites = folders.compactMap(ClientSite.init(folder:))
    // Read every _meta.json, a few at a time.
    let metas = await withTaskGroup(of: (String, ClientSiteMeta?).self) { group in
      var results: [String: ClientSiteMeta] = [:]
      var pending = sites.map(\.folder)[...]
      func addNext() {
        guard let folder = pending.popFirst() else { return }
        group.addTask {
          let data = try? await R2Client.get("\(folder)/_meta.json").data
          return (folder, data.flatMap { try? JSONDecoder().decode(ClientSiteMeta.self, from: $0) })
        }
      }
      for _ in 0..<8 { addNext() }
      for await (folder, meta) in group {
        if let meta { results[folder] = meta }
        addNext()
      }
      return results
    }
    for index in sites.indices { sites[index].meta = metas[sites[index].folder] }
    let fresh = Index(sites: sites.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending },
                      fetchedAt: .now)
    index = fresh
    save(fresh, "index.json")
    return fresh
  }

  private func fetchManifest(_ folder: String) async throws -> SiteManifest {
    let objects = try await R2Client.listObjects(prefix: "\(folder)/")
    var byPath: [String: R2Object] = [:]
    for object in objects {
      byPath[String(object.key.dropFirst(folder.count + 1))] = object
    }
    let manifest = SiteManifest(objects: byPath, checkedAt: .now)
    manifests[folder] = manifest
    save(manifest, "\(folder)/manifest.json")
    return manifest
  }

  // MARK: - Disk

  private func fileURL(_ folder: String, _ path: String) -> URL {
    root.appending(path: folder).appending(path: "files").appending(path: path)
  }

  private func cachedFolders() -> [String] {
    let items = (try? FileManager.default.contentsOfDirectory(atPath: root.path())) ?? []
    return items.filter { FileManager.default.fileExists(atPath: root.appending(path: $0).appending(path: "manifest.json").path()) }
  }

  private func read<T: Decodable>(_ path: String) -> T? {
    guard let data = try? Data(contentsOf: root.appending(path: path)) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  private func save(_ value: some Encodable, _ path: String) {
    guard let data = try? JSONEncoder().encode(value) else { return }
    write(data, to: root.appending(path: path))
  }

  private func write(_ data: Data, to url: URL) {
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? data.write(to: url, options: .atomic)
  }
}
