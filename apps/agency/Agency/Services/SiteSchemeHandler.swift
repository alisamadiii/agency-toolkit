import UniformTypeIdentifiers
import WebKit

/// Serves one client site to a WKWebView from `agencysite://site/<path>`, like the hub's api proxy:
/// cache first, R2 on a miss. Every path (relative or root-absolute like `/images/x.png`) maps into
/// the site's folder, so the site renders exactly as uploaded.
final class SiteSchemeHandler: NSObject, WKURLSchemeHandler {
  static let scheme = "agencysite"

  let site: ClientSite
  private var active = Set<ObjectIdentifier>()

  init(site: ClientSite) {
    self.site = site
  }

  static func url(_ path: String) -> URL {
    URL(string: "\(scheme)://site/\(path)")!
  }

  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    let id = ObjectIdentifier(task)
    active.insert(id)
    let url = task.request.url ?? Self.url("")
    Task {
      defer { active.remove(id) }
      do {
        let manifest = try await SiteCache.shared.manifest(for: site)
        guard let path = manifest.resolve(url.path()) else {
          guard active.contains(id) else { return }
          respond(task, url: url, status: 404, type: "text/plain", data: Data("Not found".utf8))
          return
        }
        var (data, type) = try await SiteCache.shared.file(path, in: site)
        guard active.contains(id) else { return }
        if path == "presentation.html" { data = Self.hideDeckBar(data) }
        respond(task, url: url, status: 200, type: Self.mimeType(path, stored: type), data: data)
      } catch {
        guard active.contains(id) else { return }
        task.didFailWithError(error)
      }
    }
  }

  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
    active.remove(ObjectIdentifier(task))
  }

  private func respond(_ task: any WKURLSchemeTask, url: URL, status: Int, type: String, data: Data) {
    let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [
      "Content-Type": type,
      "Content-Length": String(data.count),
    ])!
    task.didReceive(response)
    task.didReceive(data)
    task.didFinish()
  }

  /// Same as the hub: the deck's own control bar is hidden when shown inside the viewer.
  private static func hideDeckBar(_ data: Data) -> Data {
    guard var html = String(data: data, encoding: .utf8) else { return data }
    let style = "<style>#bar{display:none!important}</style>"
    if let head = html.range(of: "</head>", options: .caseInsensitive) {
      html.insert(contentsOf: style, at: head.lowerBound)
    } else {
      html = style + html
    }
    return Data(html.utf8)
  }

  private static func mimeType(_ path: String, stored: String?) -> String {
    let ext = (path as NSString).pathExtension.lowercased()
    if let type = UTType(filenameExtension: ext)?.preferredMIMEType {
      return ["html", "css", "js", "svg", "json", "txt"].contains(ext) ? "\(type); charset=utf-8" : type
    }
    return stored ?? "application/octet-stream"
  }
}
