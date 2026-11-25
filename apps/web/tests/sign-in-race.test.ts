// Sign-in codes under concurrency (audit C5).
//
// The check used to read the tries used, compare the code, then count the
// try: requests sent at the same moment all read "under the limit" and all
// got a guess. These tests send guesses at the same moment against a real
// Postgres and require that a code is compared at most CODE_MAX_ATTEMPTS
// times, that it signs in once, and that the per-email limit (in the
// database, so the same on every server instance) holds across codes.
//
// Needs Postgres (DATA_GUARD_TEST_URL's server). CI sets
// DATA_GUARD_REQUIRE_DB=1, so it can't be skipped silently.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `signin_race_${process.pid}`;

describe("sign-in codes at the same moment", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let auth: typeof import("../lib/player-auth.ts");
  let database: typeof import("../lib/database.ts");
  const saved = { driver: process.env.DATABASE_DRIVER, url: process.env.POSTGRES_URL, secret: process.env.PLAYER_SESSION_SECRET };
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  let n = 0;
  const freshEmail = () => `racer${++n}@signin.test`;
  /** A code for the email, as the sign-in page asks for one. */
  const issue = async (email: string) => {
    const r = await auth.issueEmailCode(email, "203.0.113.7");
    assert.ok(r.ok, "a code is issued");
    return r.issued.code;
  };
  /** Six digits that aren't the code. */
  const wrong = (code: string, i: number) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, "0");
  const attempts = async (email: string) => (await c.query(`SELECT COALESCE(SUM(attempts), 0)::int AS n FROM auth_codes WHERE email = $1`, [email])).rows[0].n as number;
  /** Earlier codes stop counting towards "3 codes in 15 minutes" (they still count towards the hour). */
  const age = (email: string, interval: string) => c.query(`UPDATE auth_codes SET created_at = created_at - $2::interval WHERE email = $1`, [email, interval]);

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
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    process.env.PLAYER_SESSION_SECRET = "sign-in-race-test-secret";
    database = await import("../lib/database.ts");
    auth = await import("../lib/player-auth.ts");
  });
  after(async () => {
    await database?.closeDatabase();
    for (const [k, v] of [["DATABASE_DRIVER", saved.driver], ["POSTGRES_URL", saved.url], ["PLAYER_SESSION_SECRET", saved.secret]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("40 wrong guesses at once: the code is tried 5 times, not 40, and is then dead", async () => {
    const email = freshEmail();
    const code = await issue(email);
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => auth.verifyEmailCode(email, wrong(code, i))));
    assert.ok(results.every((r) => !r.ok));
    const reasons = results.map((r) => (r.ok ? "ok" : r.reason));
    // Four are told "wrong code", the fifth and everyone after "too many tries".
    assert.equal(reasons.filter((r) => r === "invalid").length, auth.CODE_MAX_ATTEMPTS - 1);
    assert.equal(reasons.filter((r) => r === "too_many_attempts").length, 40 - (auth.CODE_MAX_ATTEMPTS - 1));
    assert.equal(await attempts(email), auth.CODE_MAX_ATTEMPTS, "tries counted in the database");
    // The right code no longer works either: the code is spent.
    assert.deepEqual(await auth.verifyEmailCode(email, code), { ok: false, reason: "too_many_attempts" });
    assert.equal(await attempts(email), auth.CODE_MAX_ATTEMPTS, "a refused try isn't counted");
  });

  test("200 different guesses at once, the right one among them: still at most 5 are looked at, and it signs in at most once", async () => {
    // Before the fix every one of the 200 was compared, so the right one always signed in.
    const email = freshEmail();
    const code = await issue(email);
    const guesses = Array.from({ length: 199 }, (_, i) => wrong(code, i));
    guesses.splice(150, 0, code); // the right one, somewhere in the crowd
    const results = await Promise.all(guesses.map((g) => auth.verifyEmailCode(email, g)));
    assert.ok(results.filter((r) => r.ok).length <= 1);
    assert.equal(await attempts(email), auth.CODE_MAX_ATTEMPTS, "5 tries on the code, however many were sent");
    assert.equal(results.filter((r) => !r.ok && r.reason === "too_many_attempts").length >= 195, true, "the rest were refused without a look");
  });

  test("the right code sent 10 times at once signs in exactly once", async () => {
    const email = freshEmail();
    const code = await issue(email);
    const results = await Promise.all(Array.from({ length: 10 }, () => auth.verifyEmailCode(email, code)));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && (r.reason === "expired" || r.reason === "too_many_attempts")));
  });

  test("one at a time it behaves as before: 4 wrong tries then the right code signs in; the fifth wrong try ends the code", async () => {
    const email = freshEmail();
    const code = await issue(email);
    for (let i = 0; i < 4; i++) assert.deepEqual(await auth.verifyEmailCode(email, wrong(code, i)), { ok: false, reason: "invalid" });
    assert.deepEqual(await auth.verifyEmailCode(email, ` ${code.slice(0, 3)} ${code.slice(3)} `), { ok: true, email });
    assert.deepEqual(await auth.verifyEmailCode(email, code), { ok: false, reason: "expired" }, "single use");

    const other = freshEmail();
    const second = await issue(other);
    for (let i = 0; i < 4; i++) await auth.verifyEmailCode(other, wrong(second, i));
    assert.deepEqual(await auth.verifyEmailCode(other, "12"), { ok: false, reason: "too_many_attempts" }, "a code that isn't six digits is a try too");
    assert.deepEqual(await auth.verifyEmailCode(other, second), { ok: false, reason: "too_many_attempts" });
    // No code at all, and a code past its time.
    assert.deepEqual(await auth.verifyEmailCode(freshEmail(), "123456"), { ok: false, reason: "expired" });
    const late = freshEmail();
    const lateCode = await issue(late);
    await c.query(`UPDATE auth_codes SET expires_at = NOW() - INTERVAL '1 second' WHERE email = $1`, [late]);
    assert.deepEqual(await auth.verifyEmailCode(late, lateCode), { ok: false, reason: "expired" });
    assert.equal(await attempts(late), 0, "an expired code takes no tries");
  });

  test("the per-email limit is in the database: 20 typed codes in an hour across fresh codes, then even the right code waits; other people aren't affected", async () => {
    const email = freshEmail();
    for (let k = 0; k < 20 / auth.CODE_MAX_ATTEMPTS; k++) {
      const code = await issue(email);
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => auth.verifyEmailCode(email, wrong(code, i))));
      assert.ok(results.every((r) => !r.ok));
      // Past "3 codes in 15 minutes", still inside the hour.
      await c.query(`UPDATE auth_codes SET created_at = NOW() - INTERVAL '16 minutes' WHERE email = $1 AND created_at > NOW() - INTERVAL '15 minutes'`, [email]);
    }
    assert.equal(await attempts(email), 20);
    const fresh = await issue(email);
    assert.deepEqual(await auth.verifyEmailCode(email, fresh), { ok: false, reason: "too_many_attempts" });
    assert.equal(await attempts(email), 20, "nothing was compared");
    // Someone else signs in as usual.
    const other = freshEmail();
    assert.deepEqual(await auth.verifyEmailCode(other, await issue(other)), { ok: true, email: other });
    // An hour later a new code works.
    await age(email, "61 minutes");
    assert.deepEqual(await auth.verifyEmailCode(email, await issue(email)), { ok: true, email });
  });

  test("and 50 in a day", async () => {
    const email = freshEmail();
    await c.query(
      `INSERT INTO auth_codes (email, code_hash, link_token_hash, attempts, expires_at, consumed_at, created_at)
       SELECT $1, 'x', 'day-' || g, 5, NOW() - INTERVAL '2 hours', NULL, NOW() - INTERVAL '3 hours' FROM generate_series(1, $2::int) g`,
      [email, 50 / 5],
    );
    assert.deepEqual(await auth.verifyEmailCode(email, await issue(email)), { ok: false, reason: "too_many_attempts" });
    await age(email, "22 hours");
    assert.deepEqual(await auth.verifyEmailCode(email, await issue(email)), { ok: true, email });
  });
});

if (!BASE_URL && REQUIRE_DB) {
  test("the sign-in race tests are required in CI", () => assert.fail("DATA_GUARD_REQUIRE_DB=1 but DATA_GUARD_TEST_URL is not set"));
}
