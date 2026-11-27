// After a key rotation: brings what an older key sealed to the current key
// (lib/crypto-purposes.ts; the steps are in packages/crypto/README.md,
// "Rotating a key").
//
//   POSTGRES_URL=... node scripts/crypto/reseal.mjs --purpose <name>            dry run: counts per key id, writes nothing
//   POSTGRES_URL=... node scripts/crypto/reseal.mjs --purpose <name> --apply    re-seals what isn't on the current key, 100 rows per transaction
//
// Purposes: push_devices.sealed (PUSH_KEKS), junior_medical_notes.sealed
// (JUNIORS_KEKS), players.phone_sealed (CONTACT_KEKS; brings the phone index
// to the current CONTACT_INDEX_KEYS key in the same write), and contact-index
// (re-indexes phone numbers when only CONTACT_INDEX_KEYS was rotated).
//
// - The current key is the FIRST one in the purpose's list. The older keys
//   must still be listed: a row is opened with the key that sealed it.
// - Safe to stop and to run again. Each batch is one transaction, so every
//   row is either as it was or fully re-sealed, and opens either way. A row
//   the app writes meanwhile is left as the app wrote it.
// - Only the sealed column is written (and a phone number's index). Nothing
//   is cleared. A row that can't be opened is left exactly as it was, counted
//   and named by its key; the run then exits 1.
// - Key lists come from the environment (the deployment's own; never typed
//   on the command line or pasted anywhere).
// - A host listed in PRODUCTION_DATABASE_HOSTS needs --production to write,
//   as scripts/db/migrate.mjs does: only with the owner's OK.
// - It prints counts, key ids and row keys. Never plain text, a sealed text,
//   an index or a key.
// - Connect as the database's owner, as for migrations. A club-owned table
//   is worked through one club at a time, each transaction naming its club.
// - DB_DRIVER=neon-ws works as in the other operator scripts (db-client.mjs).
//
// Exit code: 0 done (or dry run), 1 some rows were left with a problem, 2 refused or stopped.
import { dbClient } from "../db-client.mjs";
import { RESEAL_PURPOSES, reseal } from "../../lib/crypto-purposes.ts";

const args = process.argv.slice(2);
const flags = ["--apply", "--production"];
let purpose = null;
const unknown = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--purpose") purpose = args[++i] ?? "";
  else if (args[i].startsWith("--purpose=")) purpose = args[i].slice("--purpose=".length);
  else if (!flags.includes(args[i])) unknown.push(args[i]);
}
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(" ")}. Options: --purpose <name>, ${flags.join(", ")}.`);
  process.exit(2);
}
if (!purpose || !RESEAL_PURPOSES.includes(purpose)) {
  console.error(`Say which purpose: --purpose <name>. Known: ${RESEAL_PURPOSES.join(", ")}.`);
  process.exit(2);
}
const apply = args.includes("--apply");

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}

// The same reading of PRODUCTION_DATABASE_HOSTS as scripts/db/migrate.mjs.
function isProductionHost(target) {
  const short = (h) => h.trim().toLowerCase().split(".")[0].replace(/-pooler$/, "");
  const hosts = (process.env.PRODUCTION_DATABASE_HOSTS ?? "").split(",").map(short).filter(Boolean);
  if (!hosts.length) return false;
  try {
    return hosts.includes(short(new URL(target).hostname));
  } catch {
    return false;
  }
}
if (apply && isProductionHost(url) && !args.includes("--production")) {
  console.error("This is a production database (PRODUCTION_DATABASE_HOSTS). Add --production once the owner has agreed (test plan §4.4).");
  process.exit(2);
}

const c = await dbClient(url, "crypto-reseal");
await c.connect();
let code = 0;
try {
  const result = await reseal(c, { purpose, apply, batch: 100, log: (line) => console.log(line) });
  if (!apply && result.current) console.log("Dry run: nothing was written. Add --apply to do it.");
  if (result.problems) code = 1;
} catch (err) {
  // A key or seal error's message never holds a key or a value (packages/crypto).
  // A database error's message can quote a row, so only its code is said.
  const dbCode = /^[0-9A-Z]{5}$/.test(String(err?.code ?? "")) ? String(err.code) : null;
  console.error(dbCode ? `The run stopped: database error ${dbCode}. What was committed stays; run it again to continue.` : err instanceof Error ? err.message : "The run stopped.");
  code = 2;
} finally {
  await c.end();
}
process.exit(code);
