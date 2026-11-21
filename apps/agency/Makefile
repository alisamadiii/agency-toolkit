# Agency (native iOS)
SIM := platform=iOS Simulator,name=iPhone 17,OS=27.0

.PHONY: project icon build run open clean

project:
	xcodegen generate

icon:
	swift tools/make-icon.swift Agency/Resources/Assets.xcassets/AppIcon.appiconset

# Debug build for the simulator (no NFC there; use it to check the app compiles and the UI works).
build: project
	xcodebuild -project Agency.xcodeproj -scheme Agency -configuration Debug -destination '$(SIM)' -derivedDataPath build build | grep -E "error:|warning:|BUILD" || true

# Build, then install + launch on the booted simulator.
run: build
	xcrun simctl boot DF002F80-9796-40F9-BEBD-DAF8A24C30E0 2>/dev/null || true
	open -a Simulator
	xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/Agency.app
	xcrun simctl launch booted com.alisamadi.agency

# Open in Xcode to run on a real iPhone (NFC only works on device).
open: project
	open Agency.xcodeproj

clean:
	rm -rf build
