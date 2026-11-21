import SwiftUI

/// The root stack's path, shared so any screen can push (e.g. a new route opens its map).
@Observable
final class Router {
  var path = NavigationPath()
}
