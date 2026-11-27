// Social plan, Task 2b: reports (lib/moderation/reports.ts), their sealing
// (seal.ts), the evidence kept for child-safety reports, the append-only
// action log (actions.ts) and migration 0023's tables. Against a real
// Postgres, with two clubs, once as the database owner (TENANT_SCOPE=off) and
// once as the app's role for one club (TENANT_SCOPE=enforce). Made-up people
// only.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { SealError } from "@luvallplay/crypto";
import { REPORT_REASONS, SOCIAL_LIMITS, severityOf } from "@luvallplay/core/social";
import { migrate } from "../scripts/db/migrate.mjs";
import { ACTION_REASON_MAX, MODERATION_ACTIONS, recordAction } from "../lib/moderation/actions.ts";
import { fileReport, registerReportTarget, type ReportTarget } from "../lib/moderation/reports.ts";
import { moderationSeal } from "../lib/moderation/seal.ts";
import { suspend } from "../lib/moderation/suspensions.ts";
import { newPublicId } from "../lib/social/public-id.ts";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `moderation_reports_${process.pid}`;
const SEED = fs.readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");
const key = () => randomBytes(32).toString("base64");
const NOT_FOUND = { ok: false, code: "not_found" } as const;
const HOUR = 60 * 60 * 1000;

