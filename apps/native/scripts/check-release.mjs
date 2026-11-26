// Run before a build goes to Google Play: stops when something a release
// needs is still a placeholder. (A debug build doesn't need these.)
//
//   pnpm --filter native release:check
import { readFileSync } from "node:fs";
import path from "node:path";

const problems = [];
const links = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../app/public/.well-known/assetlinks.json"), "utf8"));
const fingerprints = links.flatMap((l) => l.target?.sha256_cert_fingerprints ?? []);
if (fingerprints.length === 0 || fingerprints.some((f) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f))) {
  problems.push(
    "apps/app/public/.well-known/assetlinks.json still has the placeholder fingerprint. Copy the SHA-256 certificate fingerprint from Play Console → Luvallplay → Test and release → App integrity → App signing (\"App signing key certificate\"), and put it there. Without it, links to app.luvallplay.com open the browser, not the app.",
  );
}
for (const p of problems) console.error(`✗ ${p}`);
if (problems.length) process.exit(1);
console.log("Release checks passed.");
