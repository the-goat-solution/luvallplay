// Phase 3 step 3: email links → user_id (migration 0005_user_id_links;
// build plan §6.1; test plan §4.5 "Email → user id links").
//
// 1. The migration passes the data guard: nobody loses a row, nothing is
//    newly unlinked, and every existing value is as it was.
// 2. The backfill links exactly the rows the email joins find today: the
//    live account with that email (whatever the row's capitals or spaces),
//    and nobody for guests and deleted accounts.
// 3. The triggers keep it that way for every writer, including the previous
//    app version, which doesn't know the column: new rows, new accounts,
//    email changes, merges and account deletion.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { EMAIL_LINKED_TABLES, CLUB_OWNED_TABLES } from "@luvallplay/db/tenancy";
import { loadMigrations, migrate } from "../scripts/db/migrate.mjs";
import { ExpectationsSchema, diffSnapshots } from "../scripts/data-guard/core.ts";
import { takeSnapshot } from "../scripts/data-guard/pg.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `user_links_${process.pid}`;
const EXPECT = new URL("../scripts/data-guard/expectations/2026-11-phase3-user-id-links.json", import.meta.url);
const TAG = "0005_user_id_links";
const quiet = () => {};

function urlFor(db: string) {
  const u = new URL(BASE_URL!);
  u.pathname = `/${db}`;
  return u.toString();
}

/** Rows where user_id and the email join disagree. Empty when in step. */
export const DISAGREEMENT = (table: string) => `
  SELECT count(*)::int AS n FROM ${table} r
  WHERE r.user_id IS DISTINCT FROM (SELECT p.id FROM players p WHERE p.deleted_at IS NULL AND p.email = lower(trim(r.email)))`;

test("every email-linked table is club-owned", () => {
  assert.deepEqual(EMAIL_LINKED_TABLES.filter((t) => !(CLUB_OWNED_TABLES as readonly string[]).includes(t)), []);
});

