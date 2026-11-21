import AVKit
import SwiftUI
import WebKit

/// Full-screen client website, like the hub's website detail: the site first, then
/// Presentation (deck) and Video (preview.mp4) when the folder has them.
struct ClientSiteView: View {
  let site: ClientSite

  @Environment(\.dismiss) private var dismiss
  @State private var manifest: SiteManifest?
  @State private var page = "index.html"
  @State private var showingDeck = false
  @State private var isLoading = true
  @State private var error: String?
  @State private var reload = 0
  @State private var videoURL: URL?
  @State private var isFetchingVideo = false
  @State private var opened = false

  private var path: String { showingDeck ? "presentation.html" : page }

  var body: some View {
    ZStack {
      Color(.systemBackground).ignoresSafeArea()

      if manifest != nil {
        SiteWebView(site: site, path: path, reload: reload, isLoading: $isLoading, error: $error)
          .opacity(error == nil ? 1 : 0)
        if isLoading && error == nil {
          ProgressView()
        }
      } else if error == nil {
        ProgressView()
      }

      if let error {
        ContentUnavailableView {
          Label("Couldn't Load the Website", systemImage: "wifi.exclamationmark")
        } description: {
          Text(error)
        } actions: {
          Button("Try Again") { Task { await load() } }
            .buttonStyle(.borderedProminent)
        }
      }
    }
    // Its own strip under the site, so sticky bottom bars on the site (Call / Book) stay visible.
    .safeAreaInset(edge: .bottom, spacing: 0) {
      toolbar
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
        .background(Color(.systemBackground).shadow(.drop(color: .black.opacity(0.08), radius: 6, y: -2)))
    }
    .statusBarHidden(false)
    .task { await load() }
    .sensoryFeedback(.impact(weight: .light), trigger: opened)
    .fullScreenCover(item: $videoURL) { url in
      VideoScreen(url: url)
    }
  }

  private var toolbar: some View {
    HStack(spacing: 6) {
      Button {
        dismiss()
      } label: {
        Image(systemName: "xmark")
          .font(.body.weight(.semibold))
          .frame(width: 36, height: 36)
      }
      .accessibilityLabel("Close")

      if let manifest {
        Divider().frame(height: 22)

        Button {
          withAnimation(.snappy) { showingDeck.toggle() }
        } label: {
          Label(showingDeck ? "Website" : (manifest.hasPresentation ? "Presentation" : "No presentation"),
                systemImage: showingDeck ? "safari" : "rectangle.on.rectangle")
            .contentTransition(.symbolEffect(.replace))
        }
        .disabled(!manifest.hasPresentation)
        .padding(.horizontal, 6)

        if manifest.hasVideo {
          Button {
            Task { await playVideo() }
          } label: {
            if isFetchingVideo {
              ProgressView().frame(width: 20)
            } else {
              Label("Video", systemImage: "play.rectangle.fill")
            }
          }
          .disabled(isFetchingVideo)
          .padding(.horizontal, 6)
        }

        if !showingDeck, manifest.pages.count > 1 {
          Menu {
            Picker("Page", selection: $page) {
              ForEach(manifest.pages, id: \.self) { page in
                Text(SiteManifest.title(for: page)).tag(page)
              }
            }
          } label: {
            Image(systemName: "doc.on.doc")
              .frame(width: 36, height: 36)
          }
          .accessibilityLabel("Pages")
        }
      }
    }
    .font(.subheadline.weight(.semibold))
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(Color(.secondarySystemBackground), in: Capsule())
    .padding(.bottom, 4)
  }

  private func load() async {
    error = nil
    do {
      manifest = try await SiteCache.shared.manifest(for: site)
      reload += 1
      opened = true
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func playVideo() async {
    isFetchingVideo = true
    defer { isFetchingVideo = false }
    do {
      videoURL = try await SiteCache.shared.video(for: site)
    } catch {
      self.error = error.localizedDescription
    }
  }
}

extension URL: @retroactive Identifiable {
  public var id: String { absoluteString }
}

/// Plays the cached preview video full screen.
private struct VideoScreen: View {
  let url: URL
  @Environment(\.dismiss) private var dismiss
  @State private var player: AVPlayer?

  var body: some View {
    ZStack(alignment: .topTrailing) {
      Color.black.ignoresSafeArea()
      if let player {
        VideoPlayer(player: player).ignoresSafeArea()
      }
      Button {
        dismiss()
      } label: {
        Image(systemName: "xmark.circle.fill")
          .font(.title)
          .symbolRenderingMode(.palette)
          .foregroundStyle(.white, .black.opacity(0.5))
      }
      .padding()
      .accessibilityLabel("Close video")
    }
    .onAppear {
      let player = AVPlayer(url: url)
      self.player = player
      player.play()
    }
    .onDisappear { player?.pause() }
  }
}

/// WKWebView wired to `SiteSchemeHandler` for one site.
private struct SiteWebView: UIViewRepresentable {
  let site: ClientSite
  let path: String
  let reload: Int
  @Binding var isLoading: Bool
  @Binding var error: String?

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(SiteSchemeHandler(site: site), forURLScheme: SiteSchemeHandler.scheme)
    config.allowsInlineMediaPlayback = true
    let webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = context.coordinator
    webView.allowsBackForwardNavigationGestures = true
    return webView
  }

  func updateUIView(_ webView: WKWebView, context: Context) {
    context.coordinator.parent = self
    let key = "\(path)#\(reload)"
    guard context.coordinator.loadedKey != key else { return }
    context.coordinator.loadedKey = key
    webView.load(URLRequest(url: SiteSchemeHandler.url(path)))
  }

  final class Coordinator: NSObject, WKNavigationDelegate {
    var parent: SiteWebView
    var loadedKey: String?

    init(_ parent: SiteWebView) {
      self.parent = parent
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
      parent.isLoading = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      parent.isLoading = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
      fail(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
      fail(error)
    }

    /// Links to other sites (tel:, maps, socials) open outside the viewer.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
      guard let url = action.request.url, action.targetFrame?.isMainFrame ?? true,
            url.scheme != SiteSchemeHandler.scheme, url.scheme != "about"
      else { return .allow }
      if action.navigationType == .linkActivated {
        await UIApplication.shared.open(url)
        return .cancel
      }
      return .allow
    }

    private func fail(_ error: any Error) {
      parent.isLoading = false
      if (error as NSError).code == NSURLErrorCancelled { return }
      parent.error = error.localizedDescription
    }
  }
}
