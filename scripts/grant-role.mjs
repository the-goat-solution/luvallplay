// One-off grant of a club role (and optionally platform admin) by email.
// Build plan §2.4: the first owners (Timba and Kelcee) are granted this way.
//
//   POSTGRES_URL=... node scripts/grant-role.mjs --role owner --platform \
//     --email first@example.com --email second@example.com
//
// - Emails are passed in at run time and never committed to the repo.
// - Idempotent: running it twice changes nothing the second time.
// - An email without an account gets an invite, applied on first sign-in.
// - Never demotes the last owner (the same guard as the admin page).
// - Every change is written to admin_audit_log as actor "script".
// - Rehearse first: data-guard rehearse --run "node scripts/grant-role.mjs ..."
//   on a Neon branch of production (test plan §4.5).
import { dbClient } from "./db-client.mjs";
import { setPlatformAdmin, setRoleByEmail, normalizeEmail } from "../lib/admin-roles.ts";

function parseArgs(argv) {
  const out = { emails: [], role: null, platform: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.emails.push(argv[++i]);
    else if (a === "--role") out.role = argv[++i];
    else if (a === "--platform") out.platform = true;
    else if (a === "--dry-run") out.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.emails.length === 0 || (!args.role && !args.platform) || args.emails.some((e) => !e)) {
  console.error("Usage: node scripts/grant-role.mjs --email <email> [--email <email> ...] [--role owner|admin|coach] [--platform] [--dry-run]");
  process.exit(2);
}
const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}

// Never print an email in full: logs may be shared.
const mask = (e) => e.replace(/^(.).*?(@.*)$/, "$1***$2");

const client = await dbClient(url, "grant-role");
await client.connect();
const db = { query: (text, params) => client.query(text, params) };
const actor = { kind: "script" };
try {
  await client.query("BEGIN");
  for (const raw of args.emails) {
    const email = normalizeEmail(raw);
    if (args.role) {
      const r = await setRoleByEmail(db, actor, { email, role: args.role });
      if (r.kind === "invited") console.log(`${mask(email)}: no account yet, invite #${r.inviteId} for ${r.role} (applied on first sign-in).`);
      else if (r.kind === "unchanged") console.log(`${mask(email)}: already ${r.role} (player ${r.playerId}).`);
      else console.log(`${mask(email)}: ${r.previousRole ?? "no role"} → ${r.role} (player ${r.playerId}).`);
    }
    if (args.platform) {
      const { rows } = await client.query(`SELECT id FROM players WHERE email = $1 AND deleted_at IS NULL;`, [email]);
      if (!rows[0]) {
        console.log(`${mask(email)}: no account, so no platform admin yet (run again after their first sign-in).`);
      } else {
        const added = await setPlatformAdmin(db, actor, Number(rows[0].id), true);
        console.log(`${mask(email)}: platform admin ${added ? "granted" : "already"} (player ${rows[0].id}).`);
      }
    }
  }
  if (args.dryRun) {
    await client.query("ROLLBACK");
    console.log("Dry run: rolled back.");
  } else {
    await client.query("COMMIT");
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`Failed, nothing changed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