describe("email links → user_id", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const uid = async (table: string, where: string) => (await c.query(`SELECT user_id FROM ${table} WHERE ${where}`)).rows.map((r) => r.user_id);
  const disagreements = async () => {
    const out: Record<string, number> = {};
    for (const t of EMAIL_LINKED_TABLES) {
      const n = (await c.query(DISAGREEMENT(t))).rows[0].n;
      if (n) out[t] = n;
    }
    return out;
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

    const all = loadMigrations();
    const idx = all.findIndex((m) => m.tag === TAG);
    assert.ok(idx > 0, `${TAG} is in the journal`);
    await migrate(c, { migrations: all.slice(0, idx), log: quiet });
    // 1 a member with history; 2 an owner; 3 a deleted account whose rows
    // still carry the email it had. Guests have rows and no account.
    await c.query(`INSERT INTO players (id, email, first_name, deleted_at) VALUES
      (1, 'mia@x.test', 'Mia', NULL), (2, 'owner@x.test', 'Owner', NULL), (3, 'deleted-3@deleted.invalid', '', now())`);
    await c.query(`SELECT setval('players_id_seq', 3)`);
    await c.query(`INSERT INTO club_roles (player_id, role) VALUES (2, 'owner')`);
    await c.query(`INSERT INTO player_sessions (player_id, token_hash, expires_at) VALUES (1, 'h1', now() + interval '30 days')`);
    await c.query(`INSERT INTO sessions (date, courts, max_spots) VALUES ('2026-11-20', 2, 12), ('2026-11-27', 2, 12)`);
    await c.query(`INSERT INTO memberships (email, plan, status) VALUES ('mia@x.test', 'monthly', 'active'), ('gone@x.test', 'monthly', 'canceled'), ('guest@x.test', 'monthly', 'pending')`);
    await c.query(`INSERT INTO attendance (session_date, email, source) VALUES ('2026-11-20', ' Mia@X.test ', 'admin'), ('2026-11-27', 'mia@x.test', 'admin'), ('2026-11-20', 'guest@x.test', 'admin')`);
    await c.query(`INSERT INTO bookings (session_date, first_name, last_name, email) VALUES ('2026-11-27', 'Guest', 'One', 'guest@x.test'), ('2026-11-27', 'Mia', 'M', 'MIA@x.test')`);
    await c.query(`INSERT INTO player_absences (session_date, email) VALUES ('2026-11-27', 'mia@x.test')`);
    await c.query(`INSERT INTO waitlist (session_date, name, email) VALUES ('2026-11-27', 'Guest', 'guest@x.test')`);
    await c.query(`INSERT INTO day_requests (day, name, email) VALUES ('monday', 'Owner', 'owner@x.test')`);
  });

  after(async () => {
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("the migration passes the data guard: nobody loses a row, nothing is newly unlinked", async () => {
    const snapBefore = await takeSnapshot(urlFor(NAME));
    const all = loadMigrations();
    await migrate(c, { migrations: all.slice(0, all.findIndex((m) => m.tag === TAG) + 1), log: quiet });
    const snapAfter = await takeSnapshot(urlFor(NAME));
    const findings = diffSnapshots(snapBefore, snapAfter, ExpectationsSchema.parse(JSON.parse(readFileSync(EXPECT, "utf8"))));
    assert.deepEqual(findings.filter((f) => f.level !== "info"), [], "no errors and no warnings");
    // Each person still has their rows by email, and now by id too.
    const mia = snapAfter.people.find((p) => p.id === "1")!;
    const miaBefore = snapBefore.people.find((p) => p.id === "1")!;
    assert.equal(mia.links["attendance.email"], miaBefore.links["attendance.email"]);
    assert.equal(mia.links["attendance.user_id"], 2);
    const byId = Object.entries(mia.links).filter(([k]) => k.startsWith("memberships.user_id"));
    assert.equal(byId.reduce((n, [, v]) => n + v, 0), 1, `memberships by user_id: ${JSON.stringify(byId)}`);
  });

  test("the backfill links what the email joins find: live accounts, whatever the capitals; nobody for guests", async () => {
    // COLLATE "C": the same order on every server, whatever its locale.
    assert.deepEqual(await uid("attendance", `true ORDER BY session_date, email COLLATE "C"`), [1, null, 1]);
    assert.deepEqual(await uid("bookings", "true ORDER BY id"), [null, 1]);
    assert.deepEqual(await uid("memberships", "true ORDER BY id"), [1, null, null]);
    assert.deepEqual(await uid("player_absences", "true"), [1]);
    assert.deepEqual(await uid("waitlist", "true"), [null]);
    assert.deepEqual(await uid("day_requests", "true"), [2]);
    assert.deepEqual(await disagreements(), {});
    // Emails are exactly as they were: the contact field isn't tidied.
    assert.deepEqual((await c.query(`SELECT email FROM attendance ORDER BY session_date, email COLLATE "C"`)).rows.map((r) => r.email), [" Mia@X.test ", "guest@x.test", "mia@x.test"]);
  });

  test("every new link has a foreign key (RESTRICT) and an index", async () => {
    const fks = (await c.query(`SELECT conrelid::regclass::text AS t, confdeltype FROM pg_constraint WHERE contype = 'f' AND conname LIKE '%\\_user\\_id\\_fkey' AND confrelid = 'players'::regclass AND conrelid::regclass::text = ANY($1)`, [[...EMAIL_LINKED_TABLES]])).rows;
    assert.deepEqual(fks.map((r) => r.t).sort(), [...EMAIL_LINKED_TABLES].sort());
    assert.ok(fks.every((r) => r.confdeltype === "r"));
    const idx = (await c.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%\\_user\\_id\\_idx'`)).rows.map((r) => r.indexname);
    for (const t of EMAIL_LINKED_TABLES) assert.ok(idx.includes(`${t}_user_id_idx`), t);
    await assert.rejects(c.query(`DELETE FROM players WHERE id = 2`), /foreign key constraint/);
  });

  test("a row written without user_id (the previous app version) is linked on the way in", async () => {
    await c.query(`INSERT INTO bookings (session_date, first_name, last_name, email) VALUES ('2026-11-20', 'Mia', 'M', '  mia@X.TEST'), ('2026-11-20', 'New', 'Guest', 'later@x.test')`);
    assert.deepEqual(await uid("bookings", "session_date = '2026-11-20' ORDER BY id"), [1, null]);
    await c.query(`INSERT INTO memberships (email, plan, status) VALUES ('later@x.test', 'quarterly', 'pending')`);
    assert.deepEqual(await disagreements(), {});
  });

  test("a new account picks up the rows already stored under its email", async () => {
    await c.query(`INSERT INTO players (id, email, first_name) VALUES (4, 'later@x.test', 'Later')`);
    assert.deepEqual(await uid("bookings", "email = 'later@x.test'"), [4]);
    assert.deepEqual(await uid("memberships", "email = 'later@x.test'"), [4]);
    assert.deepEqual(await disagreements(), {});
  });

  test("an account email change keeps every row linked (the statements changePlayerEmail runs)", async () => {
    await c.query(`UPDATE players SET email = 'mia.new@x.test' WHERE id = 1`);
    for (const t of ["memberships", "bookings", "session_fill_ins", "casual_play_profiles", "jersey_registrations", "attendance", "player_absences"]) {
      await c.query(`UPDATE ${t} SET email = 'mia.new@x.test' WHERE lower(trim(email)) = 'mia@x.test'`);
    }
    assert.deepEqual(await uid("attendance", "user_id = 1 ORDER BY session_date"), [1, 1]);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM memberships WHERE user_id = 1`)).rows[0].n, 1);
    assert.deepEqual(await disagreements(), {});
  });

  test("a merge moves the duplicate's rows to the kept account", async () => {
    // As lib/player-merge.ts does: rows move to the kept email, then the duplicate is retired.
    await c.query(`UPDATE bookings SET email = 'mia.new@x.test' WHERE lower(trim(email)) = 'later@x.test'`);
    await c.query(`UPDATE memberships SET email = 'mia.new@x.test' WHERE lower(trim(email)) = 'later@x.test'`);
    await c.query(`UPDATE players SET deleted_at = now(), email = 'deleted-4@deleted.invalid' WHERE id = 4`);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM bookings WHERE user_id = 4`)).rows[0].n, 0);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM memberships WHERE user_id = 1`)).rows[0].n, 2);
    assert.deepEqual(await disagreements(), {});
  });

  test("a deleted account lets go of its rows; they stay, with their email", async () => {
    const before = (await c.query(`SELECT count(*)::int AS n FROM attendance`)).rows[0].n;
    // As deletePlayerAccount does.
    await c.query(`UPDATE players SET deleted_at = now(), email = 'deleted-' || id || '@deleted.invalid' WHERE id = 1`);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM attendance`)).rows[0].n, before, "no row is deleted");
    for (const t of EMAIL_LINKED_TABLES) assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = 1`)).rows[0].n, 0, t);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM attendance WHERE email = 'mia.new@x.test'`)).rows[0].n, 2, "the email is still there");
    assert.deepEqual(await disagreements(), {});
    // Signing up again with the same email picks the history up, as today.
    await c.query(`INSERT INTO players (id, email) VALUES (5, 'mia.new@x.test')`);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM attendance WHERE user_id = 5`)).rows[0].n, 2);
  });
});
