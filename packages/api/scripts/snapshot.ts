// Updates contract.snapshot.json after an additive change to the contract.
//   pnpm --filter @luvallplay/api snapshot
// Refuses a breaking change while the version is the same: bump API_VERSION
// (and keep serving the old one) instead.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { contractBreaks, currentSnapshot, type ContractSnapshot } from "../src/snapshot.ts";

const file = new URL("../contract.snapshot.json", import.meta.url);
const now = currentSnapshot();
if (existsSync(file)) {
  const before = JSON.parse(readFileSync(file, "utf8")) as ContractSnapshot;
  const breaks = contractBreaks(before, now);
  if (breaks.length) {
    console.error(`Breaking changes for apps already released (API ${before.version}):\n- ${breaks.join("\n- ")}\nBump API_VERSION in src/contract.ts and keep serving ${before.version}.`);
    process.exit(1);
  }
}
writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
console.log(`wrote contract.snapshot.json (${Object.keys(now.endpoints).length} endpoints, API ${now.version})`);
