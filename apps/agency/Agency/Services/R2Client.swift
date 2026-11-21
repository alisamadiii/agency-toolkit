import CryptoKit
import Foundation

/// One object in the bucket.
nonisolated struct R2Object: Codable, Hashable, Sendable {
  let key: String
  let etag: String?
  let size: Int?
  let contentType: String?
}

nonisolated enum R2Error: LocalizedError {
  case missingToken
  case noAccount
  case tokenNotVerified(String)
  case http(status: Int, message: String)
  case decoding

  var errorDescription: String? {
    switch self {
    case .missingToken: "Add the R2 API token in Settings → Client Websites."
    case .noAccount: "Enter your Cloudflare Account ID in Settings (R2 overview page → Account Details)."
    case .tokenNotVerified(let message): "Cloudflare didn't accept the token: \(message)"
    case .http(let status, let message): "R2 (\(status)): \(message)"
    case .decoding: "Unexpected response from R2."
    }
  }
}

/// Reads the `client-websites` bucket over R2's S3 API with SigV4.
///
/// Only one secret is stored: the R2 API token (bucket-scoped "Object Read only" works).
/// Cloudflare derives a token's S3 credentials from it: the access key ID is the token's ID
/// (looked up once via the token verify endpoint) and the secret is SHA-256 of the token value.
nonisolated enum R2Client {
  static let bucket = "client-websites"
  private static let api = "https://api.cloudflare.com/client/v4"

  // MARK: - Bucket

  /// Top-level folder names (without the trailing slash).
  static func listFolders() async throws -> [String] {
    var folders: [String] = []
    try await paginate(prefix: nil, delimiter: "/") { folders += $0.prefixes.map { String($0.dropLast()) } }
    return folders
  }

  /// Every object under `prefix`, recursively.
  static func listObjects(prefix: String) async throws -> [R2Object] {
    var objects: [R2Object] = []
    try await paginate(prefix: prefix, delimiter: nil) { objects += $0.objects }
    return objects
  }

  static func get(_ key: String) async throws -> (data: Data, contentType: String?) {
    let request = try await signedRequest(key: key)
    let (data, response) = try await URLSession.shared.data(for: request)
    try check(response, data)
    return (data, (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type"))
  }

  /// Streams a large object (the preview video) to disk.
  static func download(_ key: String, to destination: URL) async throws {
    let request = try await signedRequest(key: key)
    let (temp, response) = try await URLSession.shared.download(for: request)
    try check(response, Data())
    try? FileManager.default.removeItem(at: destination)
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    try FileManager.default.moveItem(at: temp, to: destination)
  }

  // MARK: - Credentials

  private struct Credentials {
    let account: String
    let accessKeyID: String
    let secret: String
  }

  private static func credentials() async throws -> Credentials {
    guard let account = try await accountID() else { throw R2Error.noAccount }
    if let id = Keychain.get(.r2AccessKeyID), let secret = Keychain.get(.r2SecretOverride) {
      return Credentials(account: account, accessKeyID: id, secret: secret)
    }
    guard let token = Keychain.get(.cloudflareToken) else { throw R2Error.missingToken }
    let secret = SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
    if let id = Keychain.get(.r2AccessKeyID) {
      return Credentials(account: account, accessKeyID: id, secret: secret)
    }
    let id = try await tokenID(token, account: account)
    Keychain.set(.r2AccessKeyID, id)
    return Credentials(account: account, accessKeyID: id, secret: secret)
  }

  /// Saved account ID, else the first account the token can list (works for user tokens only).
  private static func accountID() async throws -> String? {
    if let saved = Keychain.get(.cloudflareAccountID) { return saved }
    guard let token = Keychain.get(.cloudflareToken) else { throw R2Error.missingToken }
    var request = URLRequest(url: URL(string: "\(api)/accounts?per_page=5")!)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    guard let (data, _) = try? await URLSession.shared.data(for: request),
          let id = (try? JSONDecoder().decode(Envelope<[IDResult]>.self, from: data))?.result?.first?.id
    else { return nil }
    Keychain.set(.cloudflareAccountID, id)
    return id
  }

  /// The token's ID, which is its S3 access key ID. Account-owned tokens verify under the
  /// account, user tokens under /user.
  private static func tokenID(_ token: String, account: String) async throws -> String {
    var lastMessage = "unknown error"
    for path in ["/accounts/\(account)/tokens/verify", "/user/tokens/verify"] {
      var request = URLRequest(url: URL(string: api + path)!)
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      let (data, _) = try await URLSession.shared.data(for: request)
      let envelope = try? JSONDecoder().decode(Envelope<IDResult>.self, from: data)
      if let id = envelope?.result?.id { return id }
      lastMessage = envelope?.errors?.first?.message ?? lastMessage
    }
    throw R2Error.tokenNotVerified(lastMessage)
  }

  // MARK: - SigV4

  private static func signedRequest(key: String? = nil, query: [String: String] = [:]) async throws -> URLRequest {
    let creds = try await credentials()
    let host = "\(creds.account).r2.cloudflarestorage.com"
    let path = "/\(bucket)" + (key.map { "/" + encodePath($0) } ?? "")
    let canonicalQuery = query.sorted { $0.key < $1.key }
      .map { "\(encode($0.key))=\(encode($0.value))" }
      .joined(separator: "&")

    let now = Date.now
    let amzDate = format(now, "yyyyMMdd'T'HHmmss'Z'")
    let day = format(now, "yyyyMMdd")
    let payloadHash = hex(SHA256.hash(data: Data()))
    let signedHeaders = "host;x-amz-content-sha256;x-amz-date"
    let canonicalRequest = [
      "GET", path, canonicalQuery,
      "host:\(host)\nx-amz-content-sha256:\(payloadHash)\nx-amz-date:\(amzDate)\n",
      signedHeaders, payloadHash,
    ].joined(separator: "\n")
    let scope = "\(day)/auto/s3/aws4_request"
    let stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(SHA256.hash(data: Data(canonicalRequest.utf8)))]
      .joined(separator: "\n")

    var signingKey = SymmetricKey(data: Data("AWS4\(creds.secret)".utf8))
    for part in [day, "auto", "s3", "aws4_request"] {
      signingKey = SymmetricKey(data: Data(HMAC<SHA256>.authenticationCode(for: Data(part.utf8), using: signingKey)))
    }
    let signature = hex(HMAC<SHA256>.authenticationCode(for: Data(stringToSign.utf8), using: signingKey))

    var request = URLRequest(url: URL(string: "https://\(host)\(path)" + (canonicalQuery.isEmpty ? "" : "?\(canonicalQuery)"))!)
    request.timeoutInterval = 30
    request.setValue(amzDate, forHTTPHeaderField: "x-amz-date")
    request.setValue(payloadHash, forHTTPHeaderField: "x-amz-content-sha256")
    request.setValue(
      "AWS4-HMAC-SHA256 Credential=\(creds.accessKeyID)/\(scope), SignedHeaders=\(signedHeaders), Signature=\(signature)",
      forHTTPHeaderField: "Authorization"
    )
    return request
  }

  private static func paginate(prefix: String?, delimiter: String?, _ body: (ListResult) -> Void) async throws {
    var token: String?
    repeat {
      var query = ["list-type": "2", "max-keys": "1000"]
      if let prefix { query["prefix"] = prefix }
      if let delimiter { query["delimiter"] = delimiter }
      if let token { query["continuation-token"] = token }
      let request = try await signedRequest(query: query)
      let (data, response) = try await URLSession.shared.data(for: request)
      try check(response, data)
      let page = ListResult.parse(data)
      body(page)
      token = page.isTruncated ? page.nextToken : nil
    } while token != nil
  }

  private static func check(_ response: URLResponse, _ data: Data) throws {
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let text = String(data: data, encoding: .utf8) ?? ""
      let message = text.range(of: "<Message>").flatMap { start in
        text.range(of: "</Message>").map { String(text[start.upperBound..<$0.lowerBound]) }
      } ?? (status == 403 ? "access denied" : "request failed")
      if status == 401 || status == 403 { Keychain.set(.r2AccessKeyID, "") }  // re-derive next time
      throw R2Error.http(status: status, message: message)
    }
  }

  private static let unreserved: CharacterSet = {
    var set = CharacterSet.alphanumerics
    set.insert(charactersIn: "-._~")
    return set
  }()

  private static func encode(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value
  }

  private static func encodePath(_ key: String) -> String {
    key.split(separator: "/", omittingEmptySubsequences: false).map { encode(String($0)) }.joined(separator: "/")
  }

  private static func hex(_ digest: some Sequence<UInt8>) -> String {
    digest.map { String(format: "%02x", $0) }.joined()
  }

  private static func format(_ date: Date, _ pattern: String) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = pattern
    return formatter.string(from: date)
  }

  private struct Envelope<T: Decodable>: Decodable {
    struct Message: Decodable { let message: String }
    let result: T?
    let errors: [Message]?
  }
  private struct IDResult: Decodable { let id: String }
}

