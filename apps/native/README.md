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
| `@capacitor/filesystem`, `@capacitor/share` | "Download my data": the file is written to the app's cache and offered through the phone's share sheet (a web view can't download) |
| `@capacitor/app` | The Android back button (a sheet closes first, then one screen back) and opening the app from a link |

Not yet here: Play Billing for Vision passes. Until it exists the store app sells no Vision passes: no prices, no buy button (`sellsPasses()` in `apps/app/src/lib/native/platform.ts`).

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
3. The upload key and the Play service-account file are secrets: they go into GitHub's secret settings (below), never into a chat and never into the repository.

## For the owner: the first Play build (internal testing)

The workflow `.github/workflows/android-release.yml` builds the **signed release bundle (AAB)** on every push to `main` and keeps it for 30 days. Play Console needs the first build uploaded by hand; later ones can be sent by the workflow (step 7). Until step 3 is done the workflow finishes green and says it built nothing.

**1. Make the upload key (once, on your computer).** It needs a JDK (`keytool` comes with it).

```
keytool -genkeypair -v -keystore luvallplay-upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

It asks for a keystore password, a key password (pressing Enter reuses the keystore's) and your name and organisation. Keep `luvallplay-upload.jks` and both passwords in your password manager, and **never commit or send them**. This is only the *upload* key: Google keeps the real signing key (Play App Signing), so a lost upload key can be reset by Google's support.

**2. Turn the file into text** (a secret can't hold a file):

- Mac: `base64 -i luvallplay-upload.jks | tr -d '\n' | pbcopy`
- Linux: `base64 -w0 luvallplay-upload.jks`
- Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("luvallplay-upload.jks")) | Set-Clipboard`

**3. GitHub → the `luvallplay` repository → Settings → Secrets and variables → Actions.** *Secrets* tab → New repository secret, one each:

| Name | Value |
|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | the text from step 2 |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `upload` (the `-alias` above) |
| `ANDROID_KEY_PASSWORD` | the key password |
| `GOOGLE_SERVICES_JSON` | already there if you did the push-notification step |

*Variables* tab → New repository variable: `NATIVE_API_BASE` = the public API host the app talks to (a web address like `https://…`, no slash at the end). The build stops with a message if it is missing.

**4. Run it.** Actions → **Android release** → Run workflow (or merge anything to `main`). When it is green, open the run: the summary shows the **upload key's SHA-256** and the bundle is the `android-release-aab` artifact. Download and unzip it: `app-release.aab`.

**5. Upload by hand the first time.** Play Console → Luvallplay → **Test and release → Testing → Internal testing → Create new release**. Accept Play App Signing when it asks, drop in `app-release.aab`, then add testers (**Testers** tab: create an email list and tick it), save, and roll out. Testers get a link on the same tab. The release notes to paste are in `docs/store/listing-en-AU.md`.

**6. Afterwards**, copy the *App signing key certificate* SHA-256 into `assetlinks.json` (the section above). Only then may a build go to any track after internal testing: `release:check` refuses it until you do.

**7. Optional: let the workflow upload for you.** Needed once:

1. Google Cloud console → pick (or create) a project → **APIs & Services → Library** → enable **Google Play Android Developer API**.
2. **IAM & Admin → Service accounts → Create service account** (name it `luvallplay-play-upload`, no project roles needed) → its **Keys** tab → **Add key → Create new key → JSON**. A file downloads.
3. Play Console → **Users and permissions → Invite new users** → paste the service account's email address (`…@….iam.gserviceaccount.com`) → under *App permissions* add **Luvallplay** → tick **Release to testing tracks** (nothing more) → invite. (Google can take a few hours to start honouring it.)
4. GitHub secret `PLAY_SERVICE_ACCOUNT_JSON` = the whole contents of the downloaded file. Then delete the downloaded file.

From then on: Actions → **Android release** → Run workflow → tick **Upload to Play**. The build lands in the internal testing track as a **draft** release: open it in Play Console and roll it out. Nothing is uploaded unless you tick that box.

If anything fails, the run says why in plain words (the script never prints a key or a token).

## Push notifications (off until there is a Firebase project)

`@capacitor/push-notifications` is in the Android project, and the app's side is `apps/app/src/lib/native/push.ts`. It stays off until the build has the Firebase project's file:

- `android/app/google-services.json` is **not in the repository** (`.gitignore`). `pnpm --filter native web` prints whether it found it and builds the app with push on or off to match; Gradle applies Google's plugin only when the file is there.
- Without the file the app never asks Android for a device address (that call would stop the app), so a build without it is safe to install.
- The phone is asked for permission only when the person turns notifications on in Settings, never at first launch.
- A notification can open a screen of the app (`data.path`, a path only) and nothing else.

Where the file comes from in a build: the `GOOGLE_SERVICES_JSON` setting (`pnpm --filter native google-services` writes the file from it, and stops if it is another app's file). CI does this on `main` only, from the repository secret of that name; pull requests and local debug builds have no file and no push. `pnpm --filter native release:check` fails when the file is missing.

### For the owner: the Firebase file (a GitHub secret)

1. Firebase console → the **Luvallplay** project → ⚙️ **Project settings → General → Your apps** → the Android app `com.luvallplay.app` → **google-services.json** (download).
2. GitHub → the `luvallplay` repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `GOOGLE_SERVICES_JSON`
   - Secret: open the downloaded file in a text editor, select everything, paste it.
3. Save. From the next build on `main`, the Android build has push notifications. Nothing needs to be sent to anyone, and the file is never pasted into a chat or committed.

The server's own keys (`PUSH_KEKS`, `FCM_SERVICE_ACCOUNT`) go into the hosting environment settings: `docs/SETUP-push.md`.

### Push notifications on iPhone

Same server sender (Firebase), so iOS needs Firebase's own token, not Apple's: `ios/App/App/AppDelegate.swift` starts Firebase, gives it the APNs token and passes the FCM token to the push plugin. Firebase is added to the Xcode project (not `CapApp-SPM`, which `cap sync` rewrites).

- `ios/App/App/GoogleService-Info.plist` is **not in the repository**. `pnpm --filter native google-service-info` writes it from the `GOOGLE_SERVICE_INFO_PLIST` setting (the file's contents, or base64) and stops if it is another app's file. `ios-release.yml` does this; the pull-request build has none, so push is off there.
- Without the file Firebase isn't started and the app still builds and runs.
- Owner steps: Firebase console → **Project settings → Your apps → Add app → iOS**, bundle id `com.luvallplay.app` → download `GoogleService-Info.plist` → repository secret `GOOGLE_SERVICE_INFO_PLIST`. Then Apple Developer → **Keys** → new key with *Apple Push Notifications service (APNs)* (a separate key, not the App Store Connect one) → Firebase → **Project settings → Cloud Messaging → Apple app configuration** → upload the `.p8` with its Key ID and Team ID `75XLUPLLJ9`.
