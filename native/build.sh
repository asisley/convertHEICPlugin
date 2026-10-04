#!/bin/bash
set -euo pipefail
plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
app_path="$plugin_root/native/convertHEIC.app"
build_tmp="$(mktemp -d "${TMPDIR:-/tmp}/convertheic-build.XXXXXX")"
trap 'rm -rf "$build_tmp"' EXIT
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources/converter/bin" "$app_path/Contents/Resources/converter/src"
xcrun swiftc -swift-version 5 -O -target arm64-apple-macos13.0 -module-cache-path "$build_tmp/swift-cache" -framework AppKit -framework UniformTypeIdentifiers "$plugin_root/native/Main.swift" -o "$app_path/Contents/MacOS/convertHEIC"
cp "$plugin_root/native/Info.plist" "$app_path/Contents/Info.plist"
cp "$plugin_root/bin/heic-jpg" "$plugin_root/bin/launch" "$app_path/Contents/Resources/converter/bin/"
cp "$plugin_root/src/converter.mjs" "$plugin_root/src/convert-cli.mjs" "$app_path/Contents/Resources/converter/src/"
cp "$plugin_root/CLI-LICENSE.txt" "$app_path/Contents/Resources/CLI-LICENSE.txt"
codesign --force --sign - "$app_path/Contents/Resources/converter/bin/heic-jpg"
codesign --force --sign - "$app_path"
codesign --verify --deep --strict "$app_path"
plutil -lint "$app_path/Contents/Info.plist"
