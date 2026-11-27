// Audit C6: a club admin's account merge stays inside the club. Accounts are
// global, so the merge moves only this club's records found by email, and
// retires or renames an account only when it is in this club and no other.
//
// The second club is synthetic and lives only in this test's database.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";
import { MergeError, runMerge, type Q } from "../lib/player-merge.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `merge_clubs_${process.pid}`;

describe("account merge, with two clubs", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let club2 = 0;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const q: Q = (text, params) => c.query(text, params as unknown[]);
  const n = async (sql: string, params: unknown[] = []) => Number((await c.query(sql, params)).rows[0].n);

  /** Runs the merge in a transaction that is always rolled back; returns what it threw or what it did. */
  async function tryMerge(keep: string, merge: string) {
    await c.query("BEGIN");
    try {
      const r = await runMerge(q, keep, merge);
      const after = {
        here: await n(`SELECT count(*)::int AS n FROM attendance WHERE email = $1 AND tenant_id = 1`, [keep]),
        dupeThere: await n(`SELECT count(*)::int AS n FROM attendance WHERE email = $1 AND tenant_id = $2`, [merge, club2]),
        retired: await n(`SELECT count(*)::int AS n FROM players WHERE email = $1 AND deleted_at IS NULL`, [merge]),
      };
      return { result: r, after };
    } catch (err) {
      return { error: err as Error };
    } finally {
      await c.query("ROLLBACK");
    }
  }

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
    club2 = (
      await c.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, payment_mode, incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    // keep@: the account to keep. dupe@: a second account, in this club only.
    // both@: an account in this club AND the other one. there@: only in the other club.
    await c.query(`INSERT INTO players (id, email, first_name, phone) VALUES
      (1, 'keep@x.test', 'Keep', NULL), (2, 'dupe@x.test', 'Dupe', '+64210000002'),
      (3, 'both@x.test', 'Both', '+64210000003'), (4, 'there@x.test', 'There', '+64210000004')`);
    await c.query(`INSERT INTO club_members (tenant_id, user_id) VALUES (1, 1), (1, 2), (1, 3), ($1, 3), ($1, 4)`, [club2]);
    // Play days under dupe@ in both clubs: the other club's are that club's records.
    await c.query(
      `INSERT INTO attendance (tenant_id, session_date, email, source) VALUES
         (1, '2026-11-01', 'dupe@x.test', 'admin'), ($1, '2026-11-02', 'dupe@x.test', 'admin'),
         (1, '2026-11-03', 'nobody@x.test', 'admin'), ($1, '2026-11-04', 'nobody@x.test', 'admin')`,
      [club2],
    );
  });
  after(async () => {
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("an account in this club only: merged; only this club's records by email move", async () => {
    const r = await tryMerge("keep@x.test", "dupe@x.test");
    assert.ok(!("error" in r) || !r.error, String(r.error));
    assert.equal(r.result!.account, "merged");
    assert.deepEqual(r.after, { here: 1, dupeThere: 1, retired: 0 }, "the other club's play day stays under the old email");
  });

  test("an account that is also in another club: refused, nothing changed", async () => {
    const before = await n(`SELECT count(*)::int AS n FROM players WHERE id = 3 AND deleted_at IS NULL AND phone IS NOT NULL`);
    const r = await tryMerge("keep@x.test", "both@x.test");
    assert.ok(r.error instanceof MergeError, "a MergeError");
    assert.match(r.error!.message, /another club/);
    assert.equal(await n(`SELECT count(*)::int AS n FROM players WHERE id = 3 AND deleted_at IS NULL AND phone IS NOT NULL`), before);
  });

  test("an account of another club only: refused (not this club's to retire)", async () => {
    const r = await tryMerge("keep@x.test", "there@x.test");
    assert.ok(r.error instanceof MergeError);
    assert.match(r.error!.message, /another club/);
  });

  test("records with no account: only this club's move", async () => {
    const r = await tryMerge("keep@x.test", "nobody@x.test");
    assert.ok(!r.error, String(r.error));
    assert.equal(r.result!.account, "records_only");
    assert.deepEqual(r.after, { here: 1, dupeThere: 1, retired: 0 });
  });

  test("the other club, merging there: its own records move, and this club's stay", async () => {
    const was = process.env.TENANT_SLUG;
    process.env.TENANT_SLUG = "hanoi-smash";
    try {
      await c.query("BEGIN");
      const r = await runMerge(q, "keep@x.test", "nobody@x.test");
      assert.equal(r.account, "records_only");
      assert.equal(await n(`SELECT count(*)::int AS n FROM attendance WHERE email = 'nobody@x.test' AND tenant_id = 1`), 1);
      assert.equal(await n(`SELECT count(*)::int AS n FROM attendance WHERE email = 'keep@x.test' AND tenant_id = $1`, [club2]), 1);
    } finally {
      await c.query("ROLLBACK");
      if (was === undefined) delete process.env.TENANT_SLUG;
      else process.env.TENANT_SLUG = was;
    }
  });
});
