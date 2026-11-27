// Uploads the signed release bundle (AAB) to a Google Play track, with the
// Play Developer API and the owner's service account: no third-party action
// ever sees the key.
//
//   PLAY_SERVICE_ACCOUNT_JSON=… pnpm --filter native play:upload [--aab path] [--track internal] [--status draft]
//
// - The first build of an app must be uploaded by hand in Play Console; this
//   is for the builds after it.
// - `--status draft` (the default) puts the build in the track as a draft
//   release, which the owner rolls out in Play Console. `completed` rolls it
//   out to the track's testers at once (an app Play still counts as a draft
//   only accepts drafts).
// - The service account's JSON comes from the environment only. It is never
//   printed, and neither is any token.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const PACKAGE = "com.luvallplay.app";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = "https://androidpublisher.googleapis.com";

const b64url = (v) => Buffer.from(v).toString("base64url");

/** Reads the service account's JSON (the file's text, or its base64). Says what is wrong without echoing it. */
export function readServiceAccount(raw) {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, problem: "PLAY_SERVICE_ACCOUNT_JSON isn't set." };
  for (const candidate of [text, Buffer.from(text, "base64").toString("utf8")]) {
    let json;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (json?.type !== "service_account" || !json.client_email || !json.private_key) return { ok: false, problem: "PLAY_SERVICE_ACCOUNT_JSON isn't a service account's key file (no type, client_email or private_key)." };
    return { ok: true, account: { email: json.client_email, key: json.private_key, tokenUri: json.token_uri || "https://oauth2.googleapis.com/token" } };
  }
  return { ok: false, problem: "PLAY_SERVICE_ACCOUNT_JSON isn't JSON (paste the key file's contents, or their base64)." };
}

/** A signed JWT asking Google for a token that may manage Play releases. */
export function signAssertion(account, now = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: account.email, scope: SCOPE, aud: account.tokenUri, iat: now, exp: now + 3300 }));
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(account.key).toString("base64url");
  return `${head}.${body}.${signature}`;
}

/** Uploads `bundle` (a Buffer) to `track`. `fetchFn` is injectable for tests. Returns the version code that went out. */
export async function upload({ account, bundle, track = "internal", status = "draft", releaseName, fetchFn = fetch, now }) {
  if (!["draft", "completed"].includes(status)) throw new Error(`status must be draft or completed, not ${status}`);
  const call = async (what, url, init) => {
    const res = await fetchFn(url, init);
    const text = await res.text();
    if (!res.ok) {
      // Google's own error message is safe to show; a request body is never echoed.
      let detail = "";
      try {
        detail = JSON.parse(text)?.error?.message ?? "";
      } catch {}
      throw new Error(`${what} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
    }
    return text ? JSON.parse(text) : {};
  };
  const json = { "content-type": "application/json" };

  const token = await call("Getting a Google token", account.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signAssertion(account, now) }),
  });
  const auth = { authorization: `Bearer ${token.access_token}` };
  const app = `${API}/androidpublisher/v3/applications/${PACKAGE}`;

  const edit = await call("Opening an edit", `${app}/edits`, { method: "POST", headers: { ...auth, ...json }, body: "{}" });
  const uploaded = await call("Uploading the bundle", `${API}/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/octet-stream" },
    body: bundle,
  });
  await call(`Putting version ${uploaded.versionCode} on the ${track} track`, `${app}/edits/${edit.id}/tracks/${track}`, {
    method: "PUT",
    headers: { ...auth, ...json },
    body: JSON.stringify({ track, releases: [{ name: releaseName ?? String(uploaded.versionCode), versionCodes: [String(uploaded.versionCode)], status }] }),
  });
  await call("Committing the edit", `${app}/edits/${edit.id}:commit`, { method: "POST", headers: { ...auth, ...json }, body: "{}" });
  return { versionCode: uploaded.versionCode, track, status };
}

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const read = readServiceAccount(process.env.PLAY_SERVICE_ACCOUNT_JSON);
  if (!read.ok) {
    console.error(`✗ ${read.problem}`);
    process.exit(1);
  }
  const aab = path.resolve(flag("aab", path.resolve(import.meta.dirname, "../android/app/build/outputs/bundle/release/app-release.aab")));
  try {
    const result = await upload({ account: read.account, bundle: readFileSync(aab), track: flag("track", "internal"), status: flag("status", "draft") });
    console.log(`✓ Version ${result.versionCode} is on the ${result.track} track as a ${result.status} release.`);
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
