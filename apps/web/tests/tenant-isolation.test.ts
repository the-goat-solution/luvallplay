// Phase 3 step 10: the tenant-isolation suite at the database (build plan
// §6.1, §6.6 step 5; test plan §3.5). Generated from the table list
// (@luvallplay/db/tenancy): every club-owned table is checked, and a new
// table is covered the moment it is classified.
//
// The app's role (luvallplay_app) is not the owner and can't bypass
// row-level security. A row is visible, and writable, only when its
// tenant_id is the club named in the transaction setting app.tenant_id.
// With no club named, nothing is: it fails closed.
//
// The second club is synthetic and lives only in this test's database.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { CLUB_OWNED_TABLES, PLATFORM_TABLES } from "@luvallplay/db/tenancy";
import { migrate } from "../scripts/db/migrate.mjs";
import { appLoginSql, checkAppLogin } from "../lib/app-login.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `tenant_isolation_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");

describe("tenant isolation at the database", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const counts: Record<string, number> = {};
  let club2 = 0;

  /** Runs `work` as the app's role for one club (or none), in a transaction that is rolled back. */
  async function asApp<T>(tenant: number | null, work: () => Promise<T>): Promise<T> {
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL ROLE luvallplay_app");
      if (tenant !== null) await c.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenant)]);
      return await work();
    } finally {
      await c.query("ROLLBACK");
    }
  }
  const count = async (table: string) => (await c.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n as number;

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.end();
    c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();
    await migrate(c, { log: () => {} });
    await c.query(SEED);
    // A second, synthetic club with rows of its own in a few tables.
    club2 = (
      await c.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, payment_mode, incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    await c.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES ($1, 'home', true), ($1, 'play-days', true)`, [club2]);
    await c.query(`INSERT INTO club_plans (tenant_id, plan_id) VALUES ($1, 'nz-badminton-free')`, [club2]);
    await c.query(`INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES ($1, 'email.sent', '2026-11-01', 7)`, [club2]);
    await c.query(`INSERT INTO admin_audit_log (actor_kind, action, target, tenant_id) VALUES ('system', 'test.row', 'club 2', $1)`, [club2]);
    for (const t of CLUB_OWNED_TABLES) counts[t] = (await c.query(`SELECT count(*)::int AS n FROM "${t}" WHERE tenant_id = 1`)).rows[0].n;
  });
  after(async () => {
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("every club-owned table requires a club, points at a real one, and has the policy, enabled and forced", async () => {
    const { rows } = await c.query(
      `SELECT r.relname AS t, r.relrowsecurity AS enabled, r.relforcerowsecurity AS forced,
              (SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = r.oid AND a.attname = 'tenant_id') AS not_null,
              EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = r.oid AND k.contype = 'f' AND k.confrelid = 'tenants'::regclass AND k.confdeltype = 'r') AS fk_restrict,
              (SELECT json_agg(json_build_object('name', p.policyname, 'cmd', p.cmd, 'qual', p.qual, 'check', p.with_check, 'roles', p.roles::text)) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = r.relname) AS policies
       FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'public' AND r.relkind = 'r' ORDER BY 1`,
    );
    const byName = new Map(rows.map((r) => [r.t as string, r]));
    const POLICY = [{ name: "tenant_isolation", cmd: "ALL", qual: "(tenant_id = app_tenant_id())", check: "(tenant_id = app_tenant_id())", roles: "{public}" }];
    for (const t of CLUB_OWNED_TABLES) {
      const r = byName.get(t);
      assert.ok(r, `${t} exists`);
      assert.deepEqual({ enabled: r.enabled, forced: r.forced, not_null: r.not_null, fk_restrict: r.fk_restrict }, { enabled: true, forced: true, not_null: true, fk_restrict: true }, t);
      assert.deepEqual(r.policies, POLICY, t);
    }
    // Platform tables (accounts, sign-in, the clubs themselves) have no club column and no policy.
    for (const t of PLATFORM_TABLES) {
      const r = byName.get(t);
      if (!r) continue;
      assert.equal(r.enabled, false, `${t} is a platform table`);
      assert.equal(r.policies, null, t);
    }
    // And nothing has row-level security that isn't in the club-owned list.
    assert.deepEqual(rows.filter((r) => r.enabled).map((r) => r.t).sort(), [...CLUB_OWNED_TABLES].sort());
  });

  test("the app's role is not the owner, can't bypass row-level security, and can't change the schema", async () => {
    const role = (await c.query(`SELECT rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'luvallplay_app'`)).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false, rolcanlogin: false, rolcreaterole: false, rolcreatedb: false });
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'luvallplay_app'`)).rows[0].n, 0);
    await asApp(1, async () => {
      await assert.rejects(c.query(`CREATE TABLE sneaky (id int)`), /permission denied/);
    });
    await asApp(1, async () => {
      await assert.rejects(c.query(`ALTER TABLE bookings DISABLE ROW LEVEL SECURITY`), /must be owner/);
    });
    await asApp(1, async () => {
      await assert.rejects(c.query(`DROP POLICY tenant_isolation ON bookings`), /must be owner/);
    });
  });

  test("with no club named, every club-owned table is empty and takes no writes (fails closed)", async () => {
    const withRows = CLUB_OWNED_TABLES.filter((t) => counts[t] > 0);
    assert.ok(withRows.length >= 20, `the fixture has rows in ${withRows.length} club-owned tables`);
    for (const setting of [null, ""] as const) {
      await asApp(null, async () => {
        if (setting !== null) await c.query("SELECT set_config('app.tenant_id', $1, true)", [setting]);
        for (const t of CLUB_OWNED_TABLES) assert.equal(await count(t), 0, `${t} with app.tenant_id ${setting === null ? "unset" : "empty"}`);
        for (const t of withRows) {
          assert.equal((await c.query(`UPDATE "${t}" SET tenant_id = tenant_id`)).rowCount, 0, `update ${t}`);
          assert.equal((await c.query(`DELETE FROM "${t}"`)).rowCount, 0, `delete ${t}`);
        }
      });
    }
    await asApp(null, async () => {
      await assert.rejects(c.query(`INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES (1, 'sms.sent', '2026-11-01', 1)`), /row-level security/);
    });
    // Something that isn't a club id is an error, not a way in.
    await asApp(null, async () => {
      await c.query("SELECT set_config('app.tenant_id', '1 OR 1=1', true)");
      await assert.rejects(c.query(`SELECT count(*) FROM bookings`), /invalid input syntax for type integer/);
    });
  });

  test("a club sees exactly its own rows in every club-owned table", async () => {
    await asApp(1, async () => {
      for (const t of CLUB_OWNED_TABLES) assert.equal(await count(t), counts[t], `${t} as club 1`);
    });
    await asApp(club2, async () => {
      const seen: Record<string, number> = {};
      for (const t of CLUB_OWNED_TABLES) {
        const n = await count(t);
        if (n) seen[t] = n;
      }
      assert.deepEqual(seen, { admin_audit_log: 1, club_plans: 1, tenant_modules: 2, usage_counters: 1 });
      assert.equal((await c.query(`SELECT quantity::int AS q FROM usage_counters`)).rows[0].q, 7);
    });
  });

  test("a club can't read, change, delete or move another club's rows, in any club-owned table that has some", async () => {
    const withRows = CLUB_OWNED_TABLES.filter((t) => counts[t] > 0);
    await asApp(club2, async () => {
      for (const t of withRows) {
        assert.equal((await c.query(`UPDATE "${t}" SET tenant_id = $1 WHERE tenant_id <> $1`, [club2])).rowCount, 0, `club 2 can't take ${t}`);
        assert.equal((await c.query(`DELETE FROM "${t}" WHERE tenant_id = 1`)).rowCount, 0, `club 2 can't delete from ${t}`);
      }
    });
    // Club 1 can't hand its rows to club 2, or write a row as club 2.
    for (const t of withRows) {
      await asApp(1, async () => {
        await assert.rejects(c.query(`UPDATE "${t}" SET tenant_id = $1`, [club2]), /row-level security/, `club 1 can't move ${t}`);
      });
    }
    await asApp(1, async () => {
      await assert.rejects(c.query(`INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES ($1, 'sms.sent', '2026-11-01', 1)`, [club2]), /row-level security/);
    });
    await asApp(1, async () => {
      await assert.rejects(c.query(`INSERT INTO admin_audit_log (actor_kind, action, target, tenant_id) VALUES ('system', 'x', 'y', $1)`, [club2]), /row-level security/);
    });
    // Its own writes work, including the ones that don't name the club (the default is club 1 until step 11).
    await asApp(1, async () => {
      await c.query(`INSERT INTO usage_counters (tenant_id, metric, period, quantity) VALUES (1, 'sms.sent', '2026-11-01', 1)`);
      await c.query(`INSERT INTO admin_audit_log (actor_kind, action, target) VALUES ('system', 'x', 'y')`);
      assert.equal(await count("admin_audit_log"), counts.admin_audit_log + 1);
    });
    // The owner's view is unchanged by all of the above (everything was rolled back).
    for (const t of CLUB_OWNED_TABLES) assert.equal((await c.query(`SELECT count(*)::int AS n FROM "${t}" WHERE tenant_id = 1`)).rows[0].n, counts[t], t);
  });

  test("a row written without naming the club belongs to the request's club; the owner's default is still club 1", async () => {
    await asApp(club2, async () => {
      const made = await c.query(`INSERT INTO club_settings (key, value) VALUES ('isolation.default', '1'::jsonb) RETURNING tenant_id`);
      assert.equal(made.rows[0].tenant_id, club2);
    });
    await c.query("BEGIN");
    try {
      const made = await c.query(`INSERT INTO club_settings (key, value) VALUES ('isolation.default', '1'::jsonb) RETURNING tenant_id`);
      assert.equal(made.rows[0].tenant_id, 1, "as the owner, with no club named");
    } finally {
      await c.query("ROLLBACK");
    }
  });

  test("the widened keys: an upsert that names the club's key updates the club's own row", async () => {
    await asApp(1, async () => {
      await c.query(`INSERT INTO day_signup_settings (day, paused) VALUES ('isolation-day', false)`);
      await c.query(`INSERT INTO day_signup_settings (day, paused) VALUES ('isolation-day', true) ON CONFLICT (tenant_id, day) DO UPDATE SET paused = EXCLUDED.paused`);
      const rows = (await c.query(`SELECT paused FROM day_signup_settings WHERE day = 'isolation-day'`)).rows;
      assert.deepEqual(rows, [{ paused: true }]);
    });
  });

  test("two clubs can each have the same natural key: a play day's date, a setting's name", async () => {
    await asApp(1, async () => {
      await c.query(`INSERT INTO sessions (date, max_spots, booked_spots) VALUES ('2031-01-03', 10, 0)`);
      await c.query(`INSERT INTO club_settings (key, value) VALUES ('isolation.shared', '1'::jsonb)`);
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [String(club2)]);
      await c.query(`INSERT INTO sessions (date, max_spots, booked_spots) VALUES ('2031-01-03', 20, 0)`);
      await c.query(`INSERT INTO club_settings (key, value) VALUES ('isolation.shared', '2'::jsonb)`);
      assert.deepEqual((await c.query(`SELECT max_spots FROM sessions WHERE date = '2031-01-03'`)).rows, [{ max_spots: 20 }], "the second club sees its own day");
      // And a club still can't have the same day twice.
      await c.query("SAVEPOINT again");
      await assert.rejects(c.query(`INSERT INTO sessions (date, max_spots, booked_spots) VALUES ('2031-01-03', 30, 0)`), /sessions_pkey/);
      await c.query("ROLLBACK TO SAVEPOINT again");
      // A booking can only point at its own club's day.
      await c.query(`DELETE FROM sessions WHERE date = '2031-01-03'`);
      await assert.rejects(c.query(`INSERT INTO bookings (session_date, first_name, last_name, email, phone, payment_intent_id) VALUES ('2031-01-03', 'A', 'B', 'a@x.test', '1', 'pi_isolation')`), /bookings_session_date_fkey/);
    });
  });

  test("the app's own login: no rights of its own, the club's rows once stepped down; a login made like the owner is refused", async () => {
    const good = `luvallplay_web_t${process.pid}`;
    const bad = `luvallplay_bad_t${process.pid}`;
    const as = async (role: string) => {
      const u = new URL(urlFor(NAME));
      u.username = role;
      u.password = "test-only";
      const conn = new pg.Client({ connectionString: u.toString() });
      await conn.connect();
      return conn;
    };
    try {
      // Created exactly as the runbook says, with a throwaway password.
      await c.query(appLoginSql(good).replace("<generated>", "test-only"));
      await c.query(`CREATE ROLE ${bad} LOGIN PASSWORD 'test-only' BYPASSRLS; GRANT luvallplay_app TO ${bad}`);

      const web = await as(good);
      try {
        assert.deepEqual(await checkAppLogin(web, "three-wolves"), []);
        await assert.rejects(web.query(`SELECT 1 FROM players LIMIT 1`), /permission denied/, "nothing without stepping down");
        await assert.rejects(web.query(`SET ROLE ${(await c.query("SELECT current_user AS u")).rows[0].u}`), /permission denied/, "and it can't become the owner");
        await assert.rejects(web.query(`CREATE TABLE sneaky (id int)`), /permission denied/);
      } finally {
        await web.end();
      }

      const other = await as(bad);
      try {
        const problems = await checkAppLogin(other, "three-wolves");
        assert.ok(problems.some((p) => p.includes("bypass row-level security")), problems.join("; "));
        assert.ok(problems.some((p) => p.includes("without stepping down")), problems.join("; "));
      } finally {
        await other.end();
      }
    } finally {
      await c.query(`DROP ROLE IF EXISTS ${good}`);
      await c.query(`DROP ROLE IF EXISTS ${bad}`);
    }
  });

  test("juniors: a child's booking or attendance can't be written into another club, and the other club can't see the child", async () => {
    await c.query("BEGIN");
    try {
      const guardian = (await c.query(`SELECT id FROM players WHERE deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0].id as number;
      const child = (await c.query(`INSERT INTO junior_profiles (tenant_id, name, birth_year) VALUES (1, 'Isolation Child', 2015) RETURNING id`)).rows[0].id as number;
      await c.query(`INSERT INTO sessions (tenant_id, date, max_spots, booked_spots) VALUES (1, '2031-02-07', 10, 0), ($1, '2031-02-07', 10, 0)`, [club2]);
      await c.query("SAVEPOINT s");
      // Only a guardian of the child can be the one who booked.
      await assert.rejects(c.query(`INSERT INTO junior_bookings (tenant_id, junior_profile_id, session_date, booked_by_user_id) VALUES (1, $1, '2031-02-07', $2)`, [child, guardian]), /junior_bookings_booked_by_guardian_fkey/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      // A guardianship lives in the child's own club, nowhere else.
      await assert.rejects(c.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id, consent_at) VALUES ($1, $2, $3, now())`, [club2, guardian, child]), /guardianships_junior_in_club_fkey/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      await c.query(`INSERT INTO guardianships (tenant_id, guardian_user_id, junior_profile_id, consent_at) VALUES (1, $1, $2, now())`, [guardian, child]);
      // A child is marked only at a play day that exists, in one of the known ways.
      await c.query("SAVEPOINT s");
      await assert.rejects(c.query(`INSERT INTO junior_attendance (tenant_id, session_date, junior_profile_id, source) VALUES (1, '2031-02-08', $1, 'coach')`, [child]), /junior_attendance_session_date_fkey/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      await assert.rejects(c.query(`INSERT INTO junior_attendance (tenant_id, session_date, junior_profile_id, source) VALUES (1, '2031-02-07', $1, 'guess')`, [child]), /junior_attendance_source_check/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      await c.query("RELEASE SAVEPOINT s");
      // In the child's own club: fine.
      await c.query(`INSERT INTO junior_bookings (tenant_id, junior_profile_id, session_date, booked_by_user_id, status) VALUES (1, $1, '2031-02-07', $2, 'confirmed')`, [child, guardian]);
      // The same child, written under the other club: refused, even by the owner.
      await c.query("SAVEPOINT s");
      await assert.rejects(c.query(`INSERT INTO junior_bookings (tenant_id, junior_profile_id, session_date, booked_by_user_id) VALUES ($1, $2, '2031-02-07', $3)`, [club2, child, guardian]), /junior_bookings_junior_in_club_fkey/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      await assert.rejects(c.query(`INSERT INTO junior_attendance (tenant_id, session_date, junior_profile_id, source) VALUES ($1, '2031-02-07', $2, 'coach')`, [club2, child]), /junior_attendance_junior_in_club_fkey/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      // One live booking per child per day.
      await assert.rejects(c.query(`INSERT INTO junior_bookings (tenant_id, junior_profile_id, session_date, booked_by_user_id) VALUES (1, $1, '2031-02-07', $2)`, [child, guardian]), /junior_bookings_one_live/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      // As the app's role for the other club: no child, no booking.
      await c.query("SET LOCAL ROLE luvallplay_app");
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [String(club2)]);
      assert.equal(await count("junior_profiles"), 0);
      assert.equal(await count("junior_bookings"), 0);
      assert.equal(await count("guardianships"), 0);
    } finally {
      await c.query("ROLLBACK");
    }
  });

  test("the club setting ends with the transaction: the next one starts with no club", async () => {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE luvallplay_app");
    await c.query("SELECT set_config('app.tenant_id', '1', true)");
    assert.ok((await count("tenant_modules")) > 0);
    await c.query("COMMIT");
    await asApp(null, async () => {
      assert.equal(await count("tenant_modules"), 0);
    });
  });

  test("platform tables stay readable to the app's role: accounts are global", async () => {
    await asApp(null, async () => {
      assert.ok((await count("players")) > 0);
      assert.equal(await count("tenants"), 2);
      assert.equal(await count("plans"), 1);
    });
  });

  test("signing up links a person's earlier rows in every club, whichever club the request is for", async () => {
    // A casual booking at Three Wolves by someone with no account yet.
    const date = (await c.query(`SELECT date::text AS d FROM sessions ORDER BY date LIMIT 1`)).rows[0].d;
    await c.query(`INSERT INTO bookings (session_date, first_name, last_name, email, payment_intent_id) VALUES ($1, 'New', 'Person', 'new.person@isolation.test', 'pi_isolation_1')`, [date]);
    // They sign up while using the other club's site.
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE luvallplay_app");
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [String(club2)]);
    const id = (await c.query(`INSERT INTO players (first_name, last_name, email) VALUES ('New', 'Person', 'new.person@isolation.test') RETURNING id`)).rows[0].id;
    await c.query("COMMIT");
    const linked = (await c.query(`SELECT user_id FROM bookings WHERE email = 'new.person@isolation.test'`)).rows[0].user_id;
    assert.equal(linked, id, "the Three Wolves booking is linked to the new account");
  });
});
