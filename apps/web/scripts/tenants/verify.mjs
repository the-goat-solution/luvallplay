// Phase 3 step 1: checks the tenants tables after migration 0003 (read-only
// unless --reconcile is given).
//
//   node scripts/tenants/verify.mjs               report; exit 1 on any problem
//   node scripts/tenants/verify.mjs --reconcile   first bring club_members in
//                                                 line with club_roles and the
//                                                 leaderboard flag (idempotent)
//   node scripts/tenants/verify.mjs --other-clubs-ok
//                                                 on a copy with more than one
//                                                 club (the T1 suite's copy)
//
// Checks: exactly one club, TENANT_SLUG's, unless --other-clubs-ok (no other
// club may exist in production while the readiness gates are open, build
// plan §11.3, nor before enforce is live and quiet, §9.2). Then, for EVERY
// club (audit C6): one module row per module in the registry; every
// club_roles role mirrored into club_members; at least one live owner; and
// row-level security shows the app's role exactly that club's rows. Accounts
// are global, so an account in no club is counted, not a problem. Once
// migration 0004 has run, every row of every club-owned table belongs to an
// existing club (no NULL tenant_id); and, once migration 0005 has run,
// user_id agrees with the email join on every row of the ten email-linked
// tables, and the triggers that keep it so exist.
// Prints counts only, never an email.
//
// POSTGRES_URL chooses the database. DB_DRIVER=neon-ws works as in the other
// operator scripts.
import { dbClient } from "../db-client.mjs";
import { MODULES } from "@luvallplay/modules";
import { CLUB_OWNED_TABLES, EMAIL_LINKED_TABLES } from "@luvallplay/db/tenancy";
import { clubMemberDrift, defaultTenantSlug, reconcileClubMembers } from "../../lib/tenant-members.ts";
import { probeTenantIsolation } from "../../lib/tenant-scope.ts";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}
const reconcile = process.argv.includes("--reconcile");
const otherClubsOk = process.argv.includes("--other-clubs-ok");
const slug = defaultTenantSlug();
const client = await dbClient(url, "tenants-verify");
await client.connect();
const db = { query: (text, params) => client.query(text, params) };
const problems = [];

/** The checks that belong to one club. */
async function checkClub(club, hasRls) {
  const tag = (p) => `${club.slug}: ${p}`;
  if (reconcile) console.log(`Reconciled: ${await reconcileClubMembers(db, club.slug)} row(s) written.`);

  const modules = (await db.query(`SELECT module_id, enabled FROM tenant_modules WHERE tenant_id = $1`, [club.id])).rows;
  const ids = new Set(modules.map((m) => m.module_id));
  // A module the platform keeps hidden can't be switched on, so it needs no row (no row reads as off).
  const missing = MODULES.filter((m) => m.availability !== "hidden").map((m) => m.id).filter((id) => !ids.has(id));
  const unknown = [...ids].filter((id) => !MODULES.some((m) => m.id === id));
  console.log(`Modules: ${modules.length} rows, ${modules.filter((m) => m.enabled).length} on (registry has ${MODULES.length}).`);
  if (missing.length) problems.push(tag(`modules without a row: ${missing.join(", ")}`));
  if (unknown.length) problems.push(tag(`module rows not in the registry: ${unknown.join(", ")}`));
  // A hidden module can't be switched on, so a row saying it is on should be impossible.
  const hiddenOn = modules.filter((m) => m.enabled && MODULES.find((x) => x.id === m.module_id)?.availability === "hidden").map((m) => m.module_id);
  if (hiddenOn.length) problems.push(tag(`hidden modules switched on: ${hiddenOn.join(", ")}`));

  const counts = (
    await db.query(
      `SELECT (SELECT count(*)::int FROM club_members WHERE tenant_id = $1) AS members,
              (SELECT count(*)::int FROM club_roles WHERE tenant_id = $1) AS roles,
              (SELECT count(*)::int FROM club_members m JOIN players p ON p.id = m.user_id
                 WHERE m.tenant_id = $1 AND m.role = 'owner' AND m.status = 'active' AND p.deleted_at IS NULL) AS live_owners`,
      [club.id],
    )
  ).rows[0];
  const byRole = (await db.query(`SELECT role, count(*)::int AS n FROM club_members WHERE tenant_id = $1 GROUP BY 1 ORDER BY 1`, [club.id])).rows;
  console.log(`Club members: ${counts.members} (${byRole.map((r) => `${r.role} ${r.n}`).join(", ")}). club_roles rows: ${counts.roles}. Live owners: ${counts.live_owners}.`);
  if (counts.live_owners < 1) problems.push(tag("no live owner in club_members"));

  const drift = await clubMemberDrift(db, club.slug);
  console.log(`Mirror drift: ${drift.length} row(s).`);
  for (const d of drift) problems.push(tag(`account ${d.userId}: ${d.problem}`));

  // Step 10: row-level security, once migration 0007 has run. The app's role
  // must see exactly the club's rows in every club-owned table, and none
  // with no club named. Read-only (a READ ONLY transaction, rolled back).
  if (hasRls) {
    const one = { query: (t, p) => client.query(t, p), connect: async () => ({ query: (t, p) => client.query(t, p), release() {} }) };
    const differences = await probeTenantIsolation(one, club.id, CLUB_OWNED_TABLES);
    for (const d of differences) problems.push(tag(`row-level security: ${d}`));
    console.log(`Row-level security: ${CLUB_OWNED_TABLES.length} club-owned tables, ${differences.length} problem(s).`);
  }
}

