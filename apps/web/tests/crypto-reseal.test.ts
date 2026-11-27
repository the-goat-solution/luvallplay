// Key rotation: re-sealing what an old key sealed (lib/crypto-purposes.ts;
// scripts/crypto/reseal.mjs runs the same function).
//
// What must hold (encryption plan, Review Focus 4): a run stopped half-way
// leaves every row openable, running it again finishes the job, and a row
// re-sealed opens exactly where it opened before (same person, same device,
// same child, same club) through the app's own code. The same for the phone
// index when only its key rotates: once the old index key is dropped, sign-in
// by phone still finds everyone.
//
// Made-up people, numbers and addresses; throwaway keys. Needs Postgres
// (DATA_GUARD_TEST_URL's server); CI sets DATA_GUARD_REQUIRE_DB=1.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createSeal, parseKeks, SealError, sealedWith } from "@luvallplay/crypto";
import { migrate } from "../scripts/db/migrate.mjs";
import { KeyNotConfirmedError, PURPOSES, RESEAL_PURPOSES, reseal } from "../lib/crypto-purposes.ts";
import { pushSeal } from "../lib/push/seal.ts";
import { addressesFor, setPrefs } from "../lib/push/devices.ts";
import { addChild } from "../lib/juniors/family.ts";
import { juniorsVault, readMedicalNotesAsGuardian, setMedicalNotes } from "../lib/juniors/care.ts";
import { backfillPhones, findVerifiedByPhone, phoneSealing, verifyPhone } from "../lib/pii/contact.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `crypto_reseal_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const key = () => randomBytes(32).toString("base64");
const address = (n: number) => `fcm-test-device-${String(n).padStart(3, "0")}:APA91b${"x".repeat(60)}`;
const numberOf = (playerId: number) => `+6421${1000000 + playerId}`;

test("every sealed column has its purpose: its own key list, its table and key, and the binding the app seals with", () => {
  assert.deepEqual(PURPOSES.map((p) => [p.purpose, p.env, p.table, p.column]), [
    ["push_devices.sealed", "PUSH_KEKS", "push_devices", "sealed"],
    ["junior_medical_notes.sealed", "JUNIORS_KEKS", "junior_medical_notes", "sealed"],
    ["players.phone_sealed", "CONTACT_KEKS", "players", "phone_sealed"],
  ]);
  assert.equal(new Set(PURPOSES.map((p) => p.env)).size, PURPOSES.length, "one key list per purpose");
  assert.deepEqual(RESEAL_PURPOSES, [...PURPOSES.map((p) => p.purpose), "contact-index"]);
  const of = (name: string) => PURPOSES.find((p) => p.purpose === name)!;

  // Sealed by the app's own code, opened with the purpose's binding (and the other way round).
  const keys = `k1:${key()}`;
  const envelope = createSeal({ purpose: "test", keks: () => parseKeks(keys, "TEST") });
  const push = of("push_devices.sealed");
  const device = { id: 9, player_id: 3 };
  assert.equal(envelope.open(push.binding(device), pushSeal({ PUSH_KEKS: keys }).seal({ playerId: 3, deviceId: 9 }, address(1))), address(1));
  assert.deepEqual(push.key(device), { where: "id = $1", params: [9] });
  assert.equal(push.tenant, undefined, "a device belongs to an account, not a club");

  const phone = of("players.phone_sealed");
  assert.equal(envelope.open(phone.binding({ id: 3 }), phoneSealing({ CONTACT_KEKS: keys, CONTACT_INDEX_KEYS: `i1:${key()}` }).seal(3, numberOf(3)).sealed), numberOf(3));
  assert.deepEqual(phone.key({ id: 3 }), { where: "id = $1", params: [3] });

  const notes = of("junior_medical_notes.sealed");
  const note = { tenant_id: 2, junior_profile_id: 7 };
  assert.deepEqual(notes.binding(note), [2, "juniors.medical", "child:7"]);
  assert.deepEqual(notes.key(note), { where: "tenant_id = $1 AND junior_profile_id = $2", params: [2, 7] });
  assert.equal(notes.tenant?.(note), 2, "club-owned: handled one club at a time");
});

