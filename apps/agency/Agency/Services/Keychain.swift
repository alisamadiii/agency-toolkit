import Foundation
import Security

/// Small secrets live in the Keychain, not UserDefaults.
nonisolated enum Keychain {
  enum Key: String {
    case placesAPIKey = "PLACES_API_KEY"
    case leadTrackerURL = "LEAD_TRACKER_DATABASE_URL"
    case cloudflareToken = "CLOUDFLARE_API_TOKEN"
    case cloudflareAccountID = "CLOUDFLARE_ACCOUNT_ID"
    /// S3 key ID of the token (its token ID), looked up once.
    case r2AccessKeyID = "R2_ACCESS_KEY_ID"
    /// Debug only: explicit S3 secret, used instead of SHA-256(token).
    case r2SecretOverride = "R2_SECRET_OVERRIDE"
  }

  private static let service = "com.alisamadi.agency"

  static func get(_ key: Key) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key.rawValue,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
          let data = out as? Data,
          let value = String(data: data, encoding: .utf8),
          !value.isEmpty
    else { return nil }
    return value
  }

  /// Empty value deletes the entry.
  static func set(_ key: Key, _ value: String) {
    let base: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key.rawValue,
    ]
    SecItemDelete(base as CFDictionary)
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    var add = base
    add[kSecValueData as String] = Data(trimmed.utf8)
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(add as CFDictionary, nil)
  }
}
