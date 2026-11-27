// Seals the phone numbers written before sealing existed (migration
// players_contact_sealed; lib/pii/contact.ts).
//
//   POSTGRES_URL=... node scripts/pii/backfill-phone.mjs            dry run: counts, writes nothing
//   POSTGRES_URL=... node scripts/pii/backfill-phone.mjs --apply    seals them, 200 rows at a time
//
// - Only rows with a plain number and no sealed copy
//   (phone_e164 IS NOT NULL AND phone_sealed IS NULL). A sealed row is never
//   touched, so it can be stopped and run again, and a second run changes
//   nothing. No plain column is changed.
// - --apply needs CONTACT_KEKS and CONTACT_INDEX_KEYS in the environment (the
//   deployment's own; never typed on the command line or pasted anywhere).
// - A host listed in PRODUCTION_DATABASE_HOSTS needs --production to write,
//   as scripts/db/migrate.mjs does: only after the rehearsal, with the
//   owner's OK (docs/rehearsals/2026-11-pii-phone-sealed.md).
// - It prints counts and, for a row the database refused, its id. Never a
//   number, a sealed text, an index or a key.
// - DB_DRIVER=neon-ws works as in the other operator scripts (db-client.mjs).
//
// Exit code: 0 done (or dry run), 1 some rows could not be sealed, 2 refused.
import { dbClient } from "../db-client.mjs";
import { backfillPhones } from "../../lib/pii/contact.ts";

const args = process.argv.slice(2);
const known = ["--apply", "--production"];
const unknown = args.filter((a) => !known.includes(a));
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(" ")}. Options: ${known.join(", ")}.`);
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
  console.error("This is a production database (PRODUCTION_DATABASE_HOSTS). Add --production once the change has been rehearsed and the owner has agreed (test plan §4.4).");
  process.exit(2);
}

const c = await dbClient(url, "pii-backfill-phone");
await c.connect();
let code = 0;
try {
  const result = await backfillPhones(c, { apply, batch: 200, log: (line) => console.log(line) });
  if (!apply) console.log("Dry run: nothing was written. Add --apply to seal them.");
  if (result.failed) code = 1;
} catch (err) {
  // The message of a key or seal error never holds a key or a number (packages/crypto).
  console.error(err instanceof Error ? err.message : "The backfill stopped.");
  code = 2;
} finally {
  await c.end();
}
process.exit(code);
