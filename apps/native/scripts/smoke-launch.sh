#!/usr/bin/env bash
# Launch smoke run on a running emulator (build plan §4.5.1, check 1, first
# part): install the debug APK, open the app, wait, and fail on a crash.
# Signing in, booking and the rest of the scripted run need a test backend and
# come in a later step; this proves the bundle installs, starts and stays up.
set -euo pipefail
APK="${1:-apps/native/android/app/build/outputs/apk/debug/app-debug.apk}"
PKG=com.luvallplay.app

adb install -r "$APK"
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 20

if ! adb shell pidof "$PKG" >/dev/null; then
  echo "::error title=Smoke::$PKG is not running 20 s after launch"
  adb logcat -d -t 300 | tail -n 120
  exit 1
fi
if adb logcat -d | grep -E "FATAL EXCEPTION|ANR in $PKG|Process: $PKG.*(died|crash)"; then
  echo "::error title=Smoke::the app crashed or stopped responding"
  exit 1
fi
adb exec-out screencap -p > smoke-launch.png || true
echo "Smoke run passed: $PKG installed, started and stayed up."
