import Foundation
import SwiftData

/// One physical NFC card, identified by its chip UID.
@Model
final class NFCCard {
  @Attribute(.unique) var uid: String
  var label: String
  var writtenAt: Date
  var lastVerifiedAt: Date?
  var business: Business?

  init(uid: String, label: String, business: Business) {
    self.uid = uid
    self.label = label
    self.business = business
    self.writtenAt = .now
    self.lastVerifiedAt = .now
  }
}
