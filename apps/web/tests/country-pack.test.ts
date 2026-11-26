// Track V: the Vietnam country pack (build plan §6.9, §11.4; test plan §3.16
// "every pack passes the same checklist ... A pack without the full
// checklist can't be selected in the wizard").

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { COUNTRY_PACKS, VN_PACK } from "@luvallplay/core/country-pack-vn";
import {
  calledName,
  countryPackChecklist,
  countryPackSelectable,
  familyName,
  formatPackPhone,
  formatPackPhoneNational,
  isPackMobile,
  nameSortKey,
  packPhoneToE164,
  searchPeople,
  shownName,
  sortByName,
  sportWord,
  type CountryPack,
} from "@luvallplay/core/country-pack";
import { currencyExponent, formatMoney, toMinor } from "@luvallplay/core/money";
import { REGIONS } from "@luvallplay/core/host-routing";
import { SQL_FOLD, foldForSearch, sqlFold } from "@luvallplay/core/text-fold";
import { buildVietQR, parseVietQR } from "@luvallplay/core/vietqr";
import { makeReference, matchTransfer } from "@luvallplay/core/vietqr-match";
import { loadMigrations, migrate } from "../scripts/db/migrate.mjs";
import { VN_TEST_CLUB, VN_TEST_MEMBERS, seedVietnamTestClub } from "./fixtures/vn-club.ts";

// ── The pack's values ───────────────────────────────────────────────────────

test("Vietnam: dong with no minor unit, Ho Chi Minh time, Vietnamese first, the Hanoi region", () => {
  assert.equal(VN_PACK.country, "VN");
  assert.equal(VN_PACK.currency, "VND");
  assert.equal(currencyExponent(VN_PACK.currency), 0);
  assert.equal(toMinor("400000", VN_PACK.currency), 400000);
  assert.equal(toMinor("400000.5", VN_PACK.currency), null, "half a dong doesn't exist");
  assert.equal(formatMoney(400000, VN_PACK.currency, { group: true }), "400.000 ₫");
  assert.equal(VN_PACK.timezone, "Asia/Ho_Chi_Minh");
  assert.deepEqual(VN_PACK.languages, ["vi", "en"]);
  assert.equal(VN_PACK.region, "han");
  assert.ok((REGIONS as readonly string[]).includes(VN_PACK.region));
  assert.equal(COUNTRY_PACKS.VN, VN_PACK);
});

test("Ho Chi Minh time is UTC+7 all year", () => {
  const hour = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: VN_PACK.timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  assert.equal(hour("2027-01-15T00:00:00Z"), "07");
  assert.equal(hour("2027-07-15T00:00:00Z"), "07");
  // A Friday 19:00 session in Hanoi is still Friday there when it is already Saturday in Auckland.
  const day = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, dateStyle: "short" }).format(new Date("2027-01-15T12:00:00Z"));
  assert.equal(day(VN_PACK.timezone), "2027-01-15");
  assert.equal(day("Pacific/Auckland"), "2027-01-16");
});

// ── +84 phones ──────────────────────────────────────────────────────────────

test("+84: every usual way of typing a mobile gives the same number", () => {
  for (const typed of ["0912 345 678", "0912345678", "912345678", "+84 912 345 678", "+84912345678", "84912345678", "84 912 345 678", "0084 912 345 678", "+84 0912 345 678", "(+84) 912-345-678", "0912.345.678"]) {
    assert.equal(packPhoneToE164(typed, VN_PACK), "+84912345678", typed);
  }
  assert.equal(packPhoneToE164("", VN_PACK), null);
  assert.equal(packPhoneToE164(null, VN_PACK), null);
  assert.equal(packPhoneToE164("abc", VN_PACK), null);
  assert.equal(packPhoneToE164("12", VN_PACK), null);
});

test("+84: mobiles start 3, 5, 7, 8 or 9 and have nine digits; landlines and other countries aren't texted", () => {
  for (const ok of ["+84312345678", "+84512345678", "+84712345678", "+84812345678", "+84912345678"]) assert.equal(isPackMobile(ok, VN_PACK), true, ok);
  for (const no of ["+84212345678", "+8491234567", "+849123456789", "+84112345678", "+64211234567", "0912345678", "", null, undefined]) assert.equal(isPackMobile(no, VN_PACK), false, String(no));
  // A Hanoi landline is a number, just not a mobile.
  assert.equal(packPhoneToE164("024 3825 1234", VN_PACK), "+842438251234");
  assert.equal(isPackMobile("+842438251234", VN_PACK), false);
  // A New Zealander's number typed in full stays theirs.
  assert.equal(packPhoneToE164("+64 21 123 4567", VN_PACK), "+64211234567");
  // The old 11-digit mobiles (0162…) are gone since 2018.
  assert.equal(isPackMobile(packPhoneToE164("01623456789", VN_PACK), VN_PACK), false);
});

