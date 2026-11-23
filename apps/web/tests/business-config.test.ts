// Business config moved from Sanity to the database (Phase 2 PR 6).
//
// The values must arrive exactly: migration 0002's rows are compared with the
// published Sanity documents (tests/fixtures/business-config/
// sanity-2026-11-23.json, read 23 Nov 2026), both as data (every field of
// every plan, Stripe price ids included) and as the site renders them in
// English and Vietnamese. Before the migration runs (expand), the readers
// report "not in the database" so the site keeps using Sanity.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import pg from "pg";
import { loadMigrations, migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const SNAPSHOT = JSON.parse(readFileSync(new URL("./fixtures/business-config/sanity-2026-11-23.json", import.meta.url), "utf8"));
const NAME = `business_config_${process.pid}`;
const BEFORE = `business_config_before_${process.pid}`;

type Loc = { en?: string; vi?: string };
const strip = (o: unknown): Loc | undefined => {
  const v = (o ?? {}) as Loc;
  const out: Loc = {};
  if (v.en) out.en = v.en;
  if (v.vi) out.vi = v.vi;
  return out.en || out.vi ? out : undefined;
};

/** The snapshot as lib/sanity-queries.ts fetchPricingPlans() hands it to the app. */
function sanityPlans() {
  return SNAPSHOT.plans.map((r: Record<string, unknown>) => ({
    planId: r.planId,
    name: r.name,
    description: r.description,
    priceNzd: r.priceNzd,
    periodLabel: r.periodLabel,
    featured: r.featured,
    features: r.features,
    stripePriceId: r.stripePriceId,
  }));
}
/** Same plan, compared field by field with "absent" and "empty" treated alike (as the site does). */
function canonical(p: Record<string, unknown>) {
  const features = ((p.features as unknown[]) ?? []).map(strip).filter(Boolean);
  return {
    planId: p.planId,
    name: strip(p.name) ?? null,
    description: strip(p.description) ?? null,
    priceNzd: p.priceNzd ?? null,
    periodLabel: strip(p.periodLabel) ?? null,
    featured: Boolean(p.featured),
    features,
    stripePriceId: p.stripePriceId ?? null,
  };
}

function urlFor(db: string) {
  const u = new URL(BASE_URL!);
  u.pathname = `/${db}`;
  u.hostname = "localhost";
  return u.toString();
}
async function admin(sql: string) {
  const c = new pg.Client({ connectionString: urlFor("postgres") });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

describe("business config: Sanity → database", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let proxy: ChildProcess | null = null;
  let bc: typeof import("../lib/business-config.ts");

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    for (const [db, upTo] of [[NAME, Infinity], [BEFORE, 2]] as const) {
      await admin(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin(`CREATE DATABASE ${db}`);
      const c = new pg.Client({ connectionString: urlFor(db) });
      await c.connect();
      await migrate(c, { migrations: loadMigrations().slice(0, upTo), log: () => {} });
      await c.end();
    }
    const port = String(await (await import("./golden/free-port.ts")).freePort());
    proxy = spawn(process.execPath, ["scripts/e2e/ws-proxy.mjs", port, new URL(BASE_URL!).port || "5432"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 500));
    const { pointDriversAt } = await import("./golden/local-drivers.ts");
    await pointDriversAt(`localhost:${port}`);
    process.env.POSTGRES_URL = urlFor(NAME);
    bc = await import("../lib/business-config.ts");
  });

  after(async () => {
    const { closeDatabase } = await import("../lib/database.ts");
    await closeDatabase();
    proxy?.kill("SIGTERM");
    await admin(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin(`DROP DATABASE IF EXISTS ${BEFORE} WITH (FORCE)`);
  });

  test("the snapshot is the published Sanity content (no drafts) with all five plans", () => {
    assert.match(SNAPSHOT.source, /published/);
    assert.deepEqual(SNAPSHOT.plans.map((p: { planId: string }) => p.planId), ["casual", "fridayMonthly", "fridayQuarterly", "wednesdayMonthly", "wednesdayQuarterly"]);
    assert.equal(SNAPSHOT.schedule.length, 1);
  });

  test("every plan arrived exactly: names, texts, prices, features, featured, Stripe price ids, order", async () => {
    const fromDb = await bc.loadPricingPlansFromDb();
    assert.ok(fromDb);
    assert.deepEqual(fromDb.map(canonical), sanityPlans().map(canonical));
    // Stripe price ids, spelled out: these decide what members are charged.
    assert.deepEqual(
      fromDb.map((p) => [p.planId, p.stripePriceId]),
      SNAPSHOT.plans.map((p: { planId: string; stripePriceId: string }) => [p.planId, p.stripePriceId]),
    );
  });

  test("the site renders the plans identically in English and Vietnamese", async () => {
    const { resolveAllPlanDisplays } = await import("../lib/pricing-plans.ts");
    const { t } = await import("../lib/i18n.ts");
    const fromDb = await bc.loadPricingPlansFromDb();
    for (const lang of ["en", "vi"] as const) {
      const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
      assert.deepEqual(resolveAllPlanDisplays(fromDb, lang, tr), resolveAllPlanDisplays(sanityPlans(), lang, tr), `rendered plans differ (${lang})`);
    }
  });

  test("session settings arrived: capacity unset (built-in default) and booking lock 14 days", async () => {
    assert.deepEqual(await bc.loadClubSetting("max_casual_spots"), { found: true, value: SNAPSHOT.schedule[0].maxCasualSpots ?? null });
    assert.deepEqual(await bc.loadClubSetting("booking_lock_days"), { found: true, value: SNAPSHOT.schedule[0].bookingLockDays });
    assert.equal(await bc.getMaxCasualSpots(undefined), null);
  });

  test("edits from Admin → Settings are stored and read back", async () => {
    await bc.savePricingPlan(
      {
        planId: "casual",
        name: { en: "CASUAL", vi: "ĐÁNH LẺ" },
        description: { en: "Pay per session", vi: "" },
        periodLabel: { en: "PER SESSION", vi: "MỖI BUỔI" },
        priceNzd: 12.5,
        featured: false,
        features: [{ en: "Court", vi: "Sân" }, { en: "", vi: "" }],
        stripePriceId: "price_testGolden123",
        sort: 1,
      },
      1,
    );
    const casual = (await bc.loadPricingPlansFromDb())!.find((p) => p.planId === "casual")!;
    assert.equal(casual.priceNzd, 12.5);
    assert.deepEqual(casual.description, { en: "Pay per session" });
    assert.deepEqual(casual.features, [{ en: "Court", vi: "Sân" }]);
    assert.equal(casual.stripePriceId, "price_testGolden123");
    await bc.saveClubSetting("max_casual_spots", 20, 1);
    assert.equal(await bc.getMaxCasualSpots(12), 20);
  });

  test("before migration 0002 has run, the readers say 'not in the database' (the site keeps using Sanity)", async () => {
    const { closeDatabase } = await import("../lib/database.ts");
    await closeDatabase();
    process.env.POSTGRES_URL = urlFor(BEFORE);
    try {
      assert.equal(await bc.loadPricingPlansFromDb(), null);
      assert.deepEqual(await bc.loadClubSetting("booking_lock_days"), { found: false, value: null });
      assert.equal(await bc.getMaxCasualSpots(16), 16);
    } finally {
      await closeDatabase();
      process.env.POSTGRES_URL = urlFor(NAME);
    }
  });
});
