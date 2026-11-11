#!/usr/bin/env bash
# Turns dist/ binaries into the downloads people grab from GitHub Releases.
set -e
cd "$(dirname "$0")/.."
rm -rf release && mkdir -p release
stage() { # name binary target-filename
  local d="release/$1"; mkdir -p "$d/filters"
  cp "dist/$2" "$d/$3"; chmod +x "$d/$3" || true
  cp filters/*.json "$d/filters/"
  cp tools/HOW-TO-OPEN.txt "$d/"
}
stage SharkHunter-windows sharkhunter-win-x64.exe SharkHunter.exe
stage SharkHunter-mac-apple-silicon sharkhunter-macos-arm64 SharkHunter
stage SharkHunter-mac-intel sharkhunter-macos-x64 SharkHunter
stage SharkHunter-linux sharkhunter-linux-x64 sharkhunter
(cd release && for d in SharkHunter-windows SharkHunter-mac-apple-silicon SharkHunter-mac-intel; do zip -qry "$d.zip" "$d"; done)
(cd release && tar czf SharkHunter-linux.tar.gz SharkHunter-linux)
rm -rf release/SharkHunter-windows release/SharkHunter-mac-apple-silicon release/SharkHunter-mac-intel release/SharkHunter-linux
ls -la release