test("+84: shown grouped, internationally and the way it's written in Vietnam", () => {
  assert.equal(formatPackPhone("+84912345678", VN_PACK), "+84 912 345 678");
  assert.equal(formatPackPhoneNational("+84912345678", VN_PACK), "0912 345 678");
  assert.equal(formatPackPhone("+64211234567", VN_PACK), "+64211234567");
  assert.equal(formatPackPhoneNational("+842438251234", VN_PACK), "+842438251234");
  assert.equal(packPhoneToE164(formatPackPhoneNational("+84387654321", VN_PACK), VN_PACK), "+84387654321");
});

// ── Names ───────────────────────────────────────────────────────────────────

test("family-name-first: called by the given name, shown as written", () => {
  assert.equal(calledName("Nguyễn Thị Hương", "family-first"), "Hương");
  assert.equal(familyName("Nguyễn Thị Hương", "family-first"), "Nguyễn");
  assert.equal(calledName("  Trần   Văn  An ", "family-first"), "An");
  assert.equal(calledName("Hương", "family-first"), "Hương");
  assert.equal(familyName("Hương", "family-first"), "");
  assert.equal(calledName("", "family-first"), "");
  // The same helpers for given-first names (New Zealand, Australia).
  assert.equal(calledName("Mai Tran", "given-first"), "Mai");
  assert.equal(familyName("Mai Tran", "given-first"), "Tran");
  // A display name wins; the full name is never reordered or stripped of accents.
  assert.equal(shownName({ fullName: "Nguyễn Thị Hương", displayName: "Hương Nguyễn" }), "Hương Nguyễn");
  assert.equal(shownName({ fullName: " Nguyễn  Thị Hương ", displayName: " " }), "Nguyễn Thị Hương");
  assert.equal(shownName({ fullName: "Nguyễn Thị Hương" }), "Nguyễn Thị Hương");
});

test("lists sort by the called name, with accents not deciding the order", () => {
  const people = ["Nguyễn Văn An", "Trần Thị Ánh", "Lê Đức Anh", "Đặng Văn Dũng", "Phạm Thị Đào", "Bùi Hữu Bình"].map((fullName) => ({ fullName }));
  assert.deepEqual(sortByName(people, "family-first").map((p) => p.fullName), ["Nguyễn Văn An", "Lê Đức Anh", "Trần Thị Ánh", "Bùi Hữu Bình", "Phạm Thị Đào", "Đặng Văn Dũng"]);
  assert.equal(nameSortKey("Nguyễn Thị Hương", "family-first"), "huong nguyen thi");
  assert.equal(nameSortKey("Mai Tran", "given-first"), "mai tran");
  assert.deepEqual(sortByName(people, "given-first")[0].fullName, "Bùi Hữu Bình");
});

test('accent-insensitive search: "nguyen" finds "Nguyễn"', () => {
  const people = VN_TEST_MEMBERS.map((m) => ({ fullName: m.fullName, displayName: m.called }));
  const nguyen = people.filter((p) => p.fullName.startsWith("Nguyễn"));
  assert.ok(nguyen.length >= 3);
  assert.deepEqual(searchPeople(people, "nguyen"), nguyen);
  assert.deepEqual(searchPeople(people, "NGUYEN"), nguyen);
  assert.deepEqual(searchPeople(people, "Nguyễn"), nguyen);
  assert.deepEqual(searchPeople(people, "nguyễn".normalize("NFD")), nguyen, "typed with combining marks, as some phone keyboards do");
  assert.deepEqual(searchPeople(people, "dang"), people.filter((p) => p.fullName.startsWith("Đặng")), "đ is found by d");
  // Words in any order, each without its accents: "<given> nguyen" finds that Nguyễn.
  const someone = VN_TEST_MEMBERS.find((m) => m.family === "Nguyễn" && foldForSearch(m.called) !== m.called.toLowerCase())!;
  const found = searchPeople(people, `${foldForSearch(someone.called)} nguyen`);
  assert.ok(found.some((p) => p.fullName === someone.fullName));
  assert.ok(found.every((p) => p.fullName.startsWith("Nguyễn")));
  assert.deepEqual(searchPeople(people, "zzz"), []);
  assert.deepEqual(searchPeople(people, ""), []);
});

// ── Sport words ─────────────────────────────────────────────────────────────

