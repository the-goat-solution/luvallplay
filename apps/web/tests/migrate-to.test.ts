// `db:migrate -- --to <migration>` (scripts/db/migrate.mjs): production data
// steps run one at a time (build plan §9.4), so the migrator must be able to
// stop after a named migration and leave the later ones pending.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { loadMigrations, migrate, plan, resolveTarget } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `migrate_to_${process.pid}`;

describe("resolveTarget", () => {
  const all = loadMigrations();

  test("finds a migration by its full tag or its number", () => {
    assert.equal(resolveTarget(all, "0012_junior_activity").tag, "0012_junior_activity");
    assert.equal(resolveTarget(all, "0012").tag, "0012_junior_activity");
    assert.equal(resolveTarget(all, "12").tag, "0012_junior_activity");
    assert.equal(resolveTarget(all, "0").tag, "0000_baseline");
  });

  test("refuses a name it doesn't know, a partial name and nothing at all", () => {
    assert.throws(() => resolveTarget(all, "9999"), /no such migration/);
    assert.throws(() => resolveTarget(all, "0012_junior"), /no such migration/);
    assert.throws(() => resolveTarget(all, ""), /needs a migration/);
    assert.throws(() => resolveTarget(all, undefined), /needs a migration/);
  });

  test("refuses a number two migrations share", () => {
    const twice = [...all, { ...all[all.length - 1], tag: "0012_another" }];
    assert.throws(() => resolveTarget(twice, "0012"), /more than one/);
    assert.equal(resolveTarget(twice, "0012_another").tag, "0012_another");
  });
});

describe("migrate --to", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const all = loadMigrations();
  const pendingTags = async () => (await plan(c, all)).pending.map((m: { tag: string }) => m.tag);

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.end();
    c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();
  });
  after(async () => {
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("a target that doesn't exist changes nothing", async () => {
    await assert.rejects(migrate(c, { to: "9999", log: () => {} }), /no such migration/);
    assert.equal((await c.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS r`)).rows[0].r, null);
    assert.equal((await c.query(`SELECT to_regclass('public.players') AS r`)).rows[0].r, null);
  });

  test("stops after the named migration and says what it left", async () => {
    const lines: string[] = [];
    const applied = await migrate(c, { to: "0011", log: (l: string) => lines.push(l) });
    assert.deepEqual(applied, all.slice(0, 12).map((m: { tag: string }) => m.tag));
    assert.deepEqual(await pendingTags(), all.slice(12).map((m: { tag: string }) => m.tag));
    assert.match(lines[0], /^Stopping after 0011_tenant_keys_contract; left pending: 0012_junior_activity, 0013_terms_players/);
    assert.equal((await c.query(`SELECT to_regclass('public.junior_bookings') AS r`)).rows[0].r, null);
  });

  test("one step at a time: 0012 alone, then 0013 alone", async () => {
    assert.deepEqual(await migrate(c, { to: "0012", log: () => {} }), ["0012_junior_activity"]);
    assert.notEqual((await c.query(`SELECT to_regclass('public.junior_bookings') AS r`)).rows[0].r, null);
    const terms = async () => (await c.query(`SELECT terms FROM tenants WHERE slug = 'three-wolves'`)).rows[0].terms;
    assert.equal((await terms()).player_name, undefined);
    assert.deepEqual(await migrate(c, { to: "0013_terms_players", log: () => {} }), ["0013_terms_players"]);
    assert.equal((await terms()).player_name, "Wolf");
  });

  test("a target already applied does nothing, even with later ones pending", async () => {
    const lines: string[] = [];
    assert.deepEqual(await migrate(c, { to: "0005", log: (l: string) => lines.push(l) }), []);
    assert.match(lines[0], /0005_user_id_links is already applied/);
  });

  test("without --to, everything pending still runs", async () => {
    const before = await pendingTags();
    assert.deepEqual(await migrate(c, { log: () => {} }), before);
    assert.deepEqual(await pendingTags(), []);
  });
});
