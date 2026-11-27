// Puts the Firebase project's iOS file where the iOS build looks for it
// (ios/App/App/GoogleService-Info.plist), from the GOOGLE_SERVICE_INFO_PLIST
// setting: the file's contents as they are, or their base64. The file is never
// in the repository.
//
// - Setting not there: nothing is written and the build goes on with push
//   notifications off (a pull request, a local build).
// - Setting there but not this app's file: it stops, so a release can't go
//   out with the wrong app's file.
//
//   GOOGLE_SERVICE_INFO_PLIST=… pnpm --filter native google-service-info
import { writeFileSync } from "node:fs";
import path from "node:path";

export const APP_ID = "com.luvallplay.app";

const value = (text, key) => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(text)?.[1]?.trim();

/** The file's text when `raw` is a GoogleService-Info.plist for this app, else an explanation. Never echoes the contents. */
export function readGoogleServiceInfo(raw) {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, empty: true, problem: "GOOGLE_SERVICE_INFO_PLIST isn't set." };
  for (const candidate of [text, Buffer.from(text, "base64").toString("utf8")]) {
    if (!/<plist[\s>]/.test(candidate)) continue;
    if (!value(candidate, "PROJECT_ID") || !value(candidate, "GOOGLE_APP_ID")) return { ok: false, problem: "GOOGLE_SERVICE_INFO_PLIST isn't a GoogleService-Info.plist file (no project or app id in it)." };
    if (value(candidate, "BUNDLE_ID") !== APP_ID) return { ok: false, problem: `GOOGLE_SERVICE_INFO_PLIST is for another app: its bundle id isn't ${APP_ID}.` };
    return { ok: true, text: `${candidate}\n` };
  }
  return { ok: false, problem: "GOOGLE_SERVICE_INFO_PLIST isn't a property list (paste the file's contents, or their base64)." };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = readGoogleServiceInfo(process.env.GOOGLE_SERVICE_INFO_PLIST);
  if (result.ok) {
    writeFileSync(path.resolve(import.meta.dirname, "..", "ios", "App", "App", "GoogleService-Info.plist"), result.text, { mode: 0o600 });
    console.log("GoogleService-Info.plist written: this build has push notifications.");
  } else if (result.empty) {
    console.log("GOOGLE_SERVICE_INFO_PLIST isn't set: this build has no push notifications.");
  } else {
    console.error(`✗ ${result.problem}`);
    process.exit(1);
  }
}
