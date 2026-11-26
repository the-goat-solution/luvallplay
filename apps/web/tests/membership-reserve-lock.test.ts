// The lock around reserving a membership start (lib/db.ts
// assignAndReserveMembershipAccessStart). It used to be a session-level
// advisory lock, which a transaction pooler can leak: the unlock may land on
// another server connection, and later sign-ups for the same email and day
// hang (audit, Medium). It is now a transaction-level lock inside one
// transaction, with a savepoint per candidate day.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `membership_lock_${process.pid}`;

describe("reserving a membership start", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const env = { ...process.env };
  let admin: pg.Client;
  let database: typeof import("../lib/database.ts");
  let lib: typeof import("../lib/db.ts");
  let wednesdays: string[] = [];
  const member = (email: string) => ({ email, firstName: "Lock", lastName: "Test", phone: null, recurring: false });
  const advisoryLocks = async () => (await admin.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`)).rows[0].n;
  const openTransactions = async () =>
    (await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`)).rows[0].n;
  const membershipsOf = async (email: string) => (await admin.query(`SELECT period_start::text AS start, status FROM memberships WHERE email = $1 ORDER BY id`, [email])).rows;

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const root = new pg.Client({ connectionString: urlFor("postgres") });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await root.query(`CREATE DATABASE ${NAME}`);
    await root.end();
    admin = new pg.Client({ connectionString: urlFor(NAME) });
    await admin.connect();
    await migrate(admin, { log: () => {} });
    // Three Wednesdays ahead, as synced play days (well inside the start search).
    wednesdays = (
      await admin.query(
        `INSERT INTO sessions (date, booked_spots, courts, google_event_id)
         SELECT d::date, 0, 4, 'evt-' || d::date FROM generate_series(current_date + 2, current_date + 22, INTERVAL '1 day') AS d
         WHERE EXTRACT(DOW FROM d) = 3 RETURNING date::text AS date`,
      )
    ).rows.map((r) => r.date).sort();
    assert.ok(wednesdays.length >= 2);
    process.env.POSTGRES_URL = urlFor(NAME);
    process.env.DATABASE_DRIVER = "postgres";
    delete process.env.TENANT_SCOPE;
    delete process.env.TENANT_SLUG;
    delete process.env.APP_DATABASE_URL;
    database = await import("../lib/database.ts");
    lib = await import("../lib/db.ts");
  });
  after(async () => {
    await database?.closeDatabase();
    process.env = env;
    await admin?.end();
    const root = new pg.Client({ connectionString: urlFor("postgres") });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await root.end();
  });

  for (const mode of ["off", "enforce"] as const) {
    describe(`TENANT_SCOPE=${mode}`, () => {
      before(async () => {
        await database.closeDatabase();
        process.env.TENANT_SCOPE = mode;
        await admin.query(`DELETE FROM memberships`);
        await admin.query(`UPDATE sessions SET booked_spots = 0`);
      });

      test("reserves the nearest day, and leaves no lock and no open transaction behind", async () => {
        const r = await lib.assignAndReserveMembershipAccessStart("monthly", "wednesday", member(`first.${mode}@lock.test`));
        assert.equal(r.blocked, false);
        assert.equal(!r.blocked && r.periodStart, wednesdays[0]);
        assert.deepEqual(await membershipsOf(`first.${mode}@lock.test`), [{ start: wednesdays[0], status: "pending" }]);
        assert.equal(await advisoryLocks(), 0);
        assert.equal(await openTransactions(), 0);
      });

      test("a second sign-up for the same email and day is refused, and nothing stays locked", async () => {
        const r = await lib.assignAndReserveMembershipAccessStart("monthly", "wednesday", member(`first.${mode}@lock.test`));
        assert.deepEqual(r, { blocked: true, reason: "already_member" });
        assert.equal(await advisoryLocks(), 0);
        assert.equal(await openTransactions(), 0);
      });

      test("eight sign-ups at once for one email and day: exactly one membership", async () => {
        const email = `race.${mode}@lock.test`;
        const results = await Promise.all(Array.from({ length: 8 }, () => lib.assignAndReserveMembershipAccessStart("monthly", "wednesday", member(email))));
        assert.equal(results.filter((r) => !r.blocked).length, 1);
        assert.equal(results.filter((r) => r.blocked && r.reason === "already_member").length, 7);
        assert.equal((await membershipsOf(email)).length, 1);
        assert.equal(await advisoryLocks(), 0);
        assert.equal(await openTransactions(), 0);
      });

      test("a full day is skipped for the next one, and the full day's row isn't left locked", async () => {
        await admin.query(`UPDATE sessions SET booked_spots = 999 WHERE date = $1`, [wednesdays[0]]);
        const r = await lib.assignAndReserveMembershipAccessStart("monthly", "wednesday", member(`next.${mode}@lock.test`));
        assert.equal(!r.blocked && r.periodStart, wednesdays[1]);
        // Another connection can lock the full day's row at once.
        await admin.query("BEGIN");
        await admin.query(`SET LOCAL lock_timeout = '500ms'`);
        await admin.query(`SELECT 1 FROM sessions WHERE date = $1 FOR UPDATE`, [wednesdays[0]]);
        await admin.query("ROLLBACK");
      });

      test("every day full: refused, nothing written, nothing locked", async () => {
        await admin.query(`UPDATE sessions SET booked_spots = 999`);
        const r = await lib.assignAndReserveMembershipAccessStart("monthly", "wednesday", member(`full.${mode}@lock.test`));
        assert.deepEqual(r, { blocked: true, reason: "sessions_full" });
        assert.deepEqual(await membershipsOf(`full.${mode}@lock.test`), []);
        assert.equal(await advisoryLocks(), 0);
        assert.equal(await openTransactions(), 0);
        await admin.query(`UPDATE sessions SET booked_spots = 0`);
      });

      test("a date that isn't a play day is refused without leaving the transaction open", async () => {
        const r = await lib.assignAndReserveMembershipAccessStart("monthly", "wednesday", member(`bad.${mode}@lock.test`), "2020-01-01");
        assert.deepEqual(r, { blocked: true, reason: "invalid_date" });
        assert.equal(await advisoryLocks(), 0);
        assert.equal(await openTransactions(), 0);
      });

      test("a failure part-way through rolls everything back and releases the lock", async () => {
        // The insert fails (a plan the table refuses) after the lock and the row lock are taken.
        const email = `broken.${mode}@lock.test`;
        await assert.rejects(lib.assignAndReserveMembershipAccessStart("no-such-plan" as never, "wednesday", member(email)));
        assert.deepEqual(await membershipsOf(email), []);
        assert.equal(await advisoryLocks(), 0);
        assert.equal(await openTransactions(), 0);
        // And the same person can sign up straight afterwards: nothing is stuck.
        const r = await Promise.race([
          lib.assignAndReserveMembershipAccessStart("monthly", "wednesday", member(email)),
          new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 3000)),
        ]);
        assert.notEqual(r, "hung");
        assert.equal(r !== "hung" && r.blocked, false);
      });
    });
  }
});
