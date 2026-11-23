// Account foreign keys are RESTRICT (Phase 2 PR 4, test plan §4.2, §4.5).
//
// Accounts are only ever soft-deleted. On the migrated schema, a hard
// DELETE of an account with data is refused (nothing is wiped or detached),
// while the app's own account deletion (deletePlayerAccount: soft delete and
// anonymise) still works and keeps the person's history.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `account_fks_${process.pid}`;

function urlFor(db: string) {
  const u = new URL(BASE_URL!);
  u.pathname = `/${db}`;
  return u.toString();
}

describe("account foreign keys", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
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
    await c.query(`INSERT INTO players (id, email, first_name) VALUES (1, 'a@x.test', 'A'), (2, 'b@x.test', 'B')`);
    await c.query(`INSERT INTO player_sessions (player_id, token_hash, expires_at) VALUES (1, 'h1', now() + interval '1 day')`);
    await c.query(`INSERT INTO message_threads (player_id, subject) VALUES (1, 'Hi')`);
    await c.query(`INSERT INTO player_photos (player_id, original_url, display_url, thumb_url, consent_at) VALUES (1, 'o', 'd', 't', now())`);
    await c.query(`INSERT INTO player_events (player_id, event) VALUES (1, 'login')`);
    await c.query(`INSERT INTO api_tokens (player_id, name, scopes, token_hash, prefix) VALUES (1, 'k', ARRAY['me:read'], 'th', 'tw')`);
    await c.query(`INSERT INTO webhook_endpoints (player_id, url, secret, events) VALUES (1, 'https://h.test', 's', ARRAY['x'])`);
    await c.query(`INSERT INTO shop_orders (player_id, email, status, payment_method, total_cents) VALUES (1, 'a@x.test', 'paid', 'card', 100)`);
    await c.query(`INSERT INTO cancellation_feedback (player_id, action, reason) VALUES (1, 'cancel', 'r')`);
  });
  after(async () => {
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("every foreign key to players is ON DELETE RESTRICT", async () => {
    const { rows } = await c.query(
      `SELECT conrelid::regclass::text AS t, confdeltype FROM pg_constraint WHERE contype = 'f' AND confrelid = 'players'::regclass ORDER BY 1`,
    );
    assert.ok(rows.length >= 8);
    assert.deepEqual(rows.filter((r) => r.confdeltype !== "r").map((r) => r.t), [], "not RESTRICT");
  });

  test("a hard delete of an account with data is refused, and nothing is wiped", async () => {
    await assert.rejects(c.query(`DELETE FROM players WHERE id = 1`), (e: { code?: string }) => e.code === "23001" || e.code === "23503");
    const counts = await c.query(`SELECT
      (SELECT count(*) FROM player_sessions WHERE player_id = 1)::int AS s,
      (SELECT count(*) FROM message_threads WHERE player_id = 1)::int AS m,
      (SELECT count(*) FROM shop_orders WHERE player_id = 1)::int AS o,
      (SELECT count(*) FROM cancellation_feedback WHERE player_id = 1)::int AS f`);
    assert.deepEqual(counts.rows[0], { s: 1, m: 1, o: 1, f: 1 });
  });

  test("an account without data can still be removed (nothing depends on it)", async () => {
    await c.query(`DELETE FROM players WHERE id = 2`);
  });

  test("the app's soft delete still works and keeps the history", async () => {
    // Same statements as deletePlayerAccount (lib/player-db.ts).
    await c.query(`DELETE FROM player_sessions WHERE player_id = 1`);
    await c.query(`UPDATE players SET deleted_at = NOW(), email = 'deleted-' || id || '@deleted.invalid', phone = NULL, phone_e164 = NULL,
      phone_verified_at = NULL, display_name = NULL, first_name = '', last_name = '', leaderboard_visible = FALSE WHERE id = 1`);
    const { rows } = await c.query(`SELECT (SELECT count(*) FROM message_threads WHERE player_id = 1)::int AS m, (SELECT count(*) FROM shop_orders WHERE player_id = 1)::int AS o`);
    assert.deepEqual(rows[0], { m: 1, o: 1 });
  });
});