/// ListObjectsV2 XML → folders, objects and the next page token.
private nonisolated final class ListResult: NSObject, XMLParserDelegate {
  private(set) var prefixes: [String] = []
  private(set) var objects: [R2Object] = []
  private(set) var isTruncated = false
  private(set) var nextToken: String?

  private var path: [String] = []
  private var text = ""
  private var key = "", etag = "", size = 0

  static func parse(_ data: Data) -> ListResult {
    let result = ListResult()
    let parser = XMLParser(data: data)
    parser.delegate = result
    parser.parse()
    return result
  }

  func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
              qualifiedName: String?, attributes: [String: String] = [:]) {
    path.append(name)
    text = ""
  }

  func parser(_ parser: XMLParser, foundCharacters string: String) {
    text += string
  }

  func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
    let parent = path.dropLast().last
    switch (parent, name) {
    case ("CommonPrefixes", "Prefix"): prefixes.append(text)
    case ("Contents", "Key"): key = text
    case ("Contents", "ETag"): etag = text.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    case ("Contents", "Size"): size = Int(text) ?? 0
    case (_, "Contents"): objects.append(R2Object(key: key, etag: etag, size: size, contentType: nil))
    case (_, "IsTruncated"): isTruncated = text == "true"
    case (_, "NextContinuationToken"): nextToken = text
    default: break
    }
    path.removeLast()
  }
}
