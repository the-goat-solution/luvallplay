#!/usr/bin/env bash
# The iOS workflows' Xcode: the newest on the runner, which must be 26 or later
# (App Store Connect takes only the iOS 26 SDK or later), and whether it can
# build for iPhone Duo.
#
# Apple (Preparing your app for iPhone Duo): "When you build with Xcode 26 and
# earlier, your app doesn't extend under the status bar and camera", and the
# fold API (UIView.reservedRegions(kind:options:)) is iOS 27.1. So with an
# iOS 27.1 SDK or later this sets FOLD_API=1 for the later steps (and sets nothing otherwise), which build
# the Swift fold plugin (apps/native/ios/App/App/ShellViewController.swift);
# without it the build goes ahead as before and says why it isn't Duo-ready.
#
# `select-xcode.sh --sdk "iphoneos26.2"` (no runner needed) prints 1 or 0 for that SDK name.
set -eo pipefail

# 0 or 1: whether this iphoneos SDK name (e.g. iphoneos27.1) is 27.1 or later.
fold_ready() {
  local v="${1#iphoneos}"
  [ -n "$v" ] && [ "$(printf '%s\n%s\n' 27.1 "$v" | sort -V | head -1)" = "27.1" ] && echo 1 || echo 0
}

if [ "${1:-}" = "--sdk" ]; then fold_ready "$2"; exit 0; fi

X=$(ls -d /Applications/Xcode_*.app 2>/dev/null | sort -V | tail -1)
[ -n "$X" ] || { echo "::error title=Xcode::no Xcode_*.app found on the runner"; exit 1; }
sudo xcode-select -s "$X/Contents/Developer"
xcodebuild -version
MAJOR=$(xcodebuild -version | head -1 | sed 's/Xcode //' | cut -d. -f1)
[ "$MAJOR" -ge 26 ] || { echo "::error title=Xcode::$X is older than Xcode 26; use a newer runner image"; exit 1; }

SDK=$(xcodebuild -showsdks | grep -o 'iphoneos[0-9][0-9.]*' | sort -V | tail -1)
READY=$(fold_ready "$SDK")
echo "iOS SDK: $SDK; iPhone Duo support: $READY"
# Only set when ready: the build steps test "is FOLD_API set", so a 0 would count as on.
[ "$READY" != 1 ] || [ -z "${GITHUB_ENV:-}" ] || echo "FOLD_API=1" >> "$GITHUB_ENV"
if [ "$READY" != 1 ]; then
  echo "::warning title=iPhone Duo::$X has the $SDK SDK. iPhone Duo needs the iOS 27.1 SDK (Xcode 27.1 or later): this build does not extend under the status bar and camera there, and the fold plugin is not built. Set the repository variable IOS_RUNNER to a runner image that has it."
fi
