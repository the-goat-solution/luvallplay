// Players' phone numbers, sealed beside the plain column (lib/pii/contact.ts;
// migration players_contact_sealed).
//
// A number is written three ways from now on: the plain column (until it is
// removed), sealed for that one person, and as a keyed index so "who has this
// number?" still works once only the sealed copy is left. These tests run the
// real functions (lib/player-db.ts, lib/player-merge.ts, the backfill) on a
// real Postgres, and the database's own guards (the trigger, the unique
// index, the format check) directly in SQL.
//
// Made-up numbers and throwaway keys only. Needs Postgres
// (DATA_GUARD_TEST_URL's server); CI sets DATA_GUARD_REQUIRE_DB=1.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { SealError } from "@luvallplay/crypto";
import { migrate } from "../scripts/db/migrate.mjs";
import { backfillPhones, findVerifiedByPhone, phoneSealing, piiReads, sealStoredPhone, sealedColumnsInUse, sealedPhoneCleared, sealedPhoneUpdate, verifyPhone } from "../lib/pii/contact.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `pii_contact_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const key = () => randomBytes(32).toString("base64");
const ENV = { CONTACT_KEKS: `c1:${key()}`, CONTACT_INDEX_KEYS: `i1:${key()}` };
const SEALED_READS = { ...ENV, PII_READS: "sealed" };

// One number, written three ways (Review Focus 3), and another.
const NUMBER = "+64211234567";
const SPELLINGS = ["021 123 4567", "+64 21 123 4567", "+64211234567"];
const OTHER = "+64219998888";

test("sealing needs both key lists; a malformed one throws, an unset one means 'not yet'", () => {
  assert.equal(phoneSealing({}).available(), false);
  assert.equal(phoneSealing({ CONTACT_KEKS: ENV.CONTACT_KEKS }).available(), false, "no index key: a sealed number couldn't be found again");
  assert.equal(phoneSealing({ CONTACT_INDEX_KEYS: ENV.CONTACT_INDEX_KEYS }).available(), false);
  assert.equal(phoneSealing(ENV).available(), true);
  assert.throws(() => phoneSealing({ ...ENV, CONTACT_KEKS: "c1:too-short" }).available(), /CONTACT_KEKS.*32 bytes/);
  assert.throws(() => phoneSealing({ ...ENV, CONTACT_INDEX_KEYS: "i1:too-short" }).available(), /CONTACT_INDEX_KEYS.*32 bytes/);
  assert.throws(() => phoneSealing({}).seal(3, NUMBER), SealError);
});

