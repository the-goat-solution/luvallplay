// Run before a build goes to Google Play: stops when something a release
// needs is still a placeholder. (A debug build doesn't need these.)
//
//   pnpm --filter native release:check
import { existsSync, readFileSync } from "node:fs";
import { readGoogleServices } from "./write-google-services.mjs";
import path from "node:path";

const problems = [];
const links = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../app/public/.well-known/assetlinks.json"), "utf8"));
const fingerprints = links.flatMap((l) => l.target?.sha256_cert_fingerprints ?? []);
if (fingerprints.length === 0 || fingerprints.some((f) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f))) {
  problems.push(
    "apps/app/public/.well-known/assetlinks.json still has the placeholder fingerprint. Copy the SHA-256 certificate fingerprint from Play Console → Luvallplay → Test and release → App integrity → App signing (\"App signing key certificate\"), and put it there. Without it, links to app.luvallplay.com open the browser, not the app.",
  );
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
