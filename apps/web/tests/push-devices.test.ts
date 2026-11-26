// Phase 5 step 6: a person's devices for push notifications and the kinds
// they asked for (lib/push). The device's address is sealed before it reaches
// the database; one person can't read or remove another's devices. Against a
// real Postgres. Made-up addresses only.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";
import { PushSealError, pushSeal, pushSealAvailable } from "../lib/push/seal.ts";
import { MAX_DEVICES, PUSH_CATEGORIES, addressesFor, countDevices, getPrefs, registerDevice, removeAllDevices, removeDevice, removeGoneAddresses, setPrefs } from "../lib/push/devices.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `push_devices_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const key = () => randomBytes(32).toString("base64");
const ENV = { PUSH_KEKS: `p1:${key()}` };
const address = (n: number) => `fcm-test-device-${String(n).padStart(3, "0")}:APA91b${"x".repeat(60)}`;
const PHONE = address(1);

test("sealing needs a key: with none, or a malformed one, push is unavailable (never plain text)", () => {
  assert.equal(pushSealAvailable({}), false);
  assert.equal(pushSealAvailable({ PUSH_KEKS: "p1:too-short" }), false);
  assert.equal(pushSealAvailable(ENV), true);
  assert.throws(() => pushSeal({}).seal({ playerId: 3, deviceId: 1 }, PHONE), PushSealError);
  assert.throws(() => pushSeal({ PUSH_KEKS: "p1:too-short" }).seal({ playerId: 3, deviceId: 1 }, PHONE), /32 bytes/);
});

