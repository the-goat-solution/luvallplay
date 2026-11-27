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
import pg from "pg";
import { createSeal, parseKeks, SealError, sealedWith } from "@luvallplay/crypto";
import { migrate } from "../scripts/db/migrate.mjs";
import { PURPOSES, RESEAL_PURPOSES, reseal } from "../lib/crypto-purposes.ts";
import { pushSeal } from "../lib/push/seal.ts";
import { addressesFor, setPrefs } from "../lib/push/devices.ts";
import { addChild } from "../lib/juniors/family.ts";
import { juniorsVault, readMedicalNotesAsGuardian, setMedicalNotes } from "../lib/juniors/care.ts";
import { findVerifiedByPhone, phoneSealing, verifyPhone } from "../lib/pii/contact.ts";

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
  const devices = async (count: number, env: { PUSH_KEKS: string }) => {
    const seal = pushSeal(env);
    for (let n = 1; n <= count; n++) {
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

    // Stopped after the first batch of 100 (an injected failure: a lost connection, a closed laptop).
    await assert.rejects(
      reseal(c, {
        purpose: "push_devices.sealed",
        apply: true,
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
      assert.deepEqual(await reseal(c, { purpose: "junior_medical_notes.sealed", apply: true, batch: 1, env: ROTATED, log }), { purpose: "junior_medical_notes.sealed", current: "j2", byKey: { j1: 3 }, todo: 3, done: 3, skipped: 0, problems: 0 });
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
      assert.deepEqual(await reseal(c, { purpose: "players.phone_sealed", apply: true, batch: 7, env: ROTATED, log: (l) => lines.push(l) }), { ...expected, done: n, skipped: 0, problems: 0 });
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
        const result = await reseal(c, { purpose, apply: true, env: ROTATED, log: (l) => lines.push(l) });
        // contact-index runs second: the first run already brought the other rows to i2.
        const byKey = purpose === "contact-index" ? { [old]: 2, [current]: n - 2 } : { [old]: n };
        assert.deepEqual(result, { purpose, current, byKey, todo: purpose === "contact-index" ? 2 : n, done: purpose === "contact-index" ? 0 : n - 2, skipped: 0, problems: 2 });
        assert.deepEqual((await rows()).filter((r) => r.id === EMPTY || r.id === DIFFERENT), before, "left exactly as they were");
        assert.ok(lines.some((l) => l.includes(`id=${EMPTY}`)) && lines.some((l) => l.includes(`id=${DIFFERENT}`)), "named by account id");
        await printsNoSecrets(lines);
      }
    });
  });
});
