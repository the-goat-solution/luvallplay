// Phase 3 step 1: checks the tenants tables after migration 0003 (read-only
// unless --reconcile is given).
//
//   node scripts/tenants/verify.mjs               report; exit 1 on any problem
//   node scripts/tenants/verify.mjs --reconcile   first bring club_members in
//                                                 line with club_roles and the
//                                                 leaderboard flag (idempotent)
//
// Checks: exactly one club (no other club may exist in production while the
// readiness gates are open, build plan §11.3); one module row per module in
// the registry; one club_members row per account; every club_roles role
// mirrored; at least one live owner; and, once migration 0004 has run, every
// row of every club-owned table belongs to the club (no NULL tenant_id); and,
// once migration 0005 has run, user_id agrees with the email join on every
// row of the ten email-linked tables, and the triggers that keep it so exist.
// Prints counts only, never an email.
//
// POSTGRES_URL chooses the database. DB_DRIVER=neon-ws works as in the other
// operator scripts.
import { dbClient } from "../db-client.mjs";
import { MODULES } from "@luvallplay/modules";
import { CLUB_OWNED_TABLES, EMAIL_LINKED_TABLES } from "@luvallplay/db/tenancy";
import { clubMemberDrift, defaultTenantSlug, reconcileClubMembers } from "../../lib/tenant-members.ts";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}
const reconcile = process.argv.includes("--reconcile");
const slug = defaultTenantSlug();
const client = await dbClient(url, "tenants-verify");
await client.connect();
const db = { query: (text, params) => client.query(text, params) };
const problems = [];
try {
  if (reconcile) console.log(`Reconciled: ${await reconcileClubMembers(db, slug)} row(s) written.`);

  const clubs = (await db.query(`SELECT id, slug, status, country, region, timezone, currency, payment_mode FROM tenants ORDER BY id`)).rows;
  console.log(`Clubs: ${clubs.map((t) => `${t.slug} (id ${t.id}, ${t.status}, ${t.country}/${t.region}, ${t.timezone}, ${t.currency}, ${t.payment_mode})`).join("; ") || "none"}`);
  if (clubs.length !== 1 || clubs[0].slug !== slug) problems.push(`expected exactly one club, "${slug}"`);

  const modules = (await db.query(`SELECT m.module_id, m.enabled FROM tenant_modules m JOIN tenants t ON t.id = m.tenant_id WHERE t.slug = $1`, [slug])).rows;
  const ids = new Set(modules.map((m) => m.module_id));
  const missing = MODULES.map((m) => m.id).filter((id) => !ids.has(id));
  const unknown = [...ids].filter((id) => !MODULES.some((m) => m.id === id));
  console.log(`Modules: ${modules.length} rows, ${modules.filter((m) => m.enabled).length} on (registry has ${MODULES.length}).`);
  if (missing.length) problems.push(`modules without a row: ${missing.join(", ")}`);
  if (unknown.length) problems.push(`module rows not in the registry: ${unknown.join(", ")}`);

  const counts = (
    await db.query(
      `SELECT (SELECT count(*)::int FROM players) AS accounts,
              (SELECT count(*)::int FROM club_members m JOIN tenants t ON t.id = m.tenant_id WHERE t.slug = $1) AS members,
              (SELECT count(*)::int FROM club_roles) AS roles,
              (SELECT count(*)::int FROM platform_admins) AS platform_admins,
              (SELECT count(*)::int FROM club_members m JOIN tenants t ON t.id = m.tenant_id JOIN players p ON p.id = m.user_id
                 WHERE t.slug = $1 AND m.role = 'owner' AND m.status = 'active' AND p.deleted_at IS NULL) AS live_owners`,
      [slug],
    )
  ).rows[0];
  const byRole = (await db.query(`SELECT m.role, count(*)::int AS n FROM club_members m JOIN tenants t ON t.id = m.tenant_id WHERE t.slug = $1 GROUP BY 1 ORDER BY 1`, [slug])).rows;
  console.log(`Accounts: ${counts.accounts}. Club members: ${counts.members} (${byRole.map((r) => `${r.role} ${r.n}`).join(", ")}).`);
  console.log(`club_roles rows: ${counts.roles}. Platform admins: ${counts.platform_admins}. Live owners in club_members: ${counts.live_owners}.`);
  if (counts.accounts !== counts.members) problems.push(`${counts.accounts} accounts but ${counts.members} club members`);
  if (counts.live_owners < 1) problems.push("no live owner in club_members");

  // Step 2: tenant_id on every club-owned table (skipped before migration 0004).
  const withColumn = new Set(
    (await db.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'`)).rows.map((r) => r.table_name),
  );
  if (withColumn.has("bookings") && clubs[0]) {
    let rows = 0;
    for (const t of CLUB_OWNED_TABLES) {
      if (!withColumn.has(t)) {
        problems.push(`${t} has no tenant_id column`);
        continue;
      }
      const r = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE tenant_id IS DISTINCT FROM $1)::int AS bad FROM ${t}`, [clubs[0].id])).rows[0];
      rows += r.n;
      if (r.bad) problems.push(`${t}: ${r.bad} row(s) without the club's tenant_id`);
    }
    console.log(`tenant_id: ${CLUB_OWNED_TABLES.length} club-owned tables, ${rows} rows checked.`);
  } else {
    console.log("tenant_id: columns not added yet (migration 0004 pending).");
  }

  // Step 3: user_id beside the email (skipped before migration 0005).
  const withUserId = new Set(
    (await db.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id'`)).rows.map((r) => r.table_name),
  );
  if (withUserId.has("memberships")) {
    let rows = 0;
    let linked = 0;
    for (const t of EMAIL_LINKED_TABLES) {
      const r = (
        await db.query(
          `SELECT count(*)::int AS n, count(r.user_id)::int AS linked,
                  count(*) FILTER (WHERE r.user_id IS DISTINCT FROM (SELECT p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email))))::int AS bad
           FROM ${t} r`,
        )
      ).rows[0];
      rows += r.n;
      linked += r.linked;
      if (r.bad) problems.push(`${t}: ${r.bad} row(s) where user_id and the email disagree`);
    }
    console.log(`user_id: ${EMAIL_LINKED_TABLES.length} email-linked tables, ${rows} rows, ${linked} linked to an account, ${rows - linked} for people without one.`);
    const untidy = (await db.query(`SELECT count(*)::int AS n FROM players WHERE email <> lower(trim(email))`)).rows[0].n;
    if (untidy) problems.push(`${untidy} account email(s) aren't trimmed and lower-case, so rows can't link to them`);
    const triggers = new Set((await db.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).rows.map((r) => r.tgname));
    for (const name of [...EMAIL_LINKED_TABLES.map((t) => `${t}_link_account`), "players_link_rows"]) {
      if (!triggers.has(name)) problems.push(`trigger ${name} is missing`);
    }
  } else {
    console.log("user_id: links not added yet (migration 0005 pending).");
  }

  const drift = await clubMemberDrift(db, slug);
  console.log(`Mirror drift: ${drift.length} row(s).`);
  for (const d of drift) problems.push(`account ${d.userId}: ${d.problem}`);
} finally {
  await client.end();
}
if (problems.length) {
  console.error(`\nPROBLEMS (${problems.length}):\n${problems.map((p) => `- ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("\nRESULT: tenants tables are consistent.");
