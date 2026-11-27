// Run before a build goes to Google Play: stops when something a release
// needs is still a placeholder. (A debug build doesn't need these.)
//
//   pnpm --filter native release:check [--allow-placeholder-links]
//
// --allow-placeholder-links: the app-links fingerprint only exists once Play
// has the first upload, so a build for the internal testing track may go out
// without it (links open the browser until it is added). Every later track
// must pass the full check.
import { existsSync, readFileSync } from "node:fs";
import { readGoogleServices } from "./write-google-services.mjs";
import path from "node:path";

const problems = [];
const allowPlaceholderLinks = process.argv.includes("--allow-placeholder-links");
const links = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../app/public/.well-known/assetlinks.json"), "utf8"));
const fingerprints = links.flatMap((l) => l.target?.sha256_cert_fingerprints ?? []);
if (fingerprints.length === 0 || fingerprints.some((f) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f))) {
  if (allowPlaceholderLinks) console.warn("! assetlinks.json still has the placeholder fingerprint: links to app.luvallplay.com open the browser, not the app. Fine for internal testing only.");
  else problems.push(
    "apps/app/public/.well-known/assetlinks.json still has the placeholder fingerprint. Copy the SHA-256 certificate fingerprint from Play Console → Luvallplay → Test and release → App integrity → App signing (\"App signing key certificate\"), and put it there. Without it, links to app.luvallplay.com open the browser, not the app.",
  );
}
const aasa = readFileSync(path.resolve(import.meta.dirname, "../../app/public/.well-known/apple-app-site-association"), "utf8");
if (/TEAM_ID_PLACEHOLDER/.test(aasa) && !process.argv.includes("--android-only")) {
  problems.push("apps/app/public/.well-known/apple-app-site-association still has TEAM_ID_PLACEHOLDER. Put your Apple Team ID (developer.apple.com → Membership details) in front of com.luvallplay.app. Without it, links to app.luvallplay.com open Safari, not the iPhone app.");
}
const services = path.resolve(import.meta.dirname, "../android/app/google-services.json");
if (!existsSync(services)) {
  problems.push("android/app/google-services.json isn't there, so this build would have no push notifications. In CI it is written from the GOOGLE_SERVICES_JSON secret (pnpm --filter native google-services); see apps/native/README.md.");
} else {
  const checked = readGoogleServices(readFileSync(services, "utf8"));
  if (!checked.ok) problems.push(`android/app/google-services.json: ${checked.problem}`);
}
for (const p of problems) console.error(`✗ ${p}`);
if (problems.length) process.exit(1);
console.log("Release checks passed.");
