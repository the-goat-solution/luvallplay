// Phase 3 step 4: the club's own names for things are settings, not text in
// the shared dictionaries (build plan §6.3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NEUTRAL_TERMS, currentTerms, format, setTerms, translate, type Lang } from "@luvallplay/i18n";

const arena = (lang: Lang, key: Parameters<typeof translate<"arena">>[2]) => translate("arena", lang, key);
import { applyClubTerms } from "../lib/club-terms.ts";
import { CLUB_TERMS } from "../lib/constants.ts";
import { DEFAULT_CLUB_CONFIG } from "../lib/club-config.ts";
import { DEFAULT_PUBLIC_CLUB, publicClub } from "../lib/club-public.ts";

const I18N = new URL("../../../packages/i18n/src/", import.meta.url).pathname;

test("the shared dictionaries don't name a club's own terms", () => {
  const offenders: string[] = [];
  for (const file of readdirSync(I18N).filter((f) => f.endsWith(".ts"))) {
    for (const [i, line] of readFileSync(join(I18N, file), "utf8").split("\n").entries()) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (/Wolf Points|Wolf Vision|Điểm Sói/.test(line)) offenders.push(`${file}:${i + 1}`);
    }
  }
  assert.deepEqual(offenders, [], "write {pointsName} or {visionName} instead");
});

test("Three Wolves reads exactly as before", () => {
  applyClubTerms(CLUB_TERMS);
  assert.equal(arena("en", "wp_title"), "Wolf Points");
  assert.equal(arena("en", "how_title"), "How Wolf Points work");
  // Vietnamese keeps its own wording for the points.
  assert.equal(arena("vi", "wp_title"), "Điểm Sói");
  assert.equal(arena("vi", "how_title"), "Điểm Sói hoạt động thế nào");
  assert.equal(translate("profile", "vi", "lb_wp"), "Điểm Sói");
  assert.equal(translate("profile", "en", "tab_wolfvision"), "Wolf Vision");
  assert.equal(translate("profile", "vi", "tab_wolfvision"), "Wolf Vision");
  assert.deepEqual(DEFAULT_CLUB_CONFIG.terms, CLUB_TERMS);
  assert.deepEqual(DEFAULT_PUBLIC_CLUB.terms, CLUB_TERMS);
  assert.deepEqual(publicClub(DEFAULT_CLUB_CONFIG).terms, CLUB_TERMS);
});

test("another club's names appear in both languages, and nothing of Three Wolves' is left", () => {
  try {
    applyClubTerms({ pointsName: "Luv Points", visionName: "Vision" });
    assert.equal(arena("en", "wp_title"), "Luv Points");
    assert.equal(arena("en", "how_title"), "How Luv Points work");
    // No Vietnamese name of its own: the club's name is used, never Three Wolves'.
    assert.equal(arena("vi", "wp_title"), "Luv Points");
    assert.match(arena("vi", "ranks_sub"), /Luv Points/);
    applyClubTerms({ pointsName: "Luv Points", visionName: "Vision", localized: { vi: { pointsName: "Điểm Luv" } } });
    assert.equal(arena("vi", "wp_title"), "Điểm Luv");
    assert.equal(arena("en", "wp_title"), "Luv Points");
    assert.equal(translate("profile", "en", "tab_wolfvision"), "Vision");
    // The caller's own values are still filled, and win over nothing.
    assert.equal(format("{n} {pointsName}", { n: 5 }), "5 Luv Points");
    assert.equal(format("{missing} stays"), "{missing} stays");
    // An empty name falls back to the platform's neutral one.
    setTerms({ pointsName: "", visionName: "" });
    assert.deepEqual(currentTerms(), { ...NEUTRAL_TERMS, localized: {} });
    assert.equal(arena("en", "wp_title"), "Points");
  } finally {
    applyClubTerms(CLUB_TERMS);
  }
});

test("migration 0008 stores Three Wolves' Vietnamese name, and the stored settings equal the built-in ones", { skip: !process.env.DATA_GUARD_TEST_URL ? "set DATA_GUARD_TEST_URL" : false }, async () => {
  const { default: pg } = await import("pg");
  const { migrate } = await import("../scripts/db/migrate.mjs");
  const { compareClubConfig } = await import("../lib/club-config.ts");
  const name = `club_terms_${process.pid}`;
  const urlFor = (db: string) => {
    const u = new URL(process.env.DATA_GUARD_TEST_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const admin = new pg.Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  const c = new pg.Client({ connectionString: urlFor(name) });
  await c.connect();
  try {
    await migrate(c, { log: () => {} });
    const { rows } = await c.query(`SELECT terms FROM tenants WHERE slug = 'three-wolves'`);
    assert.deepEqual(rows[0].terms, { points_name: "Wolf Points", vision_name: "Wolf Vision", localized: { vi: { points_name: "Điểm Sói" } } });
    const report = await compareClubConfig(c);
    assert.deepEqual({ stored: report.stored, problems: report.problems, differences: report.differences }, { stored: true, problems: [], differences: [] });
  } finally {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});