test("sport vocabulary hooks: Vietnamese words per sport, null where there are none", () => {
  assert.equal(sportWord(VN_PACK, "badminton", "court"), "sân");
  assert.equal(sportWord(VN_PACK, "badminton", "doubles"), "đánh đôi");
  assert.equal(sportWord(VN_PACK, "pickleball", "match"), "trận");
  assert.equal(sportWord(VN_PACK, "futsal", "court"), null, "no pack wording: the caller uses the neutral word");
  for (const v of VN_PACK.sportVocabulary) for (const [k, w] of Object.entries(v)) if (w !== null) assert.ok(w.trim().length > 0, `${v.sport}.${k}`);
  for (const sport of VN_TEST_CLUB.sports) assert.ok(VN_PACK.sportVocabulary.some((v) => v.sport === sport), sport);
});

// ── The checklist ───────────────────────────────────────────────────────────

test("the checklist: Vietnam passes everything except what waits for counsel, so it can't be chosen yet", () => {
  const list = countryPackChecklist(VN_PACK);
  assert.deepEqual(list.map((i) => i.item).sort(), ["currency", "legal", "payments", "phone", "region", "search", "tax", "timezone"]);
  assert.deepEqual(list.filter((i) => !i.ok).map((i) => i.item).sort(), ["legal", "tax"]);
  for (const i of list) assert.equal(Boolean(i.why), !i.ok, i.item);
  assert.equal(countryPackSelectable(VN_PACK), false);
});

test("the checklist: each item fails for the right reason, and a complete pack is selectable", () => {
  const complete: CountryPack = {
    ...VN_PACK,
    tax: { ...VN_PACK.tax, standardRate: 10, confirmed: "counsel, 2027-01-01" },
    legal: { terms: "/legal/vn/terms", privacy: "/legal/vn/privacy", minimumAccountAge: 16, confirmed: "counsel, 2027-01-01" },
  };
  assert.equal(countryPackSelectable(complete), true);
  const failing = (change: Partial<CountryPack>) => countryPackChecklist({ ...complete, ...change }).filter((i) => !i.ok).map((i) => i.item);
  assert.deepEqual(failing({ currency: "XXX" }), ["currency", "payments"]);
  assert.deepEqual(failing({ region: "mars" }), ["region"]);
  assert.deepEqual(failing({ timezone: "Asia/Nowhere" }), ["timezone"]);
  assert.deepEqual(failing({ phone: { ...VN_PACK.phone, example: "12" } }), ["phone"]);
  assert.deepEqual(failing({ tax: { ...complete.tax, confirmed: null } }), ["tax"]);
  assert.deepEqual(failing({ legal: { ...complete.legal, privacy: null } }), ["legal"]);
  assert.deepEqual(failing({ payments: { ...complete.payments, providers: [] } }), ["payments"]);
});

test("payments: VietQR bank transfer in dong; MoMo only planned, with nothing to switch on", () => {
  assert.deepEqual(VN_PACK.payments.providers.map((p) => p.id), ["vietqr"]);
  assert.deepEqual(VN_PACK.payments.providers[0].capabilities.currencies, ["VND"]);
  assert.equal(VN_PACK.payments.providers[0].capabilities.recurring, false);
  assert.deepEqual(VN_PACK.payments.planned.map((p) => p.id), ["momo"]);
  assert.equal(VN_PACK.payments.bankFeed, null);
  assert.ok(!JSON.stringify(VN_PACK).toLowerCase().includes("stripe"), "Stripe isn't an option in Vietnam (§6.5)");
});

test("the demo club's membership: a VietQR code in dong that a transfer then matches", () => {
  const reference = makeReference(42);
  const code = buildVietQR({ bankBin: VN_TEST_CLUB.bank.bin, account: VN_TEST_CLUB.bank.account, accountName: VN_TEST_CLUB.bank.accountName, amount: VN_TEST_CLUB.monthlyFee, note: reference });
  const parsed = parseVietQR(code);
  assert.equal(parsed.amount, 400000);
  assert.equal(parsed.note, reference);
  const expected = [{ reference, amount: VN_TEST_CLUB.monthlyFee, paid: false }];
  assert.deepEqual(matchTransfer({ id: "FT27015", amount: 400000, note: `NGUYEN THI HUONG chuyen tien ${reference}` }, expected), { kind: "matched", reference });
});

test("the demo members are synthetic and well-formed", () => {
  assert.equal(VN_TEST_MEMBERS.length, 36);
  assert.equal(new Set(VN_TEST_MEMBERS.map((m) => m.email)).size, 36);
  assert.equal(new Set(VN_TEST_MEMBERS.map((m) => m.phone)).size, 36);
  for (const m of VN_TEST_MEMBERS) {
    assert.match(m.email, /@example\.com$/);
    assert.equal(isPackMobile(m.phone, VN_PACK), true, m.phone);
    assert.equal(m.fullName.split(" ").length, 3);
  }
});

// ── The same search inside Postgres ─────────────────────────────────────────

