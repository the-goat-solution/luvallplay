# The Luvallplay store apps (Capacitor shell)

The players' app (`apps/app`) bundled into a native shell: one app for every club, published as **`com.luvallplay.app`** (the id can never change once the app is on a store). Android first (build plan §4.5.1); `ios/` is added when the Apple developer account exists.

## Build

```
pnpm install
NATIVE_API_BASE=https://www.threewolvesbadminton.org pnpm --filter native web   # the players' app, built into www/
pnpm --filter native sync:android                                                # copied into the Android project
pnpm --filter native android:debug                                               # a debug APK (needs JDK 21 and the Android SDK)
```

`NATIVE_API_BASE` is the public API host. Inside the shell the page's own origin is `https://localhost`, so the app can't use "this page's origin" as it does on the web. The API's allow-list already includes `https://localhost`.

CI builds the debug APK on every pull request (job "Android shell") and keeps it for 14 days as the `android-debug-apk` artifact, so it can be put on a phone by hand.

## What the shell gives the app

| Plugin | For |
|---|---|
| `capacitor-secure-storage-plugin` | The session token in the Android Keystore (later the iOS Keychain); the app waits for it at start (`apps/app/src/lib/native/`) |
| `@capacitor/app` | The Android back button, and opening the app from a link (wired up in the next steps) |

Not yet here, in the order they come: app links (`assetlinks.json`), opening outside pages in the in-app browser, saving and sharing files, push notifications (Firebase), Play Billing for Vision passes.

## Settings that are deliberate

- `allowBackup="false"`: the token lives in the Keystore, which a backup restored on another phone couldn't read.
- No orientation or resize locks (Android 16 ignores them on large screens anyway), target SDK 36, the internet permission only.
- No remote `server.url`: the app's files are in the bundle (Apple's and Google's "not a website in a wrapper" rule).

`tests/shell.test.ts` holds these in place.

## For the owner: Play Console

Nothing is uploaded from here yet. When the release build exists, Play App Signing will hold the signing key; the upload key and the Play service-account file are given through the environment's secret settings, never pasted into a chat or committed.
