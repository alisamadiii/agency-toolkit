import SwiftData
import SwiftUI

@main
struct AgencyApp: App {
  init() {
    #if DEBUG
    // Simulator convenience: `SIMCTL_CHILD_LEAD_TRACKER_URL=… xcrun simctl launch …`
    if let url = ProcessInfo.processInfo.environment["LEAD_TRACKER_URL"], !url.isEmpty {
      Keychain.set(.leadTrackerURL, url)
    }
    if let token = ProcessInfo.processInfo.environment["CLOUDFLARE_TOKEN"], !token.isEmpty {
      Keychain.set(.cloudflareToken, token)
    }
    // Plain S3 keys (e.g. the uploader's) for testing without a real token.
    let env = ProcessInfo.processInfo.environment
    if let id = env["R2_ACCESS_KEY_ID"], let secret = env["R2_SECRET_ACCESS_KEY"], let account = env["R2_ACCOUNT_ID"] {
      Keychain.set(.r2AccessKeyID, id)
      Keychain.set(.r2SecretOverride, secret)
      Keychain.set(.cloudflareAccountID, account)
    }
    #endif
  }

  var body: some Scene {
    WindowGroup {
      ToolsView()
    }
    .modelContainer(for: [Business.self, NFCCard.self])
  }
}