describe("re-sealing after a key rotation", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let other: pg.Client;
  let club2 = 0;
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  // Seed accounts: 3 Mia, 4 Pete, 5 Quinn (members of the first club).
  const MIA = 3;
  const PETE = 4;
  const value = <T,>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
    assert.ok(r.ok, JSON.stringify(r));
    return r.value;
  };
  const kids = async (table: string, column: string) => {
    // Asked on another connection: only what was committed counts.
    const { rows } = await other.query(`SELECT split_part(${column}, '.', 2) AS kid, count(*)::int AS n FROM ${table} WHERE ${column} IS NOT NULL GROUP BY 1 ORDER BY 1`);
    return Object.fromEntries(rows.map((r) => [r.kid, r.n]));
  };
  /** Nothing the script prints may hold a sealed text, an index, an address or a number. */
  const printsNoSecrets = async (lines: string[], plain: string[] = []) => {
    const printed = lines.join("\n");
    assert.ok(printed.length > 0);
    const secrets = [...plain];
    for (const sql of [`SELECT sealed AS s FROM push_devices`, `SELECT sealed AS s FROM junior_medical_notes`, `SELECT phone_sealed AS s FROM players`, `SELECT phone_index AS s FROM players`, `SELECT phone_e164 AS s FROM players`]) {
      for (const r of (await c.query(sql)).rows) if (r.s) secrets.push(r.s, ...String(r.s).split(".").slice(2));
    }
    for (const secret of secrets) assert.ok(!printed.includes(secret), "a secret was printed");
    assert.ok(!/[A-Za-z0-9_+/-]{40,}/.test(printed), "nothing that looks like a key, an index or sealed text");
    assert.ok(!/\d{7,}/.test(printed), "nothing that looks like a number");
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
    other = new pg.Client({ connectionString: urlFor(NAME) });
    await other.connect();
    await migrate(c, { log: () => {} });
    await c.query(SEED);
    club2 = (
      await c.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, 'free', incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
  });
  after(async () => {
    await other?.end();
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });
  beforeEach(async () => {
    await c.query(`ROLLBACK`).catch(() => {});
    await c.query(`RESET ROLE`);
    await c.query(`DELETE FROM push_devices`);
    await c.query(`DELETE FROM push_prefs`);
    await c.query(`DELETE FROM junior_medical_notes`);
    await c.query(`DELETE FROM guardianships`);
    await c.query(`DELETE FROM junior_profiles`);
    await c.query(`UPDATE players SET phone = NULL, phone_e164 = NULL, phone_verified_at = NULL, phone_sealed = NULL, phone_index = NULL, phone_index_kid = NULL`);
  });

  /** `count` devices for Mia and Pete, sealed by the app's own seal. */
  const devices = async (count: number, env: { PUSH_KEKS: string }, from = 1) => {
    const seal = pushSeal(env);
    for (let n = from; n < from + count; n++) {
      const playerId = n % 2 ? MIA : PETE;
      const id = Number((await c.query(`SELECT nextval('push_devices_id_seq') AS id`)).rows[0].id);
      await c.query(`INSERT INTO push_devices (id, player_id, platform, token_hash, sealed) VALUES ($1, $2, 'android', $3, $4)`, [
        id,
        playerId,
        createHash("sha256").update(address(n)).digest("hex"),
        seal.seal({ playerId, deviceId: id }, address(n)),
      ]);
    }
  };
  /** Every device's address, opened for its own person and device (throws if one can't be). */
  const openDevices = async (env: { PUSH_KEKS: string }) => {
    const seal = pushSeal(env);
    const { rows } = await c.query(`SELECT id, player_id, sealed FROM push_devices ORDER BY id`);
    return rows.map((r) => seal.open({ playerId: r.player_id, deviceId: r.id }, r.sealed));
  };
  const allAddresses = (count: number) => Array.from({ length: count }, (_, i) => address(i + 1));

  test("250 rows, stopped after the first batch: every row still opens; run again and all are on the new key; a third run has nothing to do", async () => {
    const K1 = { PUSH_KEKS: `p1:${key()}` };
    await devices(250, K1);
    const ROTATED = { PUSH_KEKS: `p2:${key()},${K1.PUSH_KEKS}` };
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);

    // A dry run counts by key and writes nothing.
    const before = (await c.query(`SELECT id, sealed FROM push_devices ORDER BY id`)).rows;
    const dry = await reseal(c, { purpose: "push_devices.sealed", apply: false, env: ROTATED, log });
    assert.deepEqual(dry, { purpose: "push_devices.sealed", current: "p2", byKey: { p1: 250 }, todo: 250, done: 0, skipped: 0, problems: 0 });
    assert.deepEqual((await c.query(`SELECT id, sealed FROM push_devices ORDER BY id`)).rows, before, "a dry run writes nothing");
    assert.ok(lines.some((l) => /p1/.test(l) && /250/.test(l)), "the count per key is listed");
    assert.equal(lines[0], "current key: p2", "the key every row is brought to is said first, to compare with the deployed list");

    // Stopped after the first batch of 100 (an injected failure: a lost connection, a closed laptop).
    // No row is on p2 yet (the first use of the key), which has to be said;
    // every later run confirms its key against the rows now on p2 by itself.
    await assert.rejects(
      reseal(c, {
        purpose: "push_devices.sealed",
        apply: true,
        firstUseOfKey: true,
        env: ROTATED,
        log,
        onStep: (step) => {
          if (step === "committed") throw new Error("stopped (test)");
        },
      }),
      /stopped \(test\)/,
    );
    assert.deepEqual(await kids("push_devices", "sealed"), { p1: 150, p2: 100 }, "one batch of 100 was written, in one transaction");
    assert.deepEqual(await openDevices(ROTATED), allAddresses(250), "every row still opens");

    // Stopped again, this time in the middle of a batch: that batch is not written at all.
    let reads = 0;
    await assert.rejects(
      reseal(c, {
        purpose: "push_devices.sealed",
        apply: true,
        env: ROTATED,
        log,
        onStep: (step) => {
          if (step === "read" && ++reads === 2) throw new Error("stopped mid-batch (test)");
        },
      }),
      /stopped mid-batch/,
    );
    assert.deepEqual(await kids("push_devices", "sealed"), { p1: 50, p2: 200 }, "the half-done batch was rolled back whole");
    assert.deepEqual(await openDevices(ROTATED), allAddresses(250), "every row still opens");

    // Run again: it finishes the job.
    const second = await reseal(c, { purpose: "push_devices.sealed", apply: true, env: ROTATED, log });
    assert.deepEqual(second, { purpose: "push_devices.sealed", current: "p2", byKey: { p1: 50, p2: 200 }, todo: 50, done: 50, skipped: 0, problems: 0 });
    assert.deepEqual(await kids("push_devices", "sealed"), { p2: 250 });
    // The old key can go: everything opens with the new one alone, through the app's own reader.
    const NEW_ONLY = { PUSH_KEKS: ROTATED.PUSH_KEKS.split(",")[0] };
    assert.deepEqual(await openDevices(NEW_ONLY), allAddresses(250));
    await setPrefs(c, MIA, { message: true });
    assert.equal((await addressesFor(c, MIA, "message", NEW_ONLY)).length, 125);

    // A third run reports 0 to do and changes nothing.
    const snapshot = (await c.query(`SELECT * FROM push_devices ORDER BY id`)).rows;
    const third = await reseal(c, { purpose: "push_devices.sealed", apply: true, env: ROTATED, log });
    assert.deepEqual(third, { purpose: "push_devices.sealed", current: "p2", byKey: { p2: 250 }, todo: 0, done: 0, skipped: 0, problems: 0 });
    assert.deepEqual((await c.query(`SELECT * FROM push_devices ORDER BY id`)).rows, snapshot);
    // Nothing else of a row was touched by any run.
    assert.deepEqual(
      snapshot.map((r) => [r.id, r.player_id, r.token_hash]),
      (await c.query(`SELECT id, player_id, token_hash FROM push_devices ORDER BY id`)).rows.map((r) => [r.id, r.player_id, r.token_hash]),
    );
    await printsNoSecrets(lines, allAddresses(250));
  });

  test("medical notes in two clubs re-seal: each opens with its own club's binding afterwards, and only there", async () => {
    const J1 = { JUNIORS_KEKS: `j1:${key()}` };
    const NOW = new Date("2026-11-26T02:00:00.000Z");
    const add = async (tenantId: number, guardianId: number, name: string) => value(await addChild(c, tenantId, guardianId, { name, birthYear: 2016, guardianConfirmed: true }, { year: 2026, now: NOW })).id;
    const tama = await add(1, MIA, "Tama Testchild");
    const ben = await add(1, PETE, "Ben Testchild");
    const linh = await add(club2, MIA, "Linh Testchild");
    const NOTES: [number, number, number, string][] = [
      [1, MIA, tama, "Asthma: blue inhaler in the bag."],
      [1, PETE, ben, "Allergic to penicillin."],
      [club2, MIA, linh, "Wears glasses for play."],
    ];
    for (const [tenantId, guardianId, childId, text] of NOTES) value(await setMedicalNotes(c, juniorsVault(J1), tenantId, guardianId, childId, text, J1));
    const ROTATED = { JUNIORS_KEKS: `j2:${key()},${J1.JUNIORS_KEKS}` };
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);

    // The table has forced row-level security. Run as the app's own database
    // role, which sees a club's rows only inside a transaction that names the
    // club: the script must go one club at a time, or it would see nothing.
    await c.query(`SET ROLE luvallplay_app`);
    try {
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_medical_notes`)).rows[0].n, 0, "outside a club's transaction this role sees no note");
      assert.deepEqual(await reseal(c, { purpose: "junior_medical_notes.sealed", apply: false, env: ROTATED, log }), { purpose: "junior_medical_notes.sealed", current: "j2", byKey: { j1: 3 }, todo: 3, done: 0, skipped: 0, problems: 0 });
      assert.deepEqual(await reseal(c, { purpose: "junior_medical_notes.sealed", apply: true, batch: 1, firstUseOfKey: true, env: ROTATED, log }), { purpose: "junior_medical_notes.sealed", current: "j2", byKey: { j1: 3 }, todo: 3, done: 3, skipped: 0, problems: 0 });
    } finally {
      await c.query(`RESET ROLE`);
    }
    assert.deepEqual(await kids("junior_medical_notes", "sealed"), { j2: 3 });
    assert.equal((await c.query(`SELECT current_setting('app.tenant_id', true) AS t`)).rows[0].t || "", "", "the club named for a batch doesn't outlive its transaction");

    // With the old key gone, each guardian reads their child's note in the child's own club.
    const NEW_ONLY = { JUNIORS_KEKS: ROTATED.JUNIORS_KEKS.split(",")[0] };
    for (const [tenantId, guardianId, childId, text] of NOTES) {
      assert.equal(value(await readMedicalNotesAsGuardian(c, juniorsVault(NEW_ONLY), tenantId, guardianId, childId, NEW_ONLY)).notes, text);
    }
    // And only there: one club's re-sealed note, copied onto the other club's child, doesn't open.
    await c.query(`UPDATE junior_medical_notes SET sealed = (SELECT sealed FROM junior_medical_notes WHERE tenant_id = 1 AND junior_profile_id = $1) WHERE tenant_id = $2 AND junior_profile_id = $3`, [tama, club2, linh]);
    await assert.rejects(readMedicalNotesAsGuardian(c, juniorsVault(NEW_ONLY), club2, MIA, linh, NEW_ONLY), /can't be opened/);
    // Who wrote the note and when is not the script's to change.
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM junior_medical_notes WHERE updated_by_user_id IN ($1, $2)`, [MIA, PETE])).rows[0].n, 3);
    await printsNoSecrets(lines, NOTES.map((n) => n[3]));

    // As the database's owner (who sees every club's rows) it is still one club at a time, and finds the same.
    assert.deepEqual((await reseal(c, { purpose: "junior_medical_notes.sealed", apply: false, env: ROTATED })).byKey, { j2: 3 });

    // The next rotation, without the flag: a server has already sealed ONE note
    // with j3, in the second club only. That row confirms the key for every club.
    const J3 = key();
    const AGAIN = { JUNIORS_KEKS: `j3:${J3},${ROTATED.JUNIORS_KEKS}` };
    await assert.rejects(reseal(c, { purpose: "junior_medical_notes.sealed", apply: true, env: AGAIN }), (err: unknown) => err instanceof KeyNotConfirmedError && /JUNIORS_KEKS/.test(err.message) && /"j3"/.test(err.message) && /--first-use-of-key/.test(err.message));
    assert.deepEqual(await kids("junior_medical_notes", "sealed"), { j2: 3 }, "refused: nothing was written");
    value(await setMedicalNotes(c, juniorsVault(AGAIN), club2, MIA, linh, NOTES[2][3], AGAIN));
    // A shell with the right id and other key bytes is refused, as the app's role too.
    const WRONG = { JUNIORS_KEKS: `j3:${key()},${ROTATED.JUNIORS_KEKS}` };
    await c.query(`SET ROLE luvallplay_app`);
    try {
      await assert.rejects(reseal(c, { purpose: "junior_medical_notes.sealed", apply: true, firstUseOfKey: true, env: WRONG }), (err: unknown) => err instanceof KeyNotConfirmedError && /differs from the one that sealed/.test(err.message));
      assert.deepEqual(await kids("junior_medical_notes", "sealed"), { j2: 2, j3: 1 }, "refused: nothing was written");
      assert.deepEqual(await reseal(c, { purpose: "junior_medical_notes.sealed", apply: true, env: AGAIN }), { purpose: "junior_medical_notes.sealed", current: "j3", byKey: { j2: 2, j3: 1 }, todo: 2, done: 2, skipped: 0, problems: 0 });
    } finally {
      await c.query(`RESET ROLE`);
    }
    const NEWEST = { JUNIORS_KEKS: `j3:${J3}` };
    for (const [tenantId, guardianId, childId, text] of NOTES) {
      assert.equal(value(await readMedicalNotesAsGuardian(c, juniorsVault(NEWEST), tenantId, guardianId, childId, NEWEST)).notes, text);
    }
  });

  test("a row that can't be opened is counted and left exactly as it was; the others are re-sealed; a write made meanwhile wins", async () => {
    const K1 = { PUSH_KEKS: `p1:${key()}` };
    await devices(6, K1);
    const ids = (await c.query(`SELECT id FROM push_devices ORDER BY id`)).rows.map((r) => Number(r.id));
    // One sealed with a key that is no longer listed, one copied from another device (the wrong binding).
    const gone = pushSeal({ PUSH_KEKS: `p0:${key()}` }).seal({ playerId: MIA, deviceId: ids[0] }, address(1));
    await c.query(`UPDATE push_devices SET sealed = $2 WHERE id = $1`, [ids[0], gone]);
    await c.query(`UPDATE push_devices SET sealed = (SELECT sealed FROM push_devices WHERE id = $2) WHERE id = $1`, [ids[1], ids[2]]);
    const copied = (await c.query(`SELECT sealed FROM push_devices WHERE id = $1`, [ids[1]])).rows[0].sealed;
    const ROTATED = { PUSH_KEKS: `p2:${key()},${K1.PUSH_KEKS}` };
    // While the batch is being worked on, the app registers device 4 again (another connection).
    const fresh = pushSeal(ROTATED).seal({ playerId: PETE, deviceId: ids[3] }, address(4));
    const lines: string[] = [];
    const result = await reseal(c, {
      purpose: "push_devices.sealed",
      apply: true,
      firstUseOfKey: true,
      env: ROTATED,
      log: (line) => lines.push(line),
      onStep: async (step) => {
        if (step === "read") await other.query(`UPDATE push_devices SET sealed = $2 WHERE id = $1`, [ids[3], fresh]);
      },
    });
    assert.deepEqual(result, { purpose: "push_devices.sealed", current: "p2", byKey: { p0: 1, p1: 5 }, todo: 6, done: 3, skipped: 1, problems: 2 });
    const now = Object.fromEntries((await c.query(`SELECT id, sealed FROM push_devices`)).rows.map((r) => [r.id, r.sealed]));
    assert.equal(now[ids[0]], gone, "left as it was");
    assert.equal(now[ids[1]], copied, "left as it was");
    assert.equal(now[ids[3]], fresh, "the app's own write was not overwritten");
    for (const id of [ids[2], ids[4], ids[5]]) assert.equal(sealedWith(now[id]), "p2");
    // The rows with a problem are named by their key, and nothing else about them.
    assert.ok(lines.some((l) => l.includes(`id=${ids[0]}`)) && lines.some((l) => l.includes(`id=${ids[1]}`)));
    await printsNoSecrets(lines, allAddresses(6));
    // A run over a table with problems left says so again, and still changes nothing.
    assert.deepEqual(await reseal(c, { purpose: "push_devices.sealed", apply: true, env: ROTATED }), { purpose: "push_devices.sealed", current: "p2", byKey: { p0: 1, p1: 1, p2: 4 }, todo: 2, done: 0, skipped: 0, problems: 2 });
  });

  test("the right key id with the wrong key bytes: refused before anything is written, and every row still opens with the true keys", async () => {
    // The servers run with p2:S,p1:O and have sealed three devices with p2 already.
    const OLD = `p1:${key()}`;
    const SERVERS = { PUSH_KEKS: `p2:${key()},${OLD}` };
    await devices(120, { PUSH_KEKS: OLD });
    await devices(3, SERVERS, 121);
    // The operator's shell: the same ids, but p2 is other bytes (a key made twice, a paste from the wrong place).
    const SHELL = { PUSH_KEKS: `p2:${key()},${OLD}` };
    const before = (await c.query(`SELECT * FROM push_devices ORDER BY id`)).rows;
    const lines: string[] = [];
    for (const firstUseOfKey of [false, true]) {
      await assert.rejects(
        reseal(c, { purpose: "push_devices.sealed", apply: true, firstUseOfKey, env: SHELL, log: (l) => lines.push(l) }),
        (err: unknown) => err instanceof KeyNotConfirmedError && /PUSH_KEKS/.test(err.message) && /"p2"/.test(err.message) && /differs from the one that sealed/.test(err.message) && /Nothing was written/.test(err.message),
        "the flag is for a key no row is on yet; it never lets a key through that existing rows contradict",
      );
    }
    assert.deepEqual((await other.query(`SELECT * FROM push_devices ORDER BY id`)).rows, before, "nothing was written");
    assert.equal((await openDevices(SERVERS)).length, 123, "every row still opens with the servers' keys");
    // A dry run with the same shell still only counts (it writes nothing, so it needs no proof).
    assert.deepEqual((await reseal(c, { purpose: "push_devices.sealed", apply: false, env: SHELL })).byKey, { p1: 120, p2: 3 });
    // The true keys: confirmed by the three rows already on p2, no flag needed.
    assert.deepEqual(await reseal(c, { purpose: "push_devices.sealed", apply: true, env: SERVERS, log: (l) => lines.push(l) }), { purpose: "push_devices.sealed", current: "p2", byKey: { p1: 120, p2: 3 }, todo: 120, done: 120, skipped: 0, problems: 0 });
    assert.equal((await openDevices({ PUSH_KEKS: SERVERS.PUSH_KEKS.split(",")[0] })).length, 123);
    await printsNoSecrets(lines);
  });

  test("no row on the new key yet: refused without --first-use-of-key (also for an empty table); with it the run goes ahead and says nothing confirmed the key", async () => {
    const K1 = { PUSH_KEKS: `p1:${key()}` };
    const ROTATED = { PUSH_KEKS: `p2:${key()},${K1.PUSH_KEKS}` };
    const refused = (err: unknown) => err instanceof KeyNotConfirmedError && /PUSH_KEKS/.test(err.message) && /no row is on key "p2"/.test(err.message) && /seal at least one row with the new key first/.test(err.message) && /--first-use-of-key/.test(err.message);
    // An empty table.
    await assert.rejects(reseal(c, { purpose: "push_devices.sealed", apply: true, env: ROTATED }), refused);
    await devices(5, K1);
    const before = (await c.query(`SELECT * FROM push_devices ORDER BY id`)).rows;
    await assert.rejects(reseal(c, { purpose: "push_devices.sealed", apply: true, env: ROTATED }), refused);
    assert.deepEqual((await other.query(`SELECT * FROM push_devices ORDER BY id`)).rows, before, "nothing was written");
    const lines: string[] = [];
    assert.deepEqual(await reseal(c, { purpose: "push_devices.sealed", apply: true, firstUseOfKey: true, env: ROTATED, log: (l) => lines.push(l) }), { purpose: "push_devices.sealed", current: "p2", byKey: { p1: 5 }, todo: 5, done: 5, skipped: 0, problems: 0 });
    assert.ok(lines.some((l) => /No row is on key p2/.test(l) && /--first-use-of-key/.test(l)), "it says that nothing in the database confirmed the key");
    assert.deepEqual(await openDevices({ PUSH_KEKS: ROTATED.PUSH_KEKS.split(",")[0] }), allAddresses(5));
    // A row of the current key that can't be opened (copied from another device) is no proof, but one good row is enough.
    const ids = (await c.query(`SELECT id FROM push_devices ORDER BY id`)).rows.map((r) => Number(r.id));
    await c.query(`UPDATE push_devices SET sealed = (SELECT sealed FROM push_devices WHERE id = $2) WHERE id = $1`, [ids[0], ids[1]]);
    assert.deepEqual(await reseal(c, { purpose: "push_devices.sealed", apply: true, env: ROTATED }), { purpose: "push_devices.sealed", current: "p2", byKey: { p2: 5 }, todo: 0, done: 0, skipped: 0, problems: 0 });
  });

  test("reseal.mjs: --apply with a key no row confirms exits 2 and writes nothing; --first-use-of-key lets the first rotation through", async () => {
    const K1 = { PUSH_KEKS: `p1:${key()}` };
    await devices(3, K1);
    const ROTATED = `p2:${key()},${K1.PUSH_KEKS}`;
    const web = fileURLToPath(new URL("..", import.meta.url));
    const run = (list: string, ...flags: string[]) =>
      spawnSync(process.execPath, ["scripts/crypto/reseal.mjs", "--purpose", "push_devices.sealed", "--apply", ...flags], {
        cwd: web,
        env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", POSTGRES_URL: urlFor(NAME), PUSH_KEKS: list },
        encoding: "utf8",
        timeout: 60_000,
      });
    const refused = run(ROTATED);
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /PUSH_KEKS: no row is on key "p2" yet/);
    assert.match(refused.stderr, /--first-use-of-key/);
    assert.equal(refused.stderr.trim().split("\n").length, 1, "one line, no stack");
    assert.deepEqual(await kids("push_devices", "sealed"), { p1: 3 });
    const first = run(ROTATED, "--first-use-of-key");
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(await kids("push_devices", "sealed"), { p2: 3 });
    // Afterwards: a shell whose p2 is other bytes is refused, with or without the flag.
    const differs = run(`p2:${key()},${K1.PUSH_KEKS}`, "--first-use-of-key");
    assert.equal(differs.status, 2, differs.stderr);
    assert.match(differs.stderr, /PUSH_KEKS: the key "p2" in this shell differs from the one that sealed the existing rows/);
    assert.deepEqual(await kids("push_devices", "sealed"), { p2: 3 });
    for (const out of [refused, first, differs]) assert.ok(!/[A-Za-z0-9_+/-]{40,}/.test(out.stdout + out.stderr), "nothing that looks like a key or sealed text");
  });

  test("what is refused before anything is read or written", async () => {
    const K1 = { PUSH_KEKS: `p1:${key()}` };
    await devices(2, K1);
    const before = (await c.query(`SELECT id, sealed FROM push_devices ORDER BY id`)).rows;
    await assert.rejects(reseal(c, { purpose: "no-such-purpose", apply: false, env: K1 }), /no-such-purpose/);
    // No key: a dry run still counts; --apply is refused.
    assert.deepEqual(await reseal(c, { purpose: "push_devices.sealed", apply: false, env: {} }), { purpose: "push_devices.sealed", current: null, byKey: { p1: 2 }, todo: 2, done: 0, skipped: 0, problems: 0 });
    await assert.rejects(reseal(c, { purpose: "push_devices.sealed", apply: true, env: {} }), SealError);
    // A malformed list is never "no key".
    await assert.rejects(reseal(c, { purpose: "push_devices.sealed", apply: false, env: { PUSH_KEKS: "p1:too-short" } }), /PUSH_KEKS.*32 bytes/);
    await assert.rejects(reseal(c, { purpose: "push_devices.sealed", apply: true, batch: 0, env: K1 }), /batch/);
    // The phone number's sealing needs both of its key lists; so does its index.
    await assert.rejects(reseal(c, { purpose: "players.phone_sealed", apply: true, env: { CONTACT_KEKS: `c1:${key()}` } }), SealError);
    await assert.rejects(reseal(c, { purpose: "contact-index", apply: true, env: { CONTACT_INDEX_KEYS: `i1:${key()}` } }), SealError);
    await assert.rejects(reseal(c, { purpose: "contact-index", apply: true, env: { CONTACT_KEKS: `c1:${key()}` } }), SealError);
    assert.deepEqual((await c.query(`SELECT id, sealed FROM push_devices ORDER BY id`)).rows, before);
  });

  describe("phone numbers", () => {
    const C1 = `c1:${key()}`;
    const I1 = `i1:${key()}`;
    const ENV = { CONTACT_KEKS: C1, CONTACT_INDEX_KEYS: I1 };
    let people: number[] = [];
    type Row = { id: number; phone_e164: string | null; phone_sealed: string | null; phone_index: string | null; phone_index_kid: string | null };
    const rows = async (): Promise<Row[]> => (await c.query(`SELECT id, phone_e164, phone_sealed, phone_index, phone_index_kid FROM players WHERE phone_sealed IS NOT NULL ORDER BY id`)).rows;
    const everyoneFound = async (env: Record<string, string>) => {
      for (const id of people) assert.equal(await findVerifiedByPhone(c, numberOf(id), { ...env, PII_READS: "sealed" }), id, `account ${id}`);
    };
    beforeEach(async () => {
      // Every live account has its own verified number, sealed and indexed with the first keys.
      people = (await c.query(`SELECT id FROM players WHERE deleted_at IS NULL ORDER BY id`)).rows.map((r) => Number(r.id));
      assert.ok(people.length >= 20);
      for (const id of people) assert.equal(await verifyPhone(c, id, numberOf(id), ENV), "ok");
    });

    test("rotating the sealing key: every number is re-sealed for its own account, and its index is brought to the current index key in the same write", async () => {
      const ROTATED = { CONTACT_KEKS: `c2:${key()},${C1}`, CONTACT_INDEX_KEYS: `i2:${key()},${I1}` };
      const lines: string[] = [];
      const n = people.length;
      const expected = { purpose: "players.phone_sealed", current: "c2", byKey: { c1: n }, todo: n };
      assert.deepEqual(await reseal(c, { purpose: "players.phone_sealed", apply: false, env: ROTATED, log: (l) => lines.push(l) }), { ...expected, done: 0, skipped: 0, problems: 0 });
      assert.deepEqual(await reseal(c, { purpose: "players.phone_sealed", apply: true, batch: 7, firstUseOfKey: true, env: ROTATED, log: (l) => lines.push(l) }), { ...expected, done: n, skipped: 0, problems: 0 });
      const NEW_ONLY = { CONTACT_KEKS: ROTATED.CONTACT_KEKS.split(",")[0], CONTACT_INDEX_KEYS: ROTATED.CONTACT_INDEX_KEYS.split(",")[0] };
      const sealing = phoneSealing(NEW_ONLY);
      for (const r of await rows()) {
        assert.equal(sealedWith(r.phone_sealed!), "c2");
        assert.equal(sealing.open(r.id, r.phone_sealed!), numberOf(r.id));
        assert.equal(r.phone_index_kid, "i2");
        assert.deepEqual(sealing.indexes(numberOf(r.id)), [r.phone_index]);
        assert.equal(r.phone_e164, numberOf(r.id), "the plain column is not the script's to change");
      }
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM players WHERE phone_verified_at IS NOT NULL`)).rows[0].n, n, "still verified");
      await everyoneFound(NEW_ONLY);
      await printsNoSecrets(lines);
    });

    test("rotating only the index key: re-index (stopped once, run again), drop the old key, and sign-in by phone still finds everyone", async () => {
      const ROTATED = { CONTACT_KEKS: C1, CONTACT_INDEX_KEYS: `i2:${key()},${I1}` };
      const n = people.length;
      const lines: string[] = [];
      const log = (line: string) => lines.push(line);
      const sealedBefore = (await rows()).map((r) => r.phone_sealed);
      // During the rotation a lookup matches either index.
      await everyoneFound(ROTATED);
      assert.deepEqual(await reseal(c, { purpose: "contact-index", apply: false, env: ROTATED, log }), { purpose: "contact-index", current: "i2", byKey: { i1: n }, todo: n, done: 0, skipped: 0, problems: 0 });
      await assert.rejects(
        reseal(c, {
          purpose: "contact-index",
          apply: true,
          batch: 10,
          firstUseOfKey: true,
          env: ROTATED,
          log,
          onStep: (step) => {
            if (step === "committed") throw new Error("stopped (test)");
          },
        }),
        /stopped \(test\)/,
      );
      assert.equal((await rows()).filter((r) => r.phone_index_kid === "i2").length, 10);
      await everyoneFound(ROTATED);
      assert.deepEqual(await reseal(c, { purpose: "contact-index", apply: true, batch: 10, env: ROTATED, log }), { purpose: "contact-index", current: "i2", byKey: { i1: n - 10, i2: 10 }, todo: n - 10, done: n - 10, skipped: 0, problems: 0 });
      assert.deepEqual(await reseal(c, { purpose: "contact-index", apply: true, env: ROTATED, log }), { purpose: "contact-index", current: "i2", byKey: { i2: n }, todo: 0, done: 0, skipped: 0, problems: 0 });

      // Drop i1: only the new index key is left.
      const NEW_ONLY = { CONTACT_KEKS: C1, CONTACT_INDEX_KEYS: ROTATED.CONTACT_INDEX_KEYS.split(",")[0] };
      await everyoneFound(NEW_ONLY);
      assert.equal(await findVerifiedByPhone(c, "+64219998888", { ...NEW_ONLY, PII_READS: "sealed" }), null);
      assert.deepEqual((await rows()).map((r) => r.phone_sealed), sealedBefore, "re-indexing doesn't re-seal");
      // One verified account per number still holds under the new index.
      assert.equal(await verifyPhone(c, people[1], numberOf(people[0]), NEW_ONLY), "taken");
      await printsNoSecrets(lines);
    });

    test("the index key: the right id with the wrong bytes is refused before any number is re-indexed or re-sealed; a first use needs the flag", async () => {
      const I2 = key();
      const SERVERS = { CONTACT_KEKS: C1, CONTACT_INDEX_KEYS: `i2:${I2},${I1}` };
      const refusedFirst = (err: unknown) => err instanceof KeyNotConfirmedError && /CONTACT_INDEX_KEYS/.test(err.message) && /no row is on key "i2"/.test(err.message) && /--first-use-of-key/.test(err.message);
      const before = await rows();
      // Nothing is on i2 yet.
      await assert.rejects(reseal(c, { purpose: "contact-index", apply: true, env: SERVERS }), refusedFirst);
      // The same holds when the sealing key is rotated: that write re-indexes too, so both of its keys need a row.
      const BOTH = { CONTACT_KEKS: `c2:${key()},${C1}`, CONTACT_INDEX_KEYS: SERVERS.CONTACT_INDEX_KEYS };
      await assert.rejects(reseal(c, { purpose: "players.phone_sealed", apply: true, env: BOTH }), (err: unknown) => err instanceof KeyNotConfirmedError && /CONTACT_KEKS/.test(err.message) && /no row is on key "c2"/.test(err.message));
      assert.deepEqual(await rows(), before, "nothing was written");

      // A server verifies one person's number again: that row is now indexed with the servers' i2.
      assert.equal(await verifyPhone(c, people[0], numberOf(people[0]), SERVERS), "ok");
      const after = await rows();
      // The operator's shell has i2 with other bytes.
      const SHELL = { CONTACT_KEKS: C1, CONTACT_INDEX_KEYS: `i2:${key()},${I1}` };
      const differs = (err: unknown) => err instanceof KeyNotConfirmedError && /CONTACT_INDEX_KEYS/.test(err.message) && /"i2"/.test(err.message) && /differs from the one that indexed/.test(err.message);
      for (const firstUseOfKey of [false, true]) {
        await assert.rejects(reseal(c, { purpose: "contact-index", apply: true, firstUseOfKey, env: SHELL }), differs);
        // Re-sealing would write the index as well: refused for the same reason, though its sealing key is right.
        await assert.rejects(reseal(c, { purpose: "players.phone_sealed", apply: true, firstUseOfKey, env: SHELL }), differs);
      }
      assert.deepEqual(await rows(), after, "nothing was written");
      await everyoneFound(SERVERS);

      // The true keys, no flag: confirmed by the one row a server indexed.
      const n = people.length;
      assert.deepEqual(await reseal(c, { purpose: "contact-index", apply: true, env: SERVERS }), { purpose: "contact-index", current: "i2", byKey: { i1: n - 1, i2: 1 }, todo: n - 1, done: n - 1, skipped: 0, problems: 0 });
      await everyoneFound({ CONTACT_KEKS: C1, CONTACT_INDEX_KEYS: `i2:${I2}` });
    });

    test("the backfill: keys that differ from the ones existing rows were sealed or indexed with are refused before anything is written", async () => {
      // Two accounts hold a number from before the keys existed: plain only.
      const [A, B] = people;
      await c.query(`UPDATE players SET phone_sealed = NULL, phone_index = NULL, phone_index_kid = NULL WHERE id IN ($1, $2)`, [A, B]);
      const before = (await c.query(`SELECT id, phone_e164, phone_sealed, phone_index, phone_index_kid FROM players ORDER BY id`)).rows;
      const unchanged = async () => assert.deepEqual((await other.query(`SELECT id, phone_e164, phone_sealed, phone_index, phone_index_kid FROM players ORDER BY id`)).rows, before, "nothing was written");
      const lines: string[] = [];
      const log = (l: string) => lines.push(l);
      // The sealing key's bytes differ.
      await assert.rejects(backfillPhones(c, { apply: true, env: { CONTACT_KEKS: `c1:${key()}`, CONTACT_INDEX_KEYS: I1 }, log }), (err: unknown) => err instanceof KeyNotConfirmedError && /CONTACT_KEKS/.test(err.message) && /"c1"/.test(err.message) && /differs from the one that sealed/.test(err.message));
      await unchanged();
      // The index key's bytes differ.
      await assert.rejects(backfillPhones(c, { apply: true, env: { CONTACT_KEKS: C1, CONTACT_INDEX_KEYS: `i1:${key()}` }, log }), (err: unknown) => err instanceof KeyNotConfirmedError && /CONTACT_INDEX_KEYS/.test(err.message) && /"i1"/.test(err.message) && /differs from the one that indexed/.test(err.message));
      await unchanged();
      // A dry run needs no proof: it writes nothing.
      assert.deepEqual(await backfillPhones(c, { apply: false, env: { CONTACT_KEKS: `c1:${key()}`, CONTACT_INDEX_KEYS: I1 }, log }), { pending: 2, sealed: 0, failed: 0 });
      // The true keys: confirmed by the rows already sealed, and it says nothing about unconfirmed keys.
      assert.deepEqual(await backfillPhones(c, { apply: true, env: ENV, log }), { pending: 2, sealed: 2, failed: 0 });
      assert.ok(!lines.some((l) => /could confirm/.test(l)));
      await everyoneFound(ENV);

      // The very first backfill (nothing sealed at all) goes ahead, and says no row could confirm the keys.
      await c.query(`UPDATE players SET phone_sealed = NULL, phone_index = NULL, phone_index_kid = NULL`);
      const first: string[] = [];
      assert.deepEqual(await backfillPhones(c, { apply: true, env: ENV, log: (l) => first.push(l) }), { pending: people.length, sealed: people.length, failed: 0 });
      assert.ok(first.some((l) => /No existing row could confirm CONTACT_KEKS and CONTACT_INDEX_KEYS/.test(l) && /verify one sign-in by phone/.test(l)), first.join(" | "));
      await everyoneFound(ENV);
      await printsNoSecrets([...lines, ...first]);
    });

    test("a sealed number whose plain column is empty or different is counted as a problem and left alone, never guessed at", async () => {
      // Neither can happen through the app (the trigger clears the sealed copy); made here behind the trigger's back.
      const [EMPTY, DIFFERENT] = people;
      await c.query(`ALTER TABLE players DISABLE TRIGGER players_phone_sealed_follows_plain`);
      try {
        await c.query(`UPDATE players SET phone = NULL, phone_e164 = NULL WHERE id = $1`, [EMPTY]);
        await c.query(`UPDATE players SET phone_e164 = '+64219998888' WHERE id = $1`, [DIFFERENT]);
      } finally {
        await c.query(`ALTER TABLE players ENABLE TRIGGER players_phone_sealed_follows_plain`);
      }
      const before = (await rows()).filter((r) => r.id === EMPTY || r.id === DIFFERENT);
      const ROTATED = { CONTACT_KEKS: `c2:${key()},${C1}`, CONTACT_INDEX_KEYS: `i2:${key()},${I1}` };
      const n = people.length;
      for (const [purpose, current, old] of [["players.phone_sealed", "c2", "c1"], ["contact-index", "i2", "i1"]] as const) {
        const lines: string[] = [];
        // contact-index runs second: the first run already brought the other rows to i2, and they confirm its key.
        const result = await reseal(c, { purpose, apply: true, firstUseOfKey: purpose === "players.phone_sealed", env: ROTATED, log: (l) => lines.push(l) });
        const byKey = purpose === "contact-index" ? { [old]: 2, [current]: n - 2 } : { [old]: n };
        assert.deepEqual(result, { purpose, current, byKey, todo: purpose === "contact-index" ? 2 : n, done: purpose === "contact-index" ? 0 : n - 2, skipped: 0, problems: 2 });
        assert.deepEqual((await rows()).filter((r) => r.id === EMPTY || r.id === DIFFERENT), before, "left exactly as they were");
        assert.ok(lines.some((l) => l.includes(`id=${EMPTY}`)) && lines.some((l) => l.includes(`id=${DIFFERENT}`)), "named by account id");
        await printsNoSecrets(lines);
      }
    });
  });
});

// The command line itself, with a database that can't be reached. No Postgres needed.
test("reseal.mjs: a database it can't connect to is one line and exit 2 (never 1: that means rows were left with a problem), without the connection string", () => {
  const web = fileURLToPath(new URL("..", import.meta.url));
  // Port 1 on this machine: refused at once. The login is made up.
  const url = "postgres://reseal_user:reseal-made-up-password@127.0.0.1:1/reseal_db";
  const kek = randomBytes(32).toString("base64");
  const run = spawnSync(process.execPath, ["scripts/crypto/reseal.mjs", "--purpose", "push_devices.sealed"], {
    cwd: web,
    // NODE_NO_WARNINGS: Node's own note about loading a .ts file isn't the script's output.
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", POSTGRES_URL: url, PUSH_KEKS: `p1:${kek}` },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(run.status, 2, run.stderr);
  const said = run.stderr.trim();
  assert.equal(said.split("\n").length, 1, `one line, no stack: ${said}`);
  assert.match(said, /Could not connect to the database/);
  for (const secret of ["reseal_user", "reseal-made-up-password", "reseal_db", "127.0.0.1", kek]) assert.ok(!(run.stdout + run.stderr).includes(secret), `"${secret}" is not printed`);
});

test("backfill-phone.mjs: a database it can't connect to is one line and exit 2, without the connection string", () => {
  const web = fileURLToPath(new URL("..", import.meta.url));
  const url = "postgres://backfill_user:backfill-made-up-password@127.0.0.1:1/backfill_db";
  const keys = [randomBytes(32).toString("base64"), randomBytes(32).toString("base64")];
  const run = spawnSync(process.execPath, ["scripts/pii/backfill-phone.mjs"], {
    cwd: web,
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", POSTGRES_URL: url, CONTACT_KEKS: `c1:${keys[0]}`, CONTACT_INDEX_KEYS: `i1:${keys[1]}` },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(run.status, 2, run.stderr);
  const said = run.stderr.trim();
  assert.equal(said.split("\n").length, 1, `one line, no stack: ${said}`);
  assert.match(said, /Could not connect to the database/);
  for (const secret of ["backfill_user", "backfill-made-up-password", "backfill_db", "127.0.0.1", ...keys]) assert.ok(!(run.stdout + run.stderr).includes(secret), `"${secret}" is not printed`);
});
