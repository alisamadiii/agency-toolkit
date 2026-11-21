import Foundation

nonisolated enum NeonError: LocalizedError {
  case missingURL
  case badURL
  case http(status: Int, message: String)
  case decoding(String)

  var errorDescription: String? {
    switch self {
    case .missingURL: "Add the Lead Tracker connection string in Settings."
    case .badURL: "That isn't a postgresql:// connection string."
    case .http(let status, let message): "Lead Tracker (\(status)): \(message)"
    case .decoding(let detail): "Unexpected data from Lead Tracker: \(detail)"
    }
  }
}

/// Neon's HTTP SQL endpoint, the same one `@neondatabase/serverless` uses in HTTP mode.
/// One request per statement; no connection pool, no third-party driver.
nonisolated enum NeonClient {
  /// Runs one parameterized statement and decodes each row (column name → value).
  static func query<Row: Decodable>(
    _ sql: String, _ params: [String?] = [], as: Row.Type = Row.self,
    connectionString: String? = nil
  ) async throws -> [Row] {
    guard let connection = connectionString ?? Keychain.get(.leadTrackerURL) else { throw NeonError.missingURL }
    let endpoint = try endpoint(for: connection)

    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(connection, forHTTPHeaderField: "Neon-Connection-String")
    request.httpBody = try JSONEncoder().encode(Body(query: sql, params: params))

    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.message
        ?? String(data: data, encoding: .utf8) ?? ""
      throw NeonError.http(status: status, message: message)
    }
    do {
      return try JSONDecoder().decode(Result<Row>.self, from: data).rows
    } catch {
      throw NeonError.decoding(String(describing: error))
    }
  }

  /// `postgresql://user:pass@ep-x-pooler.c-15.us-east-1.aws.neon.tech/db` → `https://api.c-15.us-east-1.aws.neon.tech/sql`
  static func endpoint(for connectionString: String) throws -> URL {
    guard let components = URLComponents(string: connectionString),
          ["postgres", "postgresql"].contains(components.scheme ?? ""),
          let host = components.host, host.contains(".")
    else { throw NeonError.badURL }
    let rest = host.split(separator: ".", maxSplits: 1)[1]
    guard let url = URL(string: "https://api.\(rest)/sql") else { throw NeonError.badURL }
    return url
  }

  private struct Body: Encodable {
    let query: String
    let params: [String?]
  }

  private struct Result<Row: Decodable>: Decodable {
    let rows: [Row]
  }

  private struct ErrorBody: Decodable {
    let message: String
  }
}