test("the SQL folding is built from the same rule, one letter for one", () => {
  assert.equal(SQL_FOLD.from.length, SQL_FOLD.to.length);
  assert.equal([...SQL_FOLD.from].length, SQL_FOLD.from.length, "no letter outside the basic plane");
  assert.ok(!/['\\]/.test(SQL_FOLD.from + SQL_FOLD.to));
  for (const c of "ăâđêôơưễạ" + "ĂÂĐÊÔƠƯỄẠ") assert.ok(SQL_FOLD.from.includes(c), c);
  assert.throws(() => sqlFold("name); DROP TABLE players; --"), /column name or a placeholder/);
  assert.throws(() => sqlFold("'x'"));
  assert.ok(sqlFold("p.display_name").includes("p.display_name"));
  assert.ok(sqlFold("$1").includes("$1"));
});

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `vn_pack_${process.pid}`;
const urlFor = (db: string) => {
  const u = new URL(BASE_URL!);
  u.pathname = `/${db}`;
  return u.toString();
};

describe("a Vietnamese club in a real database", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let tenantId = 0;
  const fullNameSql = `${sqlFold("p.last_name")} || ' ' || ${sqlFold("p.first_name")}`;
  const search = async (typed: string) =>
    (
      await c.query(
        `SELECT p.last_name || ' ' || p.first_name AS name FROM players p JOIN club_members m ON m.user_id = p.id
         WHERE m.tenant_id = $2 AND ${fullNameSql} LIKE '%' || ${sqlFold("$1")} || '%' ORDER BY p.id`,
        [typed, tenantId],
      )
    ).rows.map((r) => r.name as string);

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.end();
    c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();
    await migrate(c, { migrations: loadMigrations(), log: () => {} });
    tenantId = await seedVietnamTestClub(c);
  });

  after(async () => {
    await c?.end();
    if (!BASE_URL) return;
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("the club is its own tenant: Vietnam, Hanoi region, dong, Ho Chi Minh time, and not Three Wolves", async () => {
    const t = (await c.query("SELECT * FROM tenants WHERE id = $1", [tenantId])).rows[0];
    assert.notEqual(tenantId, 1);
    assert.deepEqual([t.country, t.region, t.currency, t.timezone, t.status], ["VN", "han", "VND", "Asia/Ho_Chi_Minh", "setup"]);
    assert.deepEqual(t.languages, ["vi", "en"]);
    const members = (await c.query("SELECT count(*)::int AS n FROM club_members WHERE tenant_id = $1", [tenantId])).rows[0].n;
    assert.equal(members, VN_TEST_MEMBERS.length);
    const inThreeWolves = (await c.query("SELECT count(*)::int AS n FROM club_members m JOIN players p ON p.id = m.user_id WHERE m.tenant_id = 1 AND p.email LIKE 'vn-demo-%'")).rows[0].n;
    assert.equal(inThreeWolves, 0);
  });

  test('"nguyen" finds "Nguyễn", in SQL exactly as in the app', async () => {
    const want = (typed: string) => VN_TEST_MEMBERS.filter((m) => foldForSearch(m.fullName).includes(foldForSearch(typed))).map((m) => m.fullName);
    for (const typed of ["nguyen", "NGUYEN", "Nguyễn", "nguyễn".normalize("NFD"), "dang", "Đặng", "huong", "thi h", "vo", "zzz"]) {
      assert.deepEqual(await search(typed), want(typed), typed);
    }
    assert.ok((await search("nguyen")).length >= 3);
    assert.ok((await search("nguyen")).every((n) => n.startsWith("Nguyễn")));
  });

  test("Postgres and the app fold every Vietnamese letter the same way", async () => {
    const letters: string[] = [];
    for (const v of "aăâeêioôơuưyd") for (const t of ["", "\u0300", "\u0301", "\u0309", "\u0303", "\u0323"]) for (const s of [v, v.toUpperCase()]) letters.push((s + t).normalize("NFC"), (s + t).normalize("NFD"));
    letters.push("đ", "Đ", "  Nguyễn   Thị\tHương ", ...VN_TEST_MEMBERS.map((m) => m.fullName), ...VN_TEST_MEMBERS.map((m) => m.fullName.toUpperCase()));
    const rows = (await c.query(`SELECT t AS raw, ${sqlFold("t")} AS folded FROM unnest($1::text[]) AS t`, [letters])).rows;
    assert.equal(rows.length, letters.length);
    for (const r of rows) assert.equal(r.folded, foldForSearch(r.raw as string), JSON.stringify(r.raw));
  });

  test("the demo club refuses a database that isn't named as a test database", async () => {
    const fake = { query: async () => ({ rows: [{ db: "neondb" }] }) };
    await assert.rejects(seedVietnamTestClub(fake), /test databases only/);
    const prod = { query: async () => ({ rows: [{ db: "verceldb" }] }) };
    await assert.rejects(seedVietnamTestClub(prod), /test databases only/);
  });
});