test("a sealed number opens only for the same person, and shows nothing of the number", () => {
  const sealing = phoneSealing(ENV);
  const a = sealing.seal(3, NUMBER);
  assert.match(a.sealed, /^v1\.c1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(a.indexKid, "i1");
  assert.match(a.index, /^[A-Za-z0-9_-]{43}$/);
  for (const text of [a.sealed, a.index, ...a.sealed.split(".").slice(2).map((p) => Buffer.from(p, "base64url").toString("latin1"))]) {
    assert.ok(!text.includes("211234567") && !text.includes("64211234567"), "no digits of the number");
  }
  assert.notEqual(sealing.seal(3, NUMBER).sealed, a.sealed, "sealed afresh each time");
  assert.equal(sealing.seal(4, NUMBER).index, a.index, "the same number has the same index whoever holds it");
  assert.notEqual(sealing.seal(3, OTHER).index, a.index);
  assert.equal(sealing.open(3, a.sealed), NUMBER);
  assert.throws(() => sealing.open(4, a.sealed), /can't be opened/);
  assert.deepEqual(sealing.indexes(NUMBER), [a.index]);
  assert.deepEqual(phoneSealing({}).indexes(NUMBER), [], "no key: a lookup finds nothing");
});

test("a key rotation: new sealings use the newest keys, old ones still open, lookups match either index", () => {
  const before = phoneSealing(ENV).seal(3, NUMBER);
  const rotated = phoneSealing({ CONTACT_KEKS: `c2:${key()},${ENV.CONTACT_KEKS}`, CONTACT_INDEX_KEYS: `i2:${key()},${ENV.CONTACT_INDEX_KEYS}` });
  const now = rotated.seal(3, NUMBER);
  assert.match(now.sealed, /^v1\.c2\./);
  assert.equal(now.indexKid, "i2");
  assert.notEqual(now.index, before.index);
  assert.equal(rotated.open(3, before.sealed), NUMBER);
  assert.deepEqual(rotated.indexes(NUMBER), [now.index, before.index]);
});

test("PII_READS is plain unless it says sealed; anything else is refused", () => {
  assert.equal(piiReads({}), "plain");
  assert.equal(piiReads({ PII_READS: "" }), "plain");
  assert.equal(piiReads({ PII_READS: " plain " }), "plain");
  assert.equal(piiReads({ PII_READS: "sealed" }), "sealed");
  assert.throws(() => piiReads({ PII_READS: "Sealed!" }), /PII_READS/);
});

test("with no key set, a write's SQL names none of the new columns (the app runs as before on a database without them)", () => {
  assert.equal(sealedColumnsInUse({}), false);
  assert.equal(sealedColumnsInUse({ CONTACT_KEKS: " ", CONTACT_INDEX_KEYS: "", PII_READS: "plain" }), false);
  assert.equal(sealedColumnsInUse({ CONTACT_KEKS: ENV.CONTACT_KEKS }), true);
  assert.equal(sealedColumnsInUse({ CONTACT_INDEX_KEYS: "malformed" }), true);
  assert.equal(sealedColumnsInUse({ PII_READS: "sealed" }), true);
  assert.deepEqual(sealedPhoneUpdate(3, NUMBER, { e164Param: "$2", firstParam: 3 }, {}), { set: "", params: [] });
  assert.deepEqual(sealedPhoneUpdate(3, NUMBER, { e164Param: "$2", firstParam: 3 }, { CONTACT_KEKS: ENV.CONTACT_KEKS }), { set: "", params: [] }, "half a setting seals nothing");
  assert.equal(sealedPhoneCleared({}), "");
  assert.match(sealedPhoneCleared(ENV), /^, phone_sealed = NULL, phone_index = NULL, phone_index_kid = NULL$/);
  const on = sealedPhoneUpdate(3, NUMBER, { e164Param: "$2", firstParam: 3 }, ENV);
  assert.match(on.set, /^,\s+phone_sealed = CASE WHEN phone_e164 IS DISTINCT FROM \$2 OR \$3::text IS NOT NULL THEN \$3 ELSE phone_sealed END,\s+phone_index = .* THEN \$4 .*,\s+phone_index_kid = .* THEN \$5 /s);
  assert.equal(on.params.length, 3);
  assert.equal(phoneSealing(ENV).open(3, on.params[0]!), NUMBER);
  assert.deepEqual(sealedPhoneUpdate(3, null, { e164Param: "$2", firstParam: 3 }, ENV).params, [null, null, null], "no number, nothing sealed");
  assert.throws(() => sealedPhoneUpdate(3, NUMBER, { e164Param: "$2", firstParam: 3 }, { ...ENV, CONTACT_KEKS: "c1:too-short" }), /CONTACT_KEKS/);
});

describe("players' phone numbers, sealed and indexed", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let players: typeof import("../lib/player-db.ts");
  let merge: typeof import("../lib/player-merge.ts");
  let database: typeof import("../lib/database.ts");
  const KEYS = ["DATABASE_DRIVER", "POSTGRES_URL", "CONTACT_KEKS", "CONTACT_INDEX_KEYS", "PII_READS"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  // Seed accounts: 3 Mia, 4 Pete, 5 Quinn, 25 a deleted account.
  const MIA = 3;
  const PETE = 4;
  const QUINN = 5;
  type Row = { id: number; phone: string | null; phone_e164: string | null; verified: boolean; phone_sealed: string | null; phone_index: string | null; phone_index_kid: string | null; deleted: boolean };
  const row = async (id: number): Promise<Row> =>
    (await c.query(`SELECT id, phone, phone_e164, phone_verified_at IS NOT NULL AS verified, phone_sealed, phone_index, phone_index_kid, deleted_at IS NOT NULL AS deleted FROM players WHERE id = $1`, [id])).rows[0];
  const nothingSealed = (r: Row, why: string) => assert.deepEqual([r.phone_sealed, r.phone_index, r.phone_index_kid], [null, null, null], why);
  const sealedFor = (r: Row, e164: string, env = ENV) => {
    assert.ok(r.phone_sealed && r.phone_index && r.phone_index_kid, "sealed, indexed, and the index key named");
    assert.equal(phoneSealing(env).open(r.id, r.phone_sealed), e164);
    assert.ok(phoneSealing(env).indexes(e164).includes(r.phone_index));
  };
  const profile = (phone: string | null) => ({ firstName: "Test", lastName: "Person", displayName: null, phone, lang: "en" as const });
  /** Runs with other settings in process.env (what lib/player-db.ts reads), then puts them back. */
  const withEnv = async <T>(env: Record<string, string | undefined>, work: () => Promise<T>): Promise<T> => {
    const was = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    const set = (values: Record<string, string | undefined>) => {
      for (const [k, v] of Object.entries(values)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    };
    set(env);
    try {
      return await work();
    } finally {
      set(was);
    }
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
    await c.query(SEED);
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    process.env.CONTACT_KEKS = ENV.CONTACT_KEKS;
    process.env.CONTACT_INDEX_KEYS = ENV.CONTACT_INDEX_KEYS;
    delete process.env.PII_READS;
    database = await import("../lib/database.ts");
    players = await import("../lib/player-db.ts");
    merge = await import("../lib/player-merge.ts");
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
  beforeEach(async () => {
    // Nobody has a number; the accounts these tests delete or merge are back.
    await c.query(`UPDATE players SET phone = NULL, phone_e164 = NULL, phone_verified_at = NULL, phone_sealed = NULL, phone_index = NULL, phone_index_kid = NULL`);
    await c.query(`UPDATE players SET deleted_at = NULL, email = 'player' || id || '@golden.test' WHERE id IN ($1, $2)`, [PETE, QUINN]);
  });

  test("writing a number fills the plain column, the sealed one and the index", async () => {
    await players.updatePlayerProfile(MIA, profile("021 123 4567"));
    const r = await row(MIA);
    assert.equal(r.phone, "021 123 4567");
    assert.equal(r.phone_e164, NUMBER);
    sealedFor(r, NUMBER);
    assert.equal(r.phone_index_kid, "i1");
    assert.ok(!r.phone_sealed!.includes("211234567") && !r.phone_index!.includes("211234567"), "no digits of the number in either");

    // Saving the profile again with the same number keeps it sealed (and verified).
    await players.markPhoneVerified(MIA, NUMBER);
    await players.updatePlayerProfile(MIA, profile("+64 21 123 4567"));
    const again = await row(MIA);
    assert.equal(again.verified, true);
    sealedFor(again, NUMBER);

    // A new number is sealed anew; removing the number removes all of it.
    await players.updatePlayerProfile(MIA, profile("021 999 8888"));
    const changed = await row(MIA);
    assert.equal(changed.verified, false, "a new number hasn't been proven");
    sealedFor(changed, OTHER);
    assert.notEqual(changed.phone_index, r.phone_index);
    await players.updatePlayerProfile(MIA, profile(null));
    nothingSealed(await row(MIA), "no number, nothing sealed");
  });

  test("a new account, and an account given a number it lacked, are sealed too", async () => {
    const { player, created } = await players.ensurePlayerForEmail("new.person@golden.test", { via: "signup", details: { firstName: "New", lastName: "Person", phone: "021 123 4567" } });
    assert.equal(created, true);
    sealedFor(await row(player.id), NUMBER);
    // Fill gaps only: a player with no number takes the one given…
    await players.ensurePlayerForEmail("mia.member@golden.test", { via: "signup", details: { phone: "021 999 8888" } });
    sealedFor(await row(MIA), OTHER);
    // …and a player who has one keeps it, sealed as it was.
    const before = await row(MIA);
    await players.ensurePlayerForEmail("mia.member@golden.test", { via: "signup", details: { phone: "021 123 4567" } });
    assert.deepEqual(await row(MIA), before);
    await c.query(`DELETE FROM club_members WHERE user_id = $1`, [player.id]);
    await c.query(`DELETE FROM players WHERE id = $1`, [player.id]);
  });

  test("a new account whose number can't be sealed just then is still made a member of its club; the backfill seals it later", async () => {
    // The database refuses the sealing (it stands for any failure after the account's row exists).
    await c.query(`CREATE FUNCTION refuse_sealing() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phone_sealed IS NOT NULL THEN RAISE EXCEPTION 'sealing refused (test)'; END IF; RETURN NEW; END $$`);
    await c.query(`CREATE TRIGGER refuse_sealing BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION refuse_sealing()`);
    const logged: string[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    let id = 0;
    try {
      const { player, created } = await players.ensurePlayerForEmail("seal.fails@golden.test", { via: "signup", details: { firstName: "Seal", lastName: "Fails", phone: "021 123 4567" } });
      id = player.id;
      assert.equal(created, true);
      const r = await row(id);
      assert.equal(r.phone_e164, NUMBER, "the plain number is stored as before");
      nothingSealed(r, "the sealing failed");
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM club_members WHERE user_id = $1`, [id])).rows[0].n, 1, "a member of the club all the same");
      // Trying again finds the account (it doesn't join anyone to a club), so the first call had to.
      assert.equal((await players.ensurePlayerForEmail("seal.fails@golden.test", { via: "signup" })).created, false);
      // What was logged names the account and nothing of the number.
      assert.equal(logged.length, 1);
      assert.ok(logged[0].includes(String(id)));
      assert.ok(!/\d{7,}/.test(logged[0]) && !logged[0].includes("sealing refused"), "the account's id only");
    } finally {
      console.error = error;
      await c.query(`DROP TRIGGER refuse_sealing ON players`);
      await c.query(`DROP FUNCTION refuse_sealing()`);
    }
    assert.deepEqual(await backfillPhones(c, { apply: true, env: ENV }), { pending: 1, sealed: 1, failed: 0 });
    sealedFor(await row(id), NUMBER);
    await c.query(`DELETE FROM club_members WHERE user_id = $1`, [id]);
    await c.query(`DELETE FROM players WHERE id = $1`, [id]);
  });

  test("with no CONTACT_KEKS a write stores the plain number and leaves the sealed columns empty (as before)", async () => {
    await withEnv({ CONTACT_KEKS: undefined }, async () => {
      await players.updatePlayerProfile(MIA, profile("021 123 4567"));
      assert.equal(await players.markPhoneVerified(MIA, NUMBER), "ok");
      const { player } = await players.ensurePlayerForEmail("no.keys@golden.test", { via: "signup", details: { phone: "021 999 8888" } });
      const r = await row(MIA);
      assert.equal(r.phone_e164, NUMBER);
      assert.equal(r.verified, true);
      nothingSealed(r, "no key, nothing sealed");
      const made = await row(player.id);
      assert.equal(made.phone_e164, OTHER);
      nothingSealed(made, "no key, nothing sealed");
      assert.equal((await players.getPlayerByVerifiedPhone(NUMBER))?.id, MIA, "sign-in by phone works as it did");
      await c.query(`DELETE FROM club_members WHERE user_id = $1`, [player.id]);
      await c.query(`DELETE FROM players WHERE id = $1`, [player.id]);
    });
    // And a number sealed earlier isn't unsealed by a save made while the key is away.
    await players.updatePlayerProfile(PETE, profile("021 999 8888"));
    await withEnv({ CONTACT_KEKS: undefined }, () => players.updatePlayerProfile(PETE, profile("021 999 8888")));
    sealedFor(await row(PETE), OTHER);
  });

  test("before the migration reaches a database (no such columns) and with no key set, every writer works as it did", async () => {
    // The same database with the three columns and the trigger out of sight:
    // what production looks like between this code's deploy and its migration.
    const [KEPT, DUPE] = [18, 19];
    const hide = async (hidden: boolean) => {
      await c.query(`ALTER TABLE players ${hidden ? "DISABLE" : "ENABLE"} TRIGGER players_phone_sealed_follows_plain`);
      for (const column of ["phone_sealed", "phone_index", "phone_index_kid"]) {
        await c.query(hidden ? `ALTER TABLE players RENAME COLUMN ${column} TO hidden_${column}` : `ALTER TABLE players RENAME COLUMN hidden_${column} TO ${column}`);
      }
    };
    await hide(true);
    try {
      await withEnv({ CONTACT_KEKS: undefined, CONTACT_INDEX_KEYS: undefined, PII_READS: undefined }, async () => {
        await players.updatePlayerProfile(MIA, profile("021 123 4567"));
        assert.equal(await players.markPhoneVerified(MIA, NUMBER), "ok");
        assert.equal(await players.markPhoneVerified(PETE, NUMBER), "taken");
        assert.equal((await players.getPlayerByVerifiedPhone(NUMBER))?.id, MIA);
        const { player, created } = await players.ensurePlayerForEmail("before.migration@golden.test", { via: "signup", details: { phone: "021 999 8888" } });
        assert.equal(created, true);
        assert.equal(player.phoneE164, OTHER);
        await players.ensurePlayerForEmail("player4@golden.test", { via: "signup", details: { phone: "021 999 8888" } });
        await players.deletePlayerAccount(PETE);
        await players.markPhoneVerified(DUPE, "+64210000019");
        await merge.mergeMembers(`player${KEPT}@golden.test`, `player${DUPE}@golden.test`, true);
        const { rows } = await c.query(`SELECT id, phone_e164, deleted_at IS NOT NULL AS deleted FROM players WHERE id = ANY($1) ORDER BY id`, [[MIA, PETE, KEPT, DUPE]]);
        assert.deepEqual(rows, [
          { id: MIA, phone_e164: NUMBER, deleted: false },
          { id: PETE, phone_e164: null, deleted: true },
          { id: KEPT, phone_e164: "+64210000019", deleted: false },
          { id: DUPE, phone_e164: null, deleted: true },
        ]);
        await c.query(`DELETE FROM club_members WHERE user_id = $1`, [player.id]);
        await c.query(`DELETE FROM players WHERE id = $1`, [player.id]);
      });
    } finally {
      await hide(false);
    }
  });

  test("the person is found from three spellings of the number, reading plain or sealed", async () => {
    await players.updatePlayerProfile(MIA, profile(SPELLINGS[0]));
    for (const env of [ENV, SEALED_READS]) {
      for (const spelling of SPELLINGS) assert.equal(await findVerifiedByPhone(c, spelling, env), null, "not verified yet");
    }
    assert.equal(await players.markPhoneVerified(MIA, NUMBER), "ok");
    for (const env of [ENV, { ...ENV, PII_READS: "plain" }, SEALED_READS]) {
      for (const spelling of SPELLINGS) assert.equal(await findVerifiedByPhone(c, spelling, env), MIA, `${env.PII_READS ?? "default"}: ${spelling}`);
      assert.equal(await findVerifiedByPhone(c, OTHER, env), null);
      assert.equal(await findVerifiedByPhone(c, "not a number", env), null);
    }
    // Reading sealed really does read the index: with the plain column blanked
    // behind the trigger's back (what the table looks like once it is dropped),
    // the person is still found, and only that way.
    await c.query(`ALTER TABLE players DISABLE TRIGGER players_phone_sealed_follows_plain`);
    try {
      await c.query(`UPDATE players SET phone = NULL, phone_e164 = NULL WHERE id = $1`, [MIA]);
    } finally {
      await c.query(`ALTER TABLE players ENABLE TRIGGER players_phone_sealed_follows_plain`);
    }
    assert.equal(await findVerifiedByPhone(c, SPELLINGS[0], SEALED_READS), MIA);
    assert.equal(await findVerifiedByPhone(c, SPELLINGS[0], ENV), null);
    // The app's own lookup follows the setting.
    assert.equal(await players.getPlayerByVerifiedPhone(NUMBER), null);
    assert.equal((await withEnv({ PII_READS: "sealed" }, () => players.getPlayerByVerifiedPhone(NUMBER)))?.id, MIA);
    // Reading sealed with no index key finds nobody (it never falls back to guessing).
    assert.equal(await findVerifiedByPhone(c, NUMBER, { PII_READS: "sealed" }), null);
  });

  test("two verified accounts can't share a number: the second is told it is taken", async () => {
    assert.equal(await players.markPhoneVerified(MIA, NUMBER), "ok");
    assert.equal(await players.markPhoneVerified(PETE, NUMBER), "taken");
    const pete = await row(PETE);
    assert.equal(pete.verified, false);
    assert.equal(pete.phone_e164, null, "nothing was written for the second");
    nothingSealed(pete, "nothing was written for the second");
    assert.equal(await players.markPhoneVerified(MIA, NUMBER), "ok", "verifying your own number again is fine");
    sealedFor(await row(MIA), NUMBER);
    // The database holds the same line on the index alone.
    const mia = await row(MIA);
    await c.query(`UPDATE players SET phone_e164 = $2, phone_verified_at = NOW() WHERE id = $1`, [PETE, OTHER]);
    await assert.rejects(c.query(`UPDATE players SET phone_sealed = $2, phone_index = $3, phone_index_kid = 'i1' WHERE id = $1`, [PETE, phoneSealing(ENV).seal(PETE, NUMBER).sealed, mia.phone_index]), /players_phone_index_verified/);
    // An unverified account may hold the same number (as with the plain column).
    await players.updatePlayerProfile(QUINN, profile("021 123 4567"));
    assert.equal((await row(QUINN)).phone_index, mia.phone_index);
    assert.equal(await findVerifiedByPhone(c, NUMBER, SEALED_READS), MIA, "and the verified one is who is found");
  });

  test("during a key rotation 'taken' is checked against every index, not just the newest", async () => {
    assert.equal(await verifyPhone(c, MIA, NUMBER, ENV), "ok");
    // What the table looks like once the plain column is gone: only the sealed copy and its (old-key) index.
    await c.query(`ALTER TABLE players DISABLE TRIGGER players_phone_sealed_follows_plain`);
    try {
      await c.query(`UPDATE players SET phone = NULL, phone_e164 = NULL WHERE id = $1`, [MIA]);
    } finally {
      await c.query(`ALTER TABLE players ENABLE TRIGGER players_phone_sealed_follows_plain`);
    }
    const rotated = { CONTACT_KEKS: `c2:${key()},${ENV.CONTACT_KEKS}`, CONTACT_INDEX_KEYS: `i2:${key()},${ENV.CONTACT_INDEX_KEYS}` };
    assert.notEqual(phoneSealing(rotated).seal(PETE, NUMBER).index, (await row(MIA)).phone_index, "the unique index alone wouldn't see it");
    assert.equal(await verifyPhone(c, PETE, NUMBER, rotated), "taken");
    assert.equal((await row(PETE)).verified, false);
    assert.equal(await findVerifiedByPhone(c, NUMBER, { ...rotated, PII_READS: "sealed" }), MIA, "found under the old index");
    assert.equal(await verifyPhone(c, PETE, OTHER, rotated), "ok");
    assert.equal((await row(PETE)).phone_index_kid, "i2");
    sealedFor(await row(PETE), OTHER, rotated);
  });

  test("deleting an account leaves nothing sealed behind, and it is no longer found", async () => {
    await players.updatePlayerProfile(PETE, profile("021 123 4567"));
    await players.markPhoneVerified(PETE, NUMBER);
    sealedFor(await row(PETE), NUMBER);
    await players.deletePlayerAccount(PETE);
    const r = await row(PETE);
    assert.equal(r.deleted, true);
    assert.deepEqual([r.phone, r.phone_e164, r.verified], [null, null, false]);
    nothingSealed(r, "after deletePlayerAccount");
    for (const env of [ENV, SEALED_READS]) assert.equal(await findVerifiedByPhone(c, NUMBER, env), null);
    // The number is free for someone else.
    assert.equal(await players.markPhoneVerified(QUINN, NUMBER), "ok");
  });

  test("a deleted account isn't found even if its row still held a number", async () => {
    await players.markPhoneVerified(PETE, NUMBER);
    // Not how the app deletes (it clears the number): the lookup's own filter.
    await c.query(`UPDATE players SET deleted_at = NOW() WHERE id = $1`, [PETE]);
    for (const env of [ENV, SEALED_READS]) assert.equal(await findVerifiedByPhone(c, NUMBER, env), null, env === ENV ? "plain" : "sealed");
    assert.equal(await players.getPlayerByVerifiedPhone(NUMBER), null);
    assert.equal(await verifyPhone(c, QUINN, NUMBER, ENV), "ok", "a deleted account doesn't hold a number");
  });

  test("the trigger: whoever clears or changes the plain number, the sealed copy and index go with it", async () => {
    await players.markPhoneVerified(MIA, NUMBER);
    await players.markPhoneVerified(PETE, OTHER);
    // A writer this change never touched: plain SQL.
    await c.query(`UPDATE players SET phone_e164 = NULL WHERE id = $1`, [MIA]);
    nothingSealed(await row(MIA), "cleared by a raw UPDATE");
    await c.query(`UPDATE players SET phone_e164 = '+64210000001' WHERE id = $1`, [PETE]);
    nothingSealed(await row(PETE), "changed by a raw UPDATE: the old sealed copy would be of another number");
    // An update of anything else leaves it alone.
    await players.markPhoneVerified(QUINN, NUMBER);
    const before = await row(QUINN);
    await c.query(`UPDATE players SET first_name = 'Q', phone_e164 = phone_e164 WHERE id = $1`, [QUINN]);
    assert.deepEqual(await row(QUINN), before);
    // A statement that changes both keeps what it wrote.
    const next = phoneSealing(ENV).seal(QUINN, OTHER);
    await c.query(`UPDATE players SET phone_e164 = $2, phone_sealed = $3, phone_index = $4, phone_index_kid = $5 WHERE id = $1`, [QUINN, OTHER, next.sealed, next.index, next.indexKid]);
    sealedFor(await row(QUINN), OTHER);
  });

  test("the three sealed columns are set and cleared together: an index can't be left without its sealed number, by any statement", async () => {
    await players.markPhoneVerified(MIA, NUMBER);
    await players.markPhoneVerified(PETE, OTHER);
    // The raw statement a script might write: the plain number and the sealed copy cleared, the index forgotten.
    await c.query(`UPDATE players SET phone_e164 = NULL, phone_sealed = NULL WHERE id = $1`, [MIA]);
    nothingSealed(await row(MIA), "the index and its key id went with them");
    assert.equal(await findVerifiedByPhone(c, NUMBER, SEALED_READS), null, "nobody is found by a number no account holds");
    // A row without a plain number holds nothing sealed, whatever the statement tried to write.
    const stray = phoneSealing(ENV).seal(MIA, NUMBER);
    await c.query(`UPDATE players SET phone_sealed = $2, phone_index = $3, phone_index_kid = $4 WHERE id = $1`, [MIA, stray.sealed, stray.index, stray.indexKid]);
    nothingSealed(await row(MIA), "no plain number: nothing sealed is kept");
    await c.query(`UPDATE players SET phone_e164 = NULL, phone_sealed = $2, phone_index = $3, phone_index_kid = $4 WHERE id = $1`, [PETE, stray.sealed, stray.index, stray.indexKid]);
    nothingSealed(await row(PETE), "cleared with a sealing written beside it: still nothing kept");

    // With a number present, each way of leaving the three out of step is refused by the table itself.
    await players.markPhoneVerified(QUINN, NUMBER);
    const before = await row(QUINN);
    for (const set of [
      `phone_sealed = NULL`,
      `phone_index = NULL`,
      `phone_index_kid = NULL`,
      `phone_sealed = NULL, phone_index = NULL`,
      `phone_sealed = NULL, phone_index_kid = NULL`,
      `phone_index = NULL, phone_index_kid = NULL`,
    ]) {
      await assert.rejects(c.query(`UPDATE players SET ${set} WHERE id = $1`, [QUINN]), /players_phone_sealed_together_check/, set);
    }
    assert.deepEqual(await row(QUINN), before);
    // A new row can't start out of step either (the trigger only sees updates).
    for (const [columns, values] of [
      [`phone_index, phone_index_kid`, [stray.index, stray.indexKid]],
      [`phone_sealed`, [stray.sealed]],
      [`phone_sealed, phone_index`, [stray.sealed, stray.index]],
    ] as const) {
      await assert.rejects(
        c.query(`INSERT INTO players (email, first_name, last_name, phone_e164, ${columns}) VALUES ('together@golden.test', 'T', 'Gether', $1, ${values.map((_, i) => `$${i + 2}`).join(", ")})`, [OTHER, ...values]),
        /players_phone_sealed_together_check/,
        columns,
      );
    }
    // All three cleared, with the number kept, is allowed (it is what the backfill then finds).
    await c.query(`UPDATE players SET phone_sealed = NULL, phone_index = NULL, phone_index_kid = NULL WHERE id = $1`, [QUINN]);
    assert.equal((await row(QUINN)).phone_e164, NUMBER);
    assert.deepEqual(await backfillPhones(c, { apply: true, env: ENV }), { pending: 1, sealed: 1, failed: 0 });
    sealedFor(await row(QUINN), NUMBER);
    // No row anywhere holds one of the three without the others, or any of them without a number.
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM players WHERE num_nonnulls(phone_sealed, phone_index, phone_index_kid) NOT IN (0, 3) OR (phone_e164 IS NULL AND phone_index IS NOT NULL)`)).rows[0].n, 0);
  });

  test("the database refuses anything in phone_sealed that isn't in the sealed format", async () => {
    // An account with a number: a row without one holds nothing sealed at all (the trigger empties it).
    await players.markPhoneVerified(MIA, NUMBER);
    await assert.rejects(c.query(`UPDATE players SET phone_sealed = $2 WHERE id = $1`, [MIA, NUMBER]), /players_phone_sealed_check/);
    await assert.rejects(c.query(`UPDATE players SET phone_sealed = 'v1.c1.only-three' WHERE id = $1`, [MIA]), /players_phone_sealed_check/);
  });

  test("a merge leaves nothing sealed on the retired account and re-seals the number for the kept one", async () => {
    // The kept account has no number; the duplicate has a verified one.
    const [KEPT, DUPE] = [22, 23];
    await players.updatePlayerProfile(DUPE, profile("021 123 4567"));
    await players.markPhoneVerified(DUPE, NUMBER);
    const dupe = await row(DUPE);
    await merge.mergeMembers(`player${KEPT}@golden.test`, `player${DUPE}@golden.test`, true);
    const retired = await row(DUPE);
    assert.equal(retired.deleted, true);
    assert.equal(retired.phone_e164, null);
    nothingSealed(retired, "after the merge's wipe");
    const kept = await row(KEPT);
    assert.equal(kept.phone_e164, NUMBER);
    assert.equal(kept.verified, true);
    sealedFor(kept, NUMBER);
    assert.notEqual(kept.phone_sealed, dupe.phone_sealed, "sealed anew for the kept account, not copied");
    assert.throws(() => phoneSealing(ENV).open(KEPT, dupe.phone_sealed!), /can't be opened/, "the duplicate's sealed text is no use under the kept id");
    for (const env of [ENV, SEALED_READS]) assert.equal(await findVerifiedByPhone(c, SPELLINGS[0], env), KEPT, "found under the kept id");
  });

  test("a merge where the kept account has its own number keeps that one, sealed as it was", async () => {
    const [KEPT, DUPE] = [20, 21];
    await players.markPhoneVerified(KEPT, OTHER);
    await players.markPhoneVerified(DUPE, NUMBER);
    const before = await row(KEPT);
    await merge.mergeMembers(`player${KEPT}@golden.test`, `player${DUPE}@golden.test`, true);
    assert.deepEqual(await row(KEPT), before);
    nothingSealed(await row(DUPE), "after the merge's wipe");
    assert.equal(await findVerifiedByPhone(c, NUMBER, SEALED_READS), null);
  });

  test("the backfill seals what was written before the keys existed; run twice, the second changes nothing", async () => {
    // Numbers from before: plain only. One verified, one not, one account without a number.
    await c.query(`UPDATE players SET phone = '021 123 4567', phone_e164 = $2, phone_verified_at = NOW() WHERE id = $1`, [MIA, NUMBER]);
    await c.query(`UPDATE players SET phone = '021 999 8888', phone_e164 = $2 WHERE id = $1`, [PETE, OTHER]);
    await c.query(`UPDATE players SET phone = '021 999 8888', phone_e164 = $1 WHERE id IN (6, 7, 8)`, [OTHER]);
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);

    // A dry run counts and writes nothing; it needs no key.
    assert.deepEqual(await backfillPhones(c, { apply: false, env: {}, log }), { pending: 5, sealed: 0, failed: 0 });
    nothingSealed(await row(MIA), "a dry run writes nothing");
    // Applying without keys is refused before anything is read.
    await assert.rejects(backfillPhones(c, { apply: true, env: {}, log }), SealError);

    assert.deepEqual(await backfillPhones(c, { apply: true, batch: 2, env: ENV, log }), { pending: 5, sealed: 5, failed: 0 });
    for (const [id, number] of [[MIA, NUMBER], [PETE, OTHER], [6, OTHER], [7, OTHER], [8, OTHER]] as const) sealedFor(await row(id), number);
    nothingSealed(await row(QUINN), "no number, nothing to seal");
    assert.equal(await findVerifiedByPhone(c, SPELLINGS[0], SEALED_READS), MIA);

    const snapshot = (await c.query(`SELECT id, phone, phone_e164, phone_verified_at, phone_sealed, phone_index, phone_index_kid FROM players ORDER BY id`)).rows;
    assert.deepEqual(await backfillPhones(c, { apply: true, batch: 2, env: ENV, log }), { pending: 0, sealed: 0, failed: 0 });
    assert.deepEqual((await c.query(`SELECT id, phone, phone_e164, phone_verified_at, phone_sealed, phone_index, phone_index_kid FROM players ORDER BY id`)).rows, snapshot, "the second run changed nothing");

    // What it printed holds counts only: no number, no sealed text, no index.
    const printed = lines.join("\n");
    assert.ok(printed.length > 0);
    for (const r of snapshot) {
      for (const secret of [r.phone_e164, r.phone_sealed, r.phone_index]) if (secret) assert.ok(!printed.includes(secret));
    }
    assert.ok(!/\d{7,}/.test(printed), "nothing that looks like a number");
  });

  test("one row at a time: sealStoredPhone seals a plain number once and never overwrites", async () => {
    await c.query(`UPDATE players SET phone_e164 = $2 WHERE id = $1`, [MIA, NUMBER]);
    assert.equal(await sealStoredPhone(c, MIA, {}), false, "no key: nothing to do");
    assert.equal(await sealStoredPhone(c, MIA, ENV), true);
    const first = await row(MIA);
    sealedFor(first, NUMBER);
    assert.equal(await sealStoredPhone(c, MIA, ENV), false);
    assert.deepEqual(await row(MIA), first);
    assert.equal(await sealStoredPhone(c, QUINN, ENV), false, "no number");
  });
});
