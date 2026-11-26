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
| `@capacitor/browser` | Pages outside the app (Stripe's billing page, the club's admin, receipts, the club's website) open over the app in the phone's in-app browser; a link back to `app.luvallplay.com` closes it |
| `@capacitor/app` | The Android back button (a sheet closes first, then one screen back) and opening the app from a link |

Not yet here, in the order they come: saving and sharing files, push notifications (Firebase), Play Billing for Vision passes.

## Settings that are deliberate

- `allowBackup="false"`: the token lives in the Keystore, which a backup restored on another phone couldn't read.
- No orientation or resize locks (Android 16 ignores them on large screens anyway), target SDK 36, the internet permission only.
- No remote `server.url`: the app's files are in the bundle (Apple's and Google's "not a website in a wrapper" rule).

`tests/shell.test.ts` holds these in place.

## Links that open the app

`https://app.luvallplay.com/...` addresses (pairing invites, links in emails) open the store app once Android trusts it. Two halves:

- the Android project says which addresses are the app's (`AndroidManifest.xml`, an `autoVerify` intent filter);
- the address says which app may open them: `apps/app/public/.well-known/assetlinks.json`, served at `https://app.luvallplay.com/.well-known/assetlinks.json`.

That file needs the fingerprint of the key Google signs the app with. Until it is there, links simply open the browser as they do today. `pnpm --filter native release:check` fails while the placeholder is still in it.

Inside the app, a link leads only to a screen of the app (`apps/app/src/lib/native/public-url.ts`), and links the app makes (a pairing invite) start with `https://app.luvallplay.com`, not the shell's own `https://localhost`.

## For the owner: Play Console

1. Create the app in Play Console with the package name **`com.luvallplay.app`** (default language English (Australia)).
2. Once the first build has been uploaded to any track, open **Test and release → App integrity → App signing** and copy the **SHA-256 certificate fingerprint** under "App signing key certificate" (it looks like `AB:CD:…`, 32 pairs). Send it to lane N, or paste it into `assetlinks.json` in place of `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT`. A fingerprint is public information, not a secret.
3. Nothing is uploaded from here yet. The upload key and the Play service-account file are secrets: they are given through the environment's secret settings, never pasted into a chat or committed.

## Push notifications (off until there is a Firebase project)

`@capacitor/push-notifications` is in the Android project, and the app's side is `apps/app/src/lib/native/push.ts`. It stays off until the build has the Firebase project's file:

- `android/app/google-services.json` is **not in the repository** (`.gitignore`). `pnpm --filter native web` prints whether it found it and builds the app with push on or off to match; Gradle applies Google's plugin only when the file is there.
- Without the file the app never asks Android for a device address (that call would stop the app), so a build without it is safe to install.
- The phone is asked for permission only when the person turns notifications on in Settings, never at first launch.
- A notification can open a screen of the app (`data.path`, a path only) and nothing else.

For the owner, when the time comes: Firebase console → the Luvallplay project → Project settings → Your apps → Add app → Android → package name `com.luvallplay.app` → download `google-services.json`. It goes into the build through the repository's Actions secrets, and the server's sending key goes into the hosting environment settings; neither is ever pasted into a chat.