test("a sealed address opens only for the same person and device, and survives a key rotation", () => {
  const seal = pushSeal(ENV);
  const sealed = seal.seal({ playerId: 3, deviceId: 7 }, PHONE);
  assert.match(sealed, /^v1\.p1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!sealed.includes("fcm-test-device"), "nothing readable");
  assert.notEqual(sealed, seal.seal({ playerId: 3, deviceId: 7 }, PHONE), "sealed afresh each time");
  assert.equal(seal.open({ playerId: 3, deviceId: 7 }, sealed), PHONE);
  assert.throws(() => seal.open({ playerId: 4, deviceId: 7 }, sealed), /can't be opened/);
  assert.throws(() => seal.open({ playerId: 3, deviceId: 8 }, sealed), /can't be opened/);
  assert.throws(() => seal.open({ playerId: 3, deviceId: 7 }, `${sealed.slice(0, -2)}AA`), /can't be opened/);
  assert.throws(() => seal.seal({ playerId: 0, deviceId: 7 }, PHONE), /person and the device/);
  const rotated = pushSeal({ PUSH_KEKS: `p2:${key()},${ENV.PUSH_KEKS}` });
  assert.equal(rotated.open({ playerId: 3, deviceId: 7 }, sealed), PHONE, "old sealings still open");
  assert.match(rotated.seal({ playerId: 3, deviceId: 7 }, PHONE), /^v1\.p2\./, "new ones use the newest key");
  assert.throws(() => pushSeal({ PUSH_KEKS: `p2:${key()}` }).open({ playerId: 3, deviceId: 7 }, sealed), /isn't available/);
});

describe("push devices and choices", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  // Seed accounts: 3 Mia, 4 Pete, 25 a deleted account.
  const MIA = 3;
  const PETE = 4;
  const rows = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows;

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
  });
  after(async () => {
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });
  beforeEach(async () => {
    await c.query(`DELETE FROM push_devices`);
    await c.query(`DELETE FROM push_prefs`);
  });

  test("with no key nothing is stored; a bad address or platform is refused", async () => {
    assert.deepEqual(await registerDevice(c, MIA, { token: PHONE, platform: "android" }, {}), { ok: false, code: "unavailable" });
    for (const bad of [{ token: "short", platform: "android" }, { token: `${PHONE} with spaces`, platform: "android" }, { token: 12, platform: "android" }, { token: PHONE, platform: "windows" }, { token: PHONE, platform: undefined }]) {
      assert.deepEqual(await registerDevice(c, MIA, bad, ENV), { ok: false, code: "invalid" }, JSON.stringify(bad));
    }
    assert.equal(await countDevices(c, MIA), 0);
  });

  test("a device is stored sealed, with a hash; registering it again adds nothing", async () => {
    assert.deepEqual(await registerDevice(c, MIA, { token: PHONE, platform: "android" }, ENV), { ok: true });
    assert.deepEqual(await registerDevice(c, MIA, { token: PHONE, platform: "android" }, ENV), { ok: true });
    const [row, ...more] = await rows(`SELECT * FROM push_devices`);
    assert.equal(more.length, 0);
    assert.equal(row.player_id, MIA);
    assert.match(row.token_hash, /^[0-9a-f]{64}$/);
    assert.match(row.sealed, /^v1\.p1\./);
    assert.ok(!JSON.stringify(row).includes("fcm-test-device"), "the address is nowhere in the row");
    assert.equal(pushSeal(ENV).open({ playerId: MIA, deviceId: row.id }, row.sealed), PHONE);
  });

  test("the database refuses a plain address, an unknown platform and an unknown kind", async () => {
    const hash = "a".repeat(64);
    await assert.rejects(c.query(`INSERT INTO push_devices (player_id, platform, token_hash, sealed) VALUES ($1, 'android', $2, $3)`, [MIA, hash, PHONE]), /push_devices_sealed_check/);
    await assert.rejects(c.query(`INSERT INTO push_devices (player_id, platform, token_hash, sealed) VALUES ($1, 'web', $2, 'v1.p1.aa.bb')`, [MIA, hash]), /push_devices_platform_check/);
    await assert.rejects(c.query(`INSERT INTO push_devices (player_id, platform, token_hash, sealed) VALUES ($1, 'ios', $2, 'v1.p1.aa.bb')`, [MIA, PHONE]), /push_devices_token_hash_check/);
    await assert.rejects(c.query(`INSERT INTO push_prefs (player_id, category, enabled) VALUES ($1, 'marketing', true)`, [MIA]), /push_prefs_category_check/);
  });

  test("one person can't read or remove another's devices", async () => {
    await registerDevice(c, MIA, { token: PHONE, platform: "android" }, ENV);
    await setPrefs(c, MIA, { message: true });
    await setPrefs(c, PETE, { message: true });
    assert.equal(await countDevices(c, PETE), 0);
    assert.deepEqual(await addressesFor(c, PETE, "message", ENV), []);
    assert.deepEqual(await removeDevice(c, PETE, PHONE), { removed: false }, "even knowing the address");
    assert.equal(await removeAllDevices(c, PETE), 0);
    assert.equal(await countDevices(c, MIA), 1);
    assert.deepEqual(await addressesFor(c, MIA, "message", ENV), [PHONE]);
    // A row copied under another person can't be opened as theirs.
    const [mine] = await rows(`SELECT sealed FROM push_devices WHERE player_id = $1`, [MIA]);
    await c.query(`INSERT INTO push_devices (player_id, platform, token_hash, sealed) VALUES ($1, 'android', $2, $3)`, [PETE, "b".repeat(64), mine.sealed]);
    assert.deepEqual(await addressesFor(c, PETE, "message", ENV), [], "skipped, not opened");
  });

  test("one phone, one account: signing in as someone else on it moves it, and the first person's stop arriving there", async () => {
    await registerDevice(c, MIA, { token: PHONE, platform: "android" }, ENV);
    await setPrefs(c, MIA, { challenge: true });
    await setPrefs(c, PETE, { challenge: true });
    assert.deepEqual(await registerDevice(c, PETE, { token: PHONE, platform: "android" }, ENV), { ok: true });
    assert.deepEqual(await addressesFor(c, MIA, "challenge", ENV), []);
    assert.deepEqual(await addressesFor(c, PETE, "challenge", ENV), [PHONE]);
    assert.equal((await rows(`SELECT 1 FROM push_devices`)).length, 1);
  });

  test("removing: the person's own device, or all of them", async () => {
    await registerDevice(c, MIA, { token: PHONE, platform: "android" }, ENV);
    await registerDevice(c, MIA, { token: address(2), platform: "ios" }, ENV);
    assert.deepEqual(await removeDevice(c, MIA, PHONE), { removed: true });
    assert.deepEqual(await removeDevice(c, MIA, PHONE), { removed: false });
    assert.deepEqual(await removeDevice(c, MIA, { not: "an address" }), { removed: false });
    assert.equal(await countDevices(c, MIA), 1);
    assert.equal(await removeAllDevices(c, MIA), 1);
    assert.equal(await countDevices(c, MIA), 0);
  });

  test("addresses the push service says are gone: their rows go, and nothing else", async () => {
    await registerDevice(c, MIA, { token: PHONE, platform: "android" }, ENV);
    await registerDevice(c, MIA, { token: address(2), platform: "android" }, ENV);
    await registerDevice(c, PETE, { token: address(3), platform: "ios" }, ENV);
    assert.equal(await removeGoneAddresses(c, []), 0);
    assert.equal(await removeGoneAddresses(c, ["not an address", address(77)]), 0);
    assert.equal(await removeGoneAddresses(c, [PHONE, address(3)]), 2);
    assert.deepEqual([await countDevices(c, MIA), await countDevices(c, PETE)], [1, 0]);
  });

  test(`at most ${MAX_DEVICES} devices: the one unused longest goes`, async () => {
    for (let n = 1; n <= MAX_DEVICES; n++) await registerDevice(c, MIA, { token: address(n), platform: "android" }, ENV);
    await c.query(`UPDATE push_devices SET last_seen_at = NOW() - INTERVAL '30 days' WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [address(4)]);
    await registerDevice(c, MIA, { token: address(99), platform: "android" }, ENV);
    await setPrefs(c, MIA, { roster: true });
    const now = await addressesFor(c, MIA, "roster", ENV);
    assert.equal(now.length, MAX_DEVICES);
    assert.ok(!now.includes(address(4)) && now.includes(address(99)));
  });

  test("it is opt-in: nothing is sent for a kind the person didn't turn on", async () => {
    await registerDevice(c, MIA, { token: PHONE, platform: "android" }, ENV);
    assert.deepEqual(await getPrefs(c, MIA), { challenge: false, result: false, message: false, reminder: false, roster: false, payment: false });
    for (const category of PUSH_CATEGORIES) assert.deepEqual(await addressesFor(c, MIA, category, ENV), [], category);
    const set = await setPrefs(c, MIA, { reminder: true, payment: true });
    assert.deepEqual(set, { ok: true, prefs: { challenge: false, result: false, message: false, reminder: true, roster: false, payment: true } });
    assert.deepEqual(await addressesFor(c, MIA, "reminder", ENV), [PHONE]);
    assert.deepEqual(await addressesFor(c, MIA, "challenge", ENV), []);
    await setPrefs(c, MIA, { reminder: false });
    assert.deepEqual(await addressesFor(c, MIA, "reminder", ENV), []);
    assert.deepEqual((await getPrefs(c, MIA)).payment, true, "kinds not named stay as they are");
    for (const bad of [{}, { marketing: true }, { reminder: "yes" }, { reminder: true, nope: false }]) assert.deepEqual(await setPrefs(c, MIA, bad), { ok: false, code: "invalid" }, JSON.stringify(bad));
  });

  test("the sender gets nothing without the key, for a deleted account, or for a row sealed with a key that is gone", async () => {
    await registerDevice(c, MIA, { token: PHONE, platform: "android" }, ENV);
    await setPrefs(c, MIA, { message: true });
    assert.deepEqual(await addressesFor(c, MIA, "message", {}), []);
    assert.deepEqual(await addressesFor(c, MIA, "message", { PUSH_KEKS: `p9:${key()}` }), []);
    assert.deepEqual(await addressesFor(c, MIA, "nope" as never, ENV), []);
    await c.query(`UPDATE push_devices SET player_id = 25`);
    await c.query(`INSERT INTO push_prefs (player_id, category, enabled) VALUES (25, 'message', true)`);
    assert.deepEqual(await addressesFor(c, 25, "message", ENV), []);
  });
});