describe("the moderation seal", () => {
  const KEYS = { MODERATION_KEKS: `m1:${key()}` };

  test("details open only for their own report, and never as evidence (nor the other way round)", () => {
    const seal = moderationSeal(KEYS);
    assert.equal(seal.available(), true);
    const details = seal.seal(7, "He keeps messaging me");
    const evidence = seal.sealEvidence(7, "the post");
    for (const sealed of [details, evidence]) assert.match(sealed, /^v1\.m1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(seal.open(7, details), "He keeps messaging me");
    assert.equal(seal.openEvidence(7, evidence), "the post");
    const unopenable = (err: unknown) => err instanceof SealError && err.code === "unopenable";
    assert.throws(() => seal.open(8, details), unopenable);
    assert.throws(() => seal.openEvidence(8, evidence), unopenable);
    assert.throws(() => seal.openEvidence(7, details), unopenable);
    assert.throws(() => seal.open(7, evidence), unopenable);
    assert.throws(() => moderationSeal({ MODERATION_KEKS: `m1:${key()}` }).open(7, details), unopenable, "another deployment's key");
    assert.throws(() => seal.seal(0, "x"), SealError, "a report id is a positive whole number");
  });

  test("no key: not available, and sealing throws instead of handing back the words", () => {
    for (const env of [{}, { MODERATION_KEKS: "" }, { MODERATION_KEKS: "  " }]) {
      const seal = moderationSeal(env);
      assert.equal(seal.available(), false);
      assert.throws(() => seal.seal(7, "words"), (err: unknown) => err instanceof SealError && err.code === "unavailable" && !err.message.includes("words"));
      assert.throws(() => seal.sealEvidence(7, "words"), SealError);
    }
  });

  test("a malformed key list throws, even when only asked whether a key is there", () => {
    const seal = moderationSeal({ MODERATION_KEKS: "m1:too-short" });
    assert.throws(() => seal.available(), /MODERATION_KEKS/);
    assert.throws(() => seal.seal(7, "words"), /MODERATION_KEKS/);
  });
});

describe("reports, evidence and the action log", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const env = { ...process.env };
  let admin: pg.Client;
  let database: typeof import("../lib/database.ts");
  let club2 = 0;
  // Seed accounts in Three Wolves (club 1): 1 its owner, 2 an admin, 3 Mia,
  // 4 Pete, 5 Quinn, 6 Rua, 7 Sione (also joins club 2), 25 a deleted account.
  const OWNER = 1;
  const ADMIN = 2;
  const MIA = 3;
  const PETE = 4;
  const QUINN = 5;
  const RUA = 6;
  const SIONE = 7;
  const DELETED = 25;
  // Hanoi Smash (club 2) only.
  let LINH = 0;
  let NAM = 0;
  const KEYS = { MODERATION_KEKS: `m1:${key()}` };
  const seal = moderationSeal(KEYS);
  const noKey = moderationSeal({});
  const rows = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows;
  const publicIds = new Map<number, string>();
  const pid = (playerId: number) => publicIds.get(playerId)!;
  const value = <T,>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
    assert.ok(r.ok, JSON.stringify(r));
    return r.value;
  };

  async function profile(playerId: number, displayName: string, visibility: "club" | "everyone" = "club", bio: string | null = null) {
    const publicId = newPublicId();
    await admin.query(
      `INSERT INTO social_profiles (player_id, public_id, display_name, bio, visibility, adult_confirmed_at, rules_version) VALUES ($1, $2, $3, $4, $5, now(), '2026-12')`,
      [playerId, publicId, displayName, bio, visibility],
    );
    publicIds.set(playerId, publicId);
  }
  const socialOn = (clubId: number, on: boolean) =>
    admin.query(
      `INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES ($1, 'social', $2) ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [clubId, on],
    );
  const report = async (id: number) => (await rows(`SELECT * FROM content_reports WHERE id = $1`, [id]))[0];
  const count = async (table: string) => Number((await rows(`SELECT count(*)::int AS n FROM ${table}`))[0].n);
  /** Every column of every row of the three tables, as one text: to prove words are nowhere in them. */
  const everything = async () => JSON.stringify([await rows(`SELECT * FROM content_reports`), await rows(`SELECT * FROM moderation_evidence`), await rows(`SELECT * FROM moderation_actions`)]);

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const root = new pg.Client({ connectionString: urlFor("postgres") });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await root.query(`CREATE DATABASE ${NAME}`);
    await root.end();
    admin = new pg.Client({ connectionString: urlFor(NAME) });
    await admin.connect();
    await migrate(admin, { log: () => {} });
    await admin.query(SEED);
    club2 = (
      await admin.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'han', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, payment_mode, incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    [LINH, NAM] = (
      await admin.query(`INSERT INTO players (email, first_name, last_name) VALUES ('linh@hanoi.test', 'Linh', 'Nguyen'), ('nam@hanoi.test', 'Nam', 'Tran') RETURNING id`)
    ).rows.map((r) => Number(r.id));
    await admin.query(`INSERT INTO club_members (tenant_id, user_id, role, status) VALUES ($1, $2, 'member', 'active'), ($1, $3, 'member', 'active'), ($1, $4, 'member', 'active')`, [club2, LINH, NAM, SIONE]);
    process.env.POSTGRES_URL = urlFor(NAME);
    process.env.DATABASE_DRIVER = "postgres";
    process.env.TENANT_SLUG = "three-wolves";
    delete process.env.TENANT_SCOPE;
    delete process.env.APP_DATABASE_URL;
    delete process.env.CONTACT_KEKS;
    delete process.env.CONTACT_INDEX_KEYS;
    delete process.env.MODERATION_KEKS;
    delete process.env.PII_READS;
    database = await import("../lib/database.ts");
  });
  after(async () => {
    await database?.closeDatabase();
    process.env = env;
    await admin?.end();
    const root = new pg.Client({ connectionString: urlFor("postgres") });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await root.end();
  });

  test("the tables are the platform's; the app's role can add to the action log and the evidence and can't change or remove either", async () => {
    const tables = ["content_reports", "moderation_actions", "moderation_evidence"];
    const found = await rows(
      `SELECT c.relname AS t, c.relrowsecurity AS rls,
              EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS tenant_id,
              has_table_privilege('luvallplay_app', c.oid, 'SELECT') AS sel, has_table_privilege('luvallplay_app', c.oid, 'INSERT') AS ins,
              has_table_privilege('luvallplay_app', c.oid, 'UPDATE') AS upd, has_table_privilege('luvallplay_app', c.oid, 'DELETE') AS del,
              has_table_privilege('luvallplay_app', c.oid, 'TRUNCATE') AS trunc
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY($1) ORDER BY 1`,
      [tables],
    );
    assert.deepEqual(found.map((r) => r.t), tables);
    for (const r of found) {
      const appendOnly = r.t !== "content_reports";
      assert.deepEqual(
        { rls: r.rls, tenant_id: r.tenant_id, sel: r.sel, ins: r.ins, upd: r.upd, del: r.del, trunc: r.trunc },
        { rls: false, tenant_id: false, sel: true, ins: !appendOnly, upd: !appendOnly, del: !appendOnly, trunc: false },
        r.t,
      );
    }
    // The app's role adds to the two append-only tables column by column: never a row's id or its time.
    const writable = await rows(
      `SELECT c.relname AS t, array_agg(a.attname::text ORDER BY a.attname) AS cols FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.relname IN ('moderation_actions', 'moderation_evidence') AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('luvallplay_app', a.attrelid, a.attnum, 'INSERT')
       GROUP BY 1 ORDER BY 1`,
    );
    assert.deepEqual(writable, [
      { t: "moderation_actions", cols: ["action", "actor_id", "reason", "report_id", "target_id", "target_type"] },
      { t: "moderation_evidence", cols: ["author_player_id", "report_id", "sealed"] },
    ]);
    assert.equal((await rows(`SELECT attidentity FROM pg_attribute WHERE attrelid = 'moderation_actions'::regclass AND attname = 'id'`))[0].attidentity, "a");
    // Keys to accounts: only the reporter's, and it is RESTRICT (tests/account-fks.test.ts).
    const fks = await rows(
      `SELECT conrelid::regclass::text AS t, conname, confrelid::regclass::text AS f, confdeltype FROM pg_constraint
       WHERE contype = 'f' AND conrelid::regclass::text = ANY($1) ORDER BY 2`,
      [tables],
    );
    assert.deepEqual(fks.map((r) => `${r.conname} -> ${r.f} ${r.confdeltype}`), [
      "content_reports_club_id_fkey -> tenants r",
      "content_reports_reporter_id_fkey -> players r",
      "moderation_actions_report_id_fkey -> content_reports r",
      "moderation_evidence_report_id_fkey -> content_reports r",
    ]);
  });

  test("the database keeps the rules: reasons, queues, the sealed format, one open report per person and target", async () => {
    await admin.query(`TRUNCATE moderation_evidence, moderation_actions, content_reports`);
    const insert = (cols: Record<string, unknown> = {}) => {
      const row: Record<string, unknown> = { reporter_id: MIA, target_type: "profile", target_id: PETE, club_id: 1, reason: "spam", severity: "normal", queue: "club", due_at: new Date(), ...cols };
      const names = Object.keys(row);
      return admin.query(`INSERT INTO content_reports (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, Object.values(row));
    };
    await assert.rejects(insert({ reason: "boring" }), /content_reports_reason_check/);
    await assert.rejects(insert({ target_type: "club" }), /content_reports_target_type_check/);
    await assert.rejects(insert({ severity: "urgent" }), /content_reports_severity_check/);
    await assert.rejects(insert({ queue: "nobody" }), /content_reports_queue_check/);
    await assert.rejects(insert({ status: "closed", handled_at: new Date() }), /content_reports_status_check/);
    await assert.rejects(insert({ severity: "serious", reason: "child_safety" }), /content_reports_serious_is_platform_check/);
    await assert.rejects(insert({ club_id: null }), /content_reports_club_queue_has_club_check/);
    await assert.rejects(insert({ status: "dismissed" }), /content_reports_handled_check/);
    await assert.rejects(insert({ handled_at: new Date() }), /content_reports_handled_check/);
    await assert.rejects(insert({ details_sealed: "He keeps messaging me" }), /content_reports_details_sealed_check/);
    await assert.rejects(insert({ reporter_id: 999999 }), /content_reports_reporter_id_fkey/);
    await assert.rejects(insert({ club_id: 999999 }), /content_reports_club_id_fkey/);
    await assert.rejects(insert({ due_at: null }), /due_at/);
    // Every reason the code knows is one the database takes.
    for (const reason of REPORT_REASONS) {
      const serious = severityOf(reason) === "serious";
      await insert({ reporter_id: null, reason, severity: serious ? "serious" : "normal", queue: serious ? "platform" : "club" });
    }
    assert.equal(await count("content_reports"), REPORT_REASONS.length, "reports with no reporter don't collide");

    const first = Number((await insert()).rows[0].id);
    await assert.rejects(insert(), /content_reports_one_open_idx/);
    await insert({ target_id: QUINN });
    await insert({ target_type: "post" });
    // Once it is closed the same person can report the same thing again.
    await admin.query(`UPDATE content_reports SET status = 'actioned', handled_at = now(), handled_by = $2 WHERE id = $1`, [first, ADMIN]);
    await insert();

    const act = (cols: Record<string, unknown> = {}) => {
      const row: Record<string, unknown> = { actor_id: ADMIN, target_type: "profile", target_id: PETE, action: "hide", ...cols };
      const names = Object.keys(row);
      return admin.query(`INSERT INTO moderation_actions (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
    };
    await assert.rejects(act({ action: "shame" }), /moderation_actions_action_check/);
    await assert.rejects(act({ target_type: "club" }), /moderation_actions_target_type_check/);
    await assert.rejects(act({ reason: "x".repeat(ACTION_REASON_MAX + 1) }), /moderation_actions_reason_check/);
    await assert.rejects(act({ reason: "" }), /moderation_actions_reason_check/);
    await assert.rejects(act({ report_id: 999999 }), /moderation_actions_report_id_fkey/);
    for (const action of MODERATION_ACTIONS) await act({ action, report_id: first });
    await act({ actor_id: null, action: "dismiss" });

    await assert.rejects(admin.query(`INSERT INTO moderation_evidence (report_id, sealed) VALUES ($1, 'the words of the post')`, [first]), /moderation_evidence_sealed_check/);
    await assert.rejects(admin.query(`INSERT INTO moderation_evidence (report_id, sealed) VALUES (999999, $1)`, [seal.sealEvidence(999999, "x")]), /moderation_evidence_report_id_fkey/);
    await assert.rejects(admin.query(`INSERT INTO moderation_evidence (report_id) VALUES ($1)`, [first]), /sealed/);
    await admin.query(`INSERT INTO moderation_evidence (report_id, sealed, author_player_id) VALUES ($1, $2, $3)`, [first, seal.sealEvidence(first, "x"), PETE]);
    await assert.rejects(admin.query(`INSERT INTO moderation_evidence (report_id, sealed) VALUES ($1, $2)`, [first, seal.sealEvidence(first, "y")]), /moderation_evidence_pkey/);
    // A report with a record or evidence can't be removed from under them.
    await assert.rejects(admin.query(`DELETE FROM content_reports WHERE id = $1`, [first]), (e: { code?: string }) => e.code === "23001" || e.code === "23503");
    // The account ids in the record have no foreign key: they stand whatever happens to the account.
    await act({ actor_id: 999999, target_id: 999998 });
    await admin.query(`TRUNCATE moderation_evidence, moderation_actions, content_reports`);
  });

  for (const mode of ["off", "enforce"] as const) {
    describe(`TENANT_SCOPE=${mode}`, () => {
      let db: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

      before(async () => {
        await database.closeDatabase();
        process.env.TENANT_SCOPE = mode;
        db = { query: (text, params) => database.sql.query(text, params) };
      });
      beforeEach(async () => {
        await admin.query(`TRUNCATE moderation_evidence, moderation_actions, content_reports, social_follows, user_blocks, social_kudos, social_comments, social_posts, social_club_bans, social_profiles, player_suspensions`);
        await admin.query(`DELETE FROM tenant_modules WHERE module_id = 'social'`);
        await admin.query(`UPDATE club_members SET status = 'active'`);
        await admin.query(`UPDATE club_members SET role = 'member' WHERE user_id = $1`, [QUINN]);
        await admin.query(`DELETE FROM club_roles WHERE player_id = $1`, [RUA]);
        registerReportTarget("post", null);
        publicIds.clear();
        await socialOn(1, true);
        await socialOn(club2, true);
        await profile(OWNER, "The Owner");
        await profile(ADMIN, "An Admin");
        await profile(MIA, "Mia G");
        await profile(PETE, "Pete the Smash", "club", "Smashes first, asks later");
        await profile(QUINN, "Quinn", "everyone");
        await profile(RUA, "Rua");
        await profile(SIONE, "Sione S");
        await profile(LINH, "Linh N");
        await profile(NAM, "Nam T", "everyone");
      });

      test("the connection is what the mode says", async () => {
        const who = (await db.query(`SELECT current_user AS role, row_security_active('club_roles') AS scoped`)).rows[0];
        if (mode === "enforce") assert.deepEqual(who, { role: "luvallplay_app", scoped: true });
        else assert.equal(who.scoped, false);
      });

      test("an ordinary report: normal, due in 24 hours, in the club's queue, and the row holds ids only", async () => {
        const before = Date.now();
        const { id } = value(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "spam" }));
        const r = await report(id);
        assert.deepEqual(
          { reporter: r.reporter_id, type: r.target_type, target: Number(r.target_id), club: r.club_id, reason: r.reason, severity: r.severity, queue: r.queue, details: r.details_sealed, status: r.status, alerted: r.alerted_at, by: r.handled_by, at: r.handled_at },
          { reporter: MIA, type: "profile", target: PETE, club: 1, reason: "spam", severity: "normal", queue: "club", details: null, status: "open", alerted: null, by: null, at: null },
        );
        assert.equal(r.due_at.getTime() - r.created_at.getTime(), 24 * HOUR);
        assert.ok(r.created_at.getTime() >= before - 1000 && r.created_at.getTime() <= Date.now() + 1000);
        assert.equal(await count("moderation_evidence"), 0, "evidence is for child-safety reports only");
        assert.equal(await count("moderation_actions"), 0, "a report alone does nothing to the target");
        const text = await everything();
        for (const word of ["Pete", "Smash", pid(PETE), pid(MIA)]) assert.ok(!text.includes(word), word);
      });

      test("every serious reason is due in 12 hours and goes to the platform; the others stay with the club", async () => {
        for (const reason of REPORT_REASONS) {
          await admin.query(`TRUNCATE moderation_evidence, moderation_actions, content_reports`);
          const { id } = value(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason }));
          const r = await report(id);
          const serious = severityOf(reason) === "serious";
          assert.deepEqual([r.severity, r.queue, (r.due_at.getTime() - r.created_at.getTime()) / HOUR, r.club_id], serious ? ["serious", "platform", 12, 1] : ["normal", "club", 24, 1], reason);
        }
      });

      test("a missing target, and one the reporter can't see, answer the same not_found and write nothing (Review Focus 6)", async () => {
        await admin.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2), ($3, $1)`, [MIA, QUINN, RUA]);
        value(await suspend(db, { playerId: PETE, scope: "social", until: null, reasonCode: "harassment", actorId: ADMIN }, {}));
        await profile(DELETED, "Gone");
        const tries: [string, unknown, string?][] = [
          ["an id nobody has", newPublicId()],
          ["a malformed id", "nope"],
          ["an account id instead of a public id", String(PETE)],
          ["a number", PETE],
          ["nothing", undefined],
          ["someone the reporter blocked", pid(QUINN)],
          ["someone who blocked the reporter", pid(RUA)],
          ["a suspended person", pid(PETE)],
          ["a deleted account", pid(DELETED)],
          ["a club-only profile in another club", pid(LINH)],
          ["themselves", pid(MIA)],
          ["a kind of target nothing is registered for", pid(SIONE), "listing"],
          ["a kind of target that doesn't exist", pid(SIONE), "club"],
          ["a post, before posts exist", 1, "post"],
        ];
        const answers: string[] = [];
        for (const [what, targetId, targetType] of tries) {
          const answer = await fileReport(db, seal, { reporterId: MIA, targetType: (targetType ?? "profile") as "profile", targetId, reason: "harassment", details: "Please look at this" });
          assert.deepEqual(answer, NOT_FOUND, what);
          answers.push(JSON.stringify(answer));
        }
        assert.equal(new Set(answers).size, 1, "one answer, byte for byte");
        // And a reporter that isn't an account is no different.
        assert.deepEqual(await fileReport(db, seal, { reporterId: 999999, targetType: "profile", targetId: pid(QUINN), reason: "spam" }), NOT_FOUND);
        assert.deepEqual(await fileReport(db, seal, { reporterId: 1.5, targetType: "profile", targetId: pid(QUINN), reason: "spam" }), NOT_FOUND);
        assert.equal(await count("content_reports"), 0);
        assert.equal(await count("moderation_evidence"), 0);
        // Still visible to someone else: the same call from them is taken.
        value(await fileReport(db, seal, { reporterId: SIONE, targetType: "profile", targetId: pid(QUINN), reason: "spam" }));
      });

      test("a reason that isn't one, and details that are too long, are refused before anything is looked up", async () => {
        for (const reason of ["", "boring", "SPAM", null, undefined, 7]) {
          assert.deepEqual(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: reason as never }), { ok: false, code: "invalid_reason" }, String(reason));
          assert.deepEqual(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: newPublicId(), reason: reason as never }), { ok: false, code: "invalid_reason" }, "the same for a missing target");
        }
        const long = "ế".repeat(SOCIAL_LIMITS.reportDetails + 1);
        assert.deepEqual(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "spam", details: long }), { ok: false, code: "details_too_long" });
        assert.deepEqual(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: newPublicId(), reason: "spam", details: long }), { ok: false, code: "details_too_long" }, "the same for a missing target");
        assert.deepEqual(await fileReport(db, noKey, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "spam", details: long }), { ok: false, code: "details_too_long" }, "the same with no key");
        assert.equal(await count("content_reports"), 0);
        // Exactly the limit, in Vietnamese letters, is taken.
        const most = "ế".repeat(SOCIAL_LIMITS.reportDetails);
        const { id } = value(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "spam", details: most }));
        assert.equal(seal.open(id, (await report(id)).details_sealed), most);
      });

      test("details are stored sealed: the words are nowhere in the row, and they open for that report only", async () => {
        const words = "He keeps   messaging me after matches.\nPlease make it stop";
        const { id } = value(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "harassment", details: words }));
        const other = value(await fileReport(db, seal, { reporterId: QUINN, targetType: "profile", targetId: pid(PETE), reason: "harassment", details: "Another thing entirely" }));
        const r = await report(id);
        assert.match(r.details_sealed, /^v1\.m1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        const text = await everything();
        for (const word of ["messaging", "matches", "Please", "Another", "entirely"]) assert.ok(!text.includes(word), word);
        // Cleaned as all text is: trimmed, runs of space collapsed.
        assert.equal(seal.open(id, r.details_sealed), "He keeps messaging me after matches. Please make it stop");
        assert.throws(() => seal.open(other.id, r.details_sealed), SealError, "another report's id");
        assert.throws(() => seal.openEvidence(id, r.details_sealed), SealError, "not as evidence");
        assert.throws(() => moderationSeal({ MODERATION_KEKS: `m1:${key()}` }).open(id, r.details_sealed), SealError);
        // Copying the sealed text onto another report doesn't make it open there.
        await admin.query(`UPDATE content_reports SET details_sealed = $2 WHERE id = $1`, [other.id, r.details_sealed]);
        const copied = (await report(other.id)).details_sealed;
        assert.throws(() => seal.open(other.id, copied), SealError);
        // Details that are nothing are no details.
        for (const [reporter, nothing] of [[RUA, ""], [SIONE, "   \n "], [ADMIN, undefined], [OWNER, 7]] as const) {
          const empty = value(await fileReport(db, seal, { reporterId: reporter, targetType: "profile", targetId: pid(PETE), reason: "spam", details: nothing as never }));
          assert.equal((await report(empty.id)).details_sealed, null);
        }
      });

      test("without MODERATION_KEKS the report is still taken, with no details and no evidence; a malformed key list is an error, not silence", async () => {
        const { id } = value(await fileReport(db, noKey, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "harassment", details: "He keeps messaging me" }));
        const r = await report(id);
        assert.deepEqual([r.details_sealed, r.status, r.queue, r.severity], [null, "open", "club", "normal"]);
        const child = value(await fileReport(db, noKey, { reporterId: QUINN, targetType: "profile", targetId: pid(PETE), reason: "child_safety", details: "Look at the bio" }));
        const c = await report(child.id);
        assert.deepEqual([c.details_sealed, c.severity, c.queue], [null, "serious", "platform"]);
        assert.equal(await count("moderation_evidence"), 0, "nothing can be kept without a key: never plain");
        const text = await everything();
        for (const word of ["messaging", "Look at", "Smashes"]) assert.ok(!text.includes(word), word);

        await assert.rejects(fileReport(db, moderationSeal({ MODERATION_KEKS: "m1:too-short" }), { reporterId: RUA, targetType: "profile", targetId: pid(PETE), reason: "spam", details: "x" }), /MODERATION_KEKS/);
        assert.equal(await count("content_reports"), 2, "and nothing was written for it");
      });

      test("child_safety: serious, 12 hours, the platform's, with a sealed copy of the content and the author's id (Review Focus 5)", async () => {
        const { id } = value(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "child_safety", details: "The bio worries me" }));
        const r = await report(id);
        assert.deepEqual([r.severity, r.queue, r.club_id, (r.due_at.getTime() - r.created_at.getTime()) / HOUR], ["serious", "platform", 1, 12]);
        const evidence = await rows(`SELECT * FROM moderation_evidence`);
        assert.equal(evidence.length, 1);
        assert.deepEqual([Number(evidence[0].report_id), evidence[0].author_player_id], [id, PETE]);
        const text = await everything();
        for (const word of ["Pete", "Smashes", "asks later", "worries"]) assert.ok(!text.includes(word), word);
        const kept = JSON.parse(seal.openEvidence(id, evidence[0].sealed));
        assert.deepEqual(kept, { targetType: "profile", targetId: PETE, content: { displayName: "Pete the Smash", bio: "Smashes first, asks later" } });
        assert.throws(() => seal.open(id, evidence[0].sealed), SealError, "evidence doesn't open as details");
        assert.throws(() => seal.openEvidence(id + 1, evidence[0].sealed), SealError);

        // It stands when the profile is gone and the account deleted (the app's soft delete, as deletePlayerAccount).
        await admin.query(`DELETE FROM social_profiles WHERE player_id = $1`, [PETE]);
        await admin.query(`UPDATE players SET deleted_at = now(), email = 'deleted-' || id || '@deleted.invalid', first_name = '', last_name = '' WHERE id = $1`, [PETE]);
        try {
          const after = await rows(`SELECT report_id, author_player_id, sealed FROM moderation_evidence`);
          assert.equal(JSON.parse(seal.openEvidence(id, after[0].sealed)).content.displayName, "Pete the Smash");
          assert.equal((await report(id)).status, "open", "the report stays in the queue");
        } finally {
          await admin.query(`UPDATE players SET deleted_at = NULL, email = 'player4@golden.test', first_name = 'Pete' WHERE id = $1`, [PETE]);
        }
        // The reporter leaving: the report stays, with no reporter (Task 6 does this).
        await admin.query(`UPDATE content_reports SET reporter_id = NULL, details_sealed = NULL WHERE reporter_id = $1`, [MIA]);
        assert.equal((await report(id)).reporter_id, null);
        assert.equal(await count("moderation_evidence"), 1);
      });

      test("a repeat open report is `duplicate` and changes nothing; once the first is closed a new one is taken", async () => {
        const first = value(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "spam", details: "First words" }));
        const before = await report(first.id);
        for (const reason of ["spam", "child_safety", "harassment"] as const) {
          assert.deepEqual(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason, details: "Second words" }), { ok: false, code: "duplicate" }, reason);
        }
        assert.deepEqual(await report(first.id), before);
        assert.equal(await count("content_reports"), 1);
        assert.equal(await count("moderation_evidence"), 0, "a duplicate writes no evidence either");
        // Someone else reporting the same person, and the same person reporting someone else, are their own reports.
        value(await fileReport(db, seal, { reporterId: QUINN, targetType: "profile", targetId: pid(PETE), reason: "spam" }));
        value(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(QUINN), reason: "spam" }));
        await admin.query(`UPDATE content_reports SET status = 'dismissed', handled_at = now(), handled_by = $2 WHERE id = $1`, [first.id, ADMIN]);
        const again = value(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "spam" }));
        assert.notEqual(again.id, first.id);
      });

      test("the same report sent twice at once makes one row: one is taken, the others are `duplicate`, none is an error", async () => {
        for (const reason of ["spam", "child_safety"] as const) {
          await admin.query(`TRUNCATE moderation_evidence, moderation_actions, content_reports`);
          const answers = await Promise.all(Array.from({ length: 6 }, () => fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason, details: "Sent six times" })));
          assert.equal(answers.filter((a) => a.ok).length, 1, JSON.stringify(answers));
          assert.deepEqual(answers.filter((a) => !a.ok), Array.from({ length: 5 }, () => ({ ok: false, code: "duplicate" })));
          const all = await rows(`SELECT id, details_sealed FROM content_reports`);
          assert.equal(all.length, 1);
          const taken = answers.find((a) => a.ok)!;
          assert.equal(Number(all[0].id), value(taken).id);
          assert.equal(seal.open(Number(all[0].id), all[0].details_sealed), "Sent six times", "the row's details are its own");
          const evidence = await rows(`SELECT report_id FROM moderation_evidence`);
          assert.deepEqual(evidence.map((e) => Number(e.report_id)), reason === "child_safety" ? [Number(all[0].id)] : []);
        }
      });

      test("a report about a club's own owner or admin goes to the platform, not to that club", async () => {
        const about = async (reporter: number, target: number) => {
          const { id } = value(await fileReport(db, seal, { reporterId: reporter, targetType: "profile", targetId: pid(target), reason: "harassment" }));
          const r = await report(id);
          return [r.queue, r.club_id, r.severity];
        };
        assert.deepEqual(await about(MIA, OWNER), ["platform", 1, "normal"]);
        assert.deepEqual(await about(MIA, ADMIN), ["platform", 1, "normal"]);
        assert.deepEqual(await about(MIA, PETE), ["club", 1, "normal"], "a member's stays with the club");
        // Either table saying so is enough (club_roles is the source; club_members mirrors it).
        await admin.query(`INSERT INTO club_roles (tenant_id, player_id, role) VALUES (1, $1, 'admin')`, [RUA]);
        await admin.query(`UPDATE club_members SET role = 'owner' WHERE tenant_id = 1 AND user_id = $1`, [QUINN]);
        assert.deepEqual(await about(MIA, RUA), ["platform", 1, "normal"]);
        assert.deepEqual(await about(MIA, QUINN), ["platform", 1, "normal"]);
        // A coach is not who the rule is about.
        await admin.query(`UPDATE club_roles SET role = 'coach' WHERE tenant_id = 1 AND player_id = $1`, [RUA]);
        assert.deepEqual(await about(PETE, RUA), ["club", 1, "normal"]);
        // An admin reporting a member is an ordinary report.
        assert.deepEqual(await about(ADMIN, MIA), ["club", 1, "normal"]);
      });

      test("which club: one the two share (this deployment's first); none shared, or a club whose roles can't be read here, means the platform", async () => {
        const about = async (reporter: number, target: number) => {
          const { id } = value(await fileReport(db, seal, { reporterId: reporter, targetType: "profile", targetId: pid(target), reason: "spam" }));
          const r = await report(id);
          return [r.queue, r.club_id];
        };
        // Sione is in both clubs; Mia only in club 1.
        assert.deepEqual(await about(SIONE, MIA), ["club", 1]);
        // Mia can see Nam (an `everyone` profile) and shares no club with him.
        assert.deepEqual(await about(MIA, NAM), ["platform", null]);
        // Sione and Linh share club 2 only. As the owner its roles can be
        // read, so the club gets it; as the app's role for club 1 they can't
        // (row-level security), so it is not left to a club that may be
        // moderated by the person reported.
        assert.deepEqual(await about(SIONE, LINH), mode === "enforce" ? ["platform", club2] : ["club", club2]);
        await admin.query(`INSERT INTO club_roles (tenant_id, player_id, role) VALUES ($1, $2, 'admin')`, [club2, NAM]);
        try {
          assert.deepEqual(await about(SIONE, NAM), ["platform", club2], "an admin of the other club, in either mode");
        } finally {
          await admin.query(`DELETE FROM club_roles WHERE tenant_id = $1`, [club2]);
        }
      });

      test("another kind of target is reported through the loader registered for it, and its club and content come from there", async () => {
        const seen: unknown[] = [];
        const post: ReportTarget = { targetId: 41, authorId: PETE, clubId: 1, content: { body: "A post about nothing" } };
        registerReportTarget("post", async (_db, reporterId, id) => {
          seen.push([reporterId, id]);
          return id === 41 ? post : null;
        });
        assert.deepEqual(await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: 40, reason: "spam" }), NOT_FOUND);
        const { id } = value(await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: 41, reason: "child_safety" }));
        assert.deepEqual(seen, [[MIA, 40], [MIA, 41]]);
        const r = await report(id);
        assert.deepEqual([r.target_type, Number(r.target_id), r.club_id, r.queue], ["post", 41, 1, "platform"]);
        const evidence = (await rows(`SELECT * FROM moderation_evidence`))[0];
        assert.equal(evidence.author_player_id, PETE);
        assert.deepEqual(JSON.parse(seal.openEvidence(id, evidence.sealed)), { targetType: "post", targetId: 41, content: { body: "A post about nothing" } });
        // The same id as a profile's account id is another target.
        assert.deepEqual(await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: 41, reason: "spam" }), { ok: false, code: "duplicate" });
        // The author's own post: not theirs to report.
        assert.deepEqual(await fileReport(db, seal, { reporterId: PETE, targetType: "post", targetId: 41, reason: "spam" }), NOT_FOUND);
        // A post by an admin of its club goes to the platform; one with no author, and no club, too.
        registerReportTarget("post", async () => ({ targetId: 42, authorId: ADMIN, clubId: 1, content: { body: "x" } }));
        assert.equal((await report(value(await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: 42, reason: "spam" })).id)).queue, "platform");
        registerReportTarget("post", async () => ({ targetId: 43, authorId: null, clubId: 1, content: { body: "x" } }));
        assert.equal((await report(value(await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: 43, reason: "spam" })).id)).queue, "club");
        registerReportTarget("post", async () => ({ targetId: 44, authorId: PETE, clubId: null, content: { body: "x" } }));
        assert.equal((await report(value(await fileReport(db, seal, { reporterId: MIA, targetType: "post", targetId: 44, reason: "spam" })).id)).queue, "platform");
        registerReportTarget("post", null);
        assert.deepEqual(await fileReport(db, seal, { reporterId: QUINN, targetType: "post", targetId: 41, reason: "spam" }), NOT_FOUND);
        assert.throws(() => registerReportTarget("club" as never, async () => null), /target/);
      });

      test("recordAction appends one row per action, with ids and the moderator's short reason", async () => {
        const { id } = value(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "spam" }));
        assert.equal(await recordAction(db, { actorId: ADMIN, targetType: "profile", targetId: PETE, action: "hide", reason: "  spam,   three   reports ", reportId: id }), undefined);
        await recordAction(db, { actorId: ADMIN, targetType: "profile", targetId: PETE, action: "restore" });
        await recordAction(db, { actorId: null, targetType: "post", targetId: 41, action: "dismiss", reason: "" });
        const log = await rows(`SELECT actor_id, target_type, target_id::int AS target_id, action, reason, report_id::int AS report_id, created_at FROM moderation_actions ORDER BY id`);
        assert.deepEqual(
          log.map(({ created_at, ...r }) => (assert.ok(created_at instanceof Date), r)),
          [
            { actor_id: ADMIN, target_type: "profile", target_id: PETE, action: "hide", reason: "spam, three reports", report_id: id },
            { actor_id: ADMIN, target_type: "profile", target_id: PETE, action: "restore", reason: null, report_id: null },
            { actor_id: null, target_type: "post", target_id: 41, action: "dismiss", reason: null, report_id: null },
          ],
        );
        for (const action of MODERATION_ACTIONS) await recordAction(db, { actorId: ADMIN, targetType: "comment", targetId: 9, action });
        assert.equal(await count("moderation_actions"), 3 + MODERATION_ACTIONS.length);
        // What isn't an action is the caller's mistake, said before anything is written.
        const bad: Record<string, unknown>[] = [{ action: "shame" }, { targetType: "club" }, { targetId: 0 }, { targetId: "4" }, { actorId: 1.5 }, { reportId: -1 }, { reason: "x".repeat(ACTION_REASON_MAX + 1) }, { reason: 7 }];
        for (const wrong of bad) {
          await assert.rejects(recordAction(db, { actorId: ADMIN, targetType: "profile", targetId: PETE, action: "hide", ...wrong } as never), /recordAction/, JSON.stringify(wrong));
        }
        await assert.rejects(recordAction(db, { actorId: ADMIN, targetType: "profile", targetId: PETE, action: "hide", reportId: 999999 }), /moderation_actions_report_id_fkey/);
        assert.equal(await count("moderation_actions"), 3 + MODERATION_ACTIONS.length);
      });

      test("the app's role can't change or remove an action or evidence: a permission error, and the rows are as they were", async () => {
        const { id } = value(await fileReport(db, seal, { reporterId: MIA, targetType: "profile", targetId: pid(PETE), reason: "child_safety" }));
        await recordAction(db, { actorId: ADMIN, targetType: "profile", targetId: PETE, action: "suspend", reason: "child_safety", reportId: id });
        const before = await everything();
        const denied = (e: { code?: string }) => e.code === "42501";
        const statements = [
          `UPDATE moderation_actions SET reason = 'nothing happened'`,
          `UPDATE moderation_actions SET action = 'dismiss' WHERE report_id = ${id}`,
          `DELETE FROM moderation_actions`,
          `TRUNCATE moderation_actions`,
          `UPDATE moderation_evidence SET author_player_id = NULL`,
          `UPDATE moderation_evidence SET sealed = sealed`,
          `DELETE FROM moderation_evidence WHERE report_id = ${id}`,
          `TRUNCATE moderation_evidence`,
          `TRUNCATE content_reports CASCADE`,
          // The record's own id and time are the database's: the app can't choose them, so it can't back-date or reorder what was done.
          `INSERT INTO moderation_actions (id, target_type, target_id, action) OVERRIDING SYSTEM VALUE VALUES (1000000, 'profile', ${PETE}, 'restore')`,
          `INSERT INTO moderation_actions (target_type, target_id, action, created_at) VALUES ('profile', ${PETE}, 'restore', '2020-01-01')`,
          `INSERT INTO moderation_evidence (report_id, sealed, created_at) VALUES (${id}, 'v1.m1.aa.bb', '2020-01-01')`,
          `SELECT setval('moderation_actions_id_seq', 1000000)`,
        ];
        // As the app's role itself, whatever this mode connects as.
        const app = new pg.Client({ connectionString: urlFor(NAME) });
        await app.connect();
        try {
          await app.query(`SET ROLE luvallplay_app`);
          for (const statement of statements) await assert.rejects(app.query(statement), denied, statement);
          // What it may do: read both, and add.
          assert.equal((await app.query(`SELECT count(*)::int AS n FROM moderation_actions`)).rows[0].n, 1);
          assert.equal((await app.query(`SELECT count(*)::int AS n FROM moderation_evidence`)).rows[0].n, 1);
          await app.query(`INSERT INTO moderation_actions (actor_id, target_type, target_id, action, reason, report_id) VALUES ($1, 'profile', $2, 'restore', 'appeal_upheld', $3)`, [ADMIN, PETE, id]);
          const [added] = (await app.query(`SELECT id, created_at FROM moderation_actions ORDER BY id DESC LIMIT 1`)).rows;
          assert.ok(Number(added.id) < 1_000_000 && Math.abs(added.created_at.getTime() - Date.now()) < 60_000);
          await rows(`DELETE FROM moderation_actions WHERE id = $1`, [added.id]);
        } finally {
          await app.end();
        }
        // And through the app's own connection when it is that role.
        if (mode === "enforce") for (const statement of statements) await assert.rejects(db.query(statement), denied, statement);
        assert.equal(await everything(), before);
        // The report itself can be closed by the app (Task 7), and can't be deleted from under its evidence.
        await db.query(`UPDATE content_reports SET status = 'actioned', handled_at = now(), handled_by = $2 WHERE id = $1`, [id, ADMIN]);
        await assert.rejects(db.query(`DELETE FROM content_reports WHERE id = $1`, [id]), (e: { code?: string }) => e.code === "23001" || e.code === "23503");
      });
    });
  }
});