try {
  const hasRls = (await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'app_tenant_id'`)).rows.length > 0;
  const clubs = (await db.query(`SELECT id, slug, status, country, region, timezone, currency, payment_mode FROM tenants ORDER BY id`)).rows;
  console.log(`Clubs: ${clubs.map((t) => `${t.slug} (id ${t.id}, ${t.status}, ${t.country}/${t.region}, ${t.timezone}, ${t.currency}, ${t.payment_mode})`).join("; ") || "none"}`);
  if (otherClubsOk) {
    if (!clubs.some((t) => t.slug === slug)) problems.push(`no club "${slug}"`);
  } else if (clubs.length !== 1 || clubs[0].slug !== slug) {
    problems.push(`expected exactly one club, "${slug}"`);
  }
  for (const club of clubs) {
    console.log(`\n── ${club.slug} (id ${club.id}) ──`);
    await checkClub(club, hasRls);
  }
  console.log("");

  const counts = (
    await db.query(
      `SELECT (SELECT count(*)::int FROM players) AS accounts,
              (SELECT count(*)::int FROM players p WHERE NOT EXISTS (SELECT 1 FROM club_members m WHERE m.user_id = p.id)) AS in_no_club,
              (SELECT count(*)::int FROM platform_admins) AS platform_admins`,
    )
  ).rows[0];
  console.log(`Accounts: ${counts.accounts} (${counts.in_no_club} in no club). Platform admins: ${counts.platform_admins}.`);

  // Step 2: tenant_id on every club-owned table (skipped before migration 0004).
  const withColumn = new Set(
    (await db.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'`)).rows.map((r) => r.table_name),
  );
  if (withColumn.has("bookings") && clubs.length) {
    const clubIds = clubs.map((t) => t.id);
    let rows = 0;
    for (const t of CLUB_OWNED_TABLES) {
      if (!withColumn.has(t)) {
        problems.push(`${t} has no tenant_id column`);
        continue;
      }
      const r = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE tenant_id IS NULL OR NOT (tenant_id = ANY($1)))::int AS bad FROM ${t}`, [clubIds])).rows[0];
      rows += r.n;
      if (r.bad) problems.push(`${t}: ${r.bad} row(s) without a club's tenant_id`);
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

  if (hasRls) {
    const unprotected = (
      await client.query(
        `SELECT r.relname FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace
         WHERE n.nspname = 'public' AND r.relkind = 'r' AND r.relname = ANY($1) AND NOT (r.relrowsecurity AND r.relforcerowsecurity)`,
        [[...CLUB_OWNED_TABLES]],
      )
    ).rows.map((r) => r.relname);
    if (unprotected.length) problems.push(`club-owned tables without forced row-level security: ${unprotected.join(", ")}`);
    console.log(`Forced row-level security: ${CLUB_OWNED_TABLES.length} club-owned tables, ${unprotected.length} without.`);
  }
} finally {
  await client.end();
}
if (problems.length) {
  console.error(`\nPROBLEMS (${problems.length}):\n${problems.map((p) => `- ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("\nRESULT: tenants tables are consistent.");
