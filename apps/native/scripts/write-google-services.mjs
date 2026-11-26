// Puts the Firebase project's file where the Android build looks for it
// (android/app/google-services.json), from the GOOGLE_SERVICES_JSON setting:
// the file's contents as they are, or their base64. The file is never in the
// repository.
//
// - Setting not there: nothing is written and the build goes on with push
//   notifications off (a debug build, a pull request).
// - Setting there but not this app's file: it stops, so a release can't go
//   out with the wrong project's file.
//
//   GOOGLE_SERVICES_JSON=… pnpm --filter native google-services
import { writeFileSync } from "node:fs";
import path from "node:path";

export const APP_ID = "com.luvallplay.app";

/** The file's text when `raw` is a google-services.json for this app, else an explanation. Never echoes the contents. */
export function readGoogleServices(raw) {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, empty: true, problem: "GOOGLE_SERVICES_JSON isn't set." };
  for (const candidate of [text, Buffer.from(text, "base64").toString("utf8")]) {
    let json;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    const packages = (json?.client ?? []).map((c) => c?.client_info?.android_client_info?.package_name);
    if (!json?.project_info?.project_id || packages.length === 0) return { ok: false, problem: "GOOGLE_SERVICES_JSON isn't a google-services.json file (no project or no Android app in it)." };
    if (!packages.includes(APP_ID)) return { ok: false, problem: `GOOGLE_SERVICES_JSON is for another app: it has no Android app with the package name ${APP_ID}.` };
    return { ok: true, text: `${JSON.stringify(json, null, 2)}\n` };
  }
  return { ok: false, problem: "GOOGLE_SERVICES_JSON isn't JSON (paste the file's contents, or their base64)." };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = readGoogleServices(process.env.GOOGLE_SERVICES_JSON);
  if (result.ok) {
    writeFileSync(path.resolve(import.meta.dirname, "..", "android", "app", "google-services.json"), result.text, { mode: 0o600 });
    console.log("google-services.json written: this build has push notifications.");
  } else if (result.empty) {
    console.log("GOOGLE_SERVICES_JSON isn't set: this build has no push notifications.");
  } else {
    console.error(`✗ ${result.problem}`);
    process.exit(1);
  }
}
