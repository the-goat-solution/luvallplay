// A member who taps "Can't make it" (player_absences) leaves that play day's
// roster, headcount and reminder list — and nobody else does. A bare `email`
// inside memberNotAbsentSql's subquery once resolved to the absence row's own
// email, so a single absence on a date hid every member from it. Against a
// real Postgres, through the app's own database layer. Made-up people only.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `member_absence_${process.pid}`;

// Fridays (a membership day), weeks apart, each with its own absences.
const FRIDAY = "2031-06-06";
const NOBODY_AWAY = "2031-06-13";
const ALL_AWAY = "2031-06-20";

describe("a member's absence from a play day", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let lib: typeof import("../lib/db.ts");
  let database: typeof import("../lib/database.ts");
  const KEYS = ["DATABASE_DRIVER", "POSTGRES_URL", "VERCEL_ENV"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };

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
    // Three Friday members covering every date above. Ana's email is stored
    // with capitals and spaces, as a sign-up form might leave it.
    await c.query(
      `INSERT INTO memberships (email, first_name, last_name, plan, status, day, period_start, period_end, recurring)
       VALUES (' Ana@Abs.test ', 'Ana', 'Member', 'monthly', 'active', 'friday', '2031-06-01', '2031-07-31', FALSE),
              ('ben@abs.test', 'Ben', 'Member', 'monthly', 'active', 'friday', '2031-06-01', '2031-07-31', FALSE),
              ('cy@abs.test', 'Cy', 'Member', 'quarterly', 'active', 'friday', '2031-06-01', '2031-07-31', FALSE)`,
    );
    // Ana can't make FRIDAY; everyone is away on ALL_AWAY. Absences are
    // stored lower-cased and trimmed (lib/stats-db.ts setPlayerAbsence).
    await c.query(
      `INSERT INTO player_absences (session_date, email)
       VALUES ($1, 'ana@abs.test'), ($2, 'ana@abs.test'), ($2, 'ben@abs.test'), ($2, 'cy@abs.test')`,
      [FRIDAY, ALL_AWAY],
    );
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    delete process.env.VERCEL_ENV;
    database = await import("../lib/database.ts");
    lib = await import("../lib/db.ts");
  });
  after(async () => {
    await database?.closeDatabase();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  const members = async (date: string) =>
    (await lib.getRosterForDate(date)).filter((p) => p.membershipId !== null).map((p) => p.firstName).sort();

  test("the roster drops only the member who is away", async () => {
    assert.deepEqual(await members(FRIDAY), ["Ben", "Cy"]);
    assert.deepEqual(await members(NOBODY_AWAY), ["Ana", "Ben", "Cy"]);
    assert.deepEqual(await members(ALL_AWAY), []);
  });

  test("the member headcount agrees with the roster", async () => {
    assert.equal(await lib.getActiveMemberCountForDate(FRIDAY), 2);
    assert.equal(await lib.getActiveMemberCountForDate(NOBODY_AWAY), 3);
    assert.equal(await lib.getActiveMemberCountForDate(ALL_AWAY), 0);
    const batch = await lib.getSpotsAndHeadcountForDates([FRIDAY, NOBODY_AWAY, ALL_AWAY]);
    assert.equal(batch.signedUp[FRIDAY], 2);
    assert.equal(batch.signedUp[NOBODY_AWAY], 3);
    assert.equal(batch.signedUp[ALL_AWAY], 0);
  });

  test("the day-before reminder goes to everyone but the member who is away", async () => {
    const names = async (date: string) => (await lib.getMembersWithPlayDayTomorrow(date)).map((m) => m.email.trim().toLowerCase()).sort();
    assert.deepEqual(await names(FRIDAY), ["ben@abs.test", "cy@abs.test"]);
    assert.deepEqual(await names(NOBODY_AWAY), ["ana@abs.test", "ben@abs.test", "cy@abs.test"]);
  });

  test("casual bookings can't take the places of members who are coming", async () => {
    await lib.ensureSession(FRIDAY);
    await c.query(`UPDATE sessions SET courts = 1 WHERE date = $1`, [FRIDAY]);
    // Places on one court, read from a query that doesn't go through the
    // absence filter's unaliased form: free places plus everyone signed up.
    const before = await lib.getSpotsAndHeadcountForDates([FRIDAY]);
    const capacity = before.spots[FRIDAY] + before.signedUp[FRIDAY];
    assert.equal(before.signedUp[FRIDAY], 2, "two members coming, no casual bookings yet");
    let claimed = 0;
    for (let i = 0; i < capacity + 2; i++) {
      if (await lib.claimSessionSpot(database.sql, FRIDAY)) claimed++;
    }
    assert.equal(claimed, capacity - 2, "every place but the two members' goes to casual bookings");
    assert.equal(await lib.getAvailableSpots(FRIDAY, { ignoreLock: true }), 0);
  });
});
