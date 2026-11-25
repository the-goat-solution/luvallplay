// Old apps keep working: compares this contract with the snapshot apps were
// built against (by default the one on main), and fails on a breaking change
// while the API version is the same. CI runs it on every pull request, so
// a change to contract.snapshot.json itself can't wave a break through.
//   node scripts/compat.ts [released-snapshot.json]
//   (no file: `git show origin/main:packages/api/contract.snapshot.json`)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { contractBreaks, currentSnapshot, type ContractSnapshot } from "../src/snapshot.ts";

function released(): ContractSnapshot | null {
  const file = process.argv[2];
  if (file) return JSON.parse(readFileSync(file, "utf8")) as ContractSnapshot;
  try {
    return JSON.parse(execFileSync("git", ["show", "origin/main:packages/api/contract.snapshot.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as ContractSnapshot;
  } catch {
    return null;
  }
}

const before = released();
if (!before) {
  console.error("No released snapshot to compare with (fetch origin/main, or pass a file).");
  process.exit(1);
}
const now = currentSnapshot();
const breaks = contractBreaks(before, now);
if (breaks.length) {
  console.error(`Apps built against API ${before.version} would break:\n- ${breaks.join("\n- ")}\nMake the change additive, or bump API_VERSION and keep serving ${before.version}.`);
  process.exit(1);
}
const added = Object.keys(now.endpoints).filter((id) => !before.endpoints[id]);
console.log(`API ${now.version}: compatible with the released contract (${Object.keys(before.endpoints).length} endpoints)${added.length ? `; new: ${added.join(", ")}` : ""}.`);
