// A one-time membership is flipped to 'expired' the day after its period_end
// (auditMembershipStatuses). The admin play-day roster for a date the member
// attended must keep listing them afterwards: the rows still cover those dates.
// Against a real Postgres, through the app's own database layer. Made-up people only.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `roster_expired_${process.pid}`;

// Fridays. The member's window is 06-06 to 06-20 and has since expired.
const DURING_1 = "2031-06-06";
const DURING_2 = "2031-06-20";
const AFTER = "2031-06-27";

describe("the roster and a membership that has since expired", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
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
    await c.query(
      `INSERT INTO memberships (email, first_name, last_name, plan, status, day, period_start, period_end, recurring)
       VALUES ('dee@exp.test', 'Dee', 'Lapsed', 'monthly', 'expired', 'friday', '2031-06-06', '2031-06-20', FALSE),
              ('eli@exp.test', 'Eli', 'Current', 'monthly', 'active', 'friday', '2031-06-01', '2031-07-31', FALSE),
              ('fay@exp.test', 'Fay', 'Never paid', 'monthly', 'pending', 'friday', '2031-06-01', '2031-07-31', FALSE),
              ('gus@exp.test', 'Gus', 'Canceled', 'monthly', 'canceled', 'friday', '2031-06-01', '2031-07-31', FALSE)`,
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

  test("a lapsed member is still on the roster of every date their membership covered", async () => {
    assert.deepEqual(await members(DURING_1), ["Dee", "Eli"]);
    assert.deepEqual(await members(DURING_2), ["Dee", "Eli"]);
  });

  test("and drops off once the membership has ended", async () => {
    assert.deepEqual(await members(AFTER), ["Eli"]);
  });

  test("a membership that never became active is not listed", async () => {
    assert.ok(!(await members(DURING_1)).includes("Fay"));
  });
});
