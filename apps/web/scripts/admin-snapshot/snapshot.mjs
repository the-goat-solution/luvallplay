// Before/after proof that a refactor leaves the admin unchanged (Track A,
// build plan §6.2.4: "Three Wolves' admin must look and behave identically").
//
// Starts the end-to-end environment (local Postgres, the built app, synthetic
// people: scripts/e2e/env.mjs), signs in as the owner, an admin and a coach,
// and for every page in each person's menu writes the menu's HTML, the page's
// text and a full-page screenshot at a desktop and a phone width.
//
//   pnpm build && node scripts/admin-snapshot/snapshot.mjs <out-dir>
//
// Run it on main and on the branch (same day, so dates match), then:
//
//   node scripts/admin-snapshot/compare.mjs <before-dir> <after-dir>
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import pg from "pg";
import { PEOPLE, startEnv } from "../e2e/env.mjs";

// Playwright is preinstalled globally (resolved through NODE_PATH, which only require() uses).
const { chromium } = createRequire(import.meta.url)("playwright");

const out = process.argv[2];
if (!out) throw new Error("usage: snapshot.mjs <out-dir>");
mkdirSync(out, { recursive: true });

const WIDTHS = [1200, 375];
// Pages that aren't in anyone's menu but belong to the admin.
const EXTRA = ["/admin/day-requests", "/admin/device-check", "/admin/people/audit"];

const env = await startEnv({ log: () => {} });
const browser = await chromium.launch();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
let failed = false;
try {
  for (const who of ["owner", "admin", "coach"]) {
    const { rows } = await db.query(`SELECT id FROM players WHERE email = $1`, [PEOPLE[who].email]);
    const token = randomBytes(32).toString("base64url");
    await db.query(
      `INSERT INTO player_sessions (player_id, token_hash, user_agent, expires_at) VALUES ($1, $2, 'snapshot', NOW() + INTERVAL '1 day')`,
      [rows[0].id, createHash("sha256").update(token).digest("hex")],
    );
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, baseURL: env.base });
    await context.addCookies([{ name: "tw_player", value: token, url: env.base }]);
    const page = await context.newPage();
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    const menu = await page.locator("#admin-sidebar nav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    if (menu.length === 0) throw new Error(`${who} sees no admin menu at ${page.url()}`);
    for (const href of [...menu, ...EXTRA]) {
      const name = `${who}${href.replace(/\//g, "_")}`;
      const res = await page.goto(href);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      const sidebar = await page.locator("#admin-sidebar").evaluate((el) => el.outerHTML).catch(() => "(no admin menu)");
      const main = await page.locator("main").first().innerText().catch(() => "(no page)");
      const title = await page.locator("header").first().innerText().catch(() => "");
      writeFileSync(`${out}/${name}.txt`, [`status ${res?.status()} at ${new URL(page.url()).pathname}`, `top bar: ${title}`, "", sidebar, "", main, ""].join("\n"));
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: w < 600 ? 812 : 900 });
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: true, animations: "disabled" });
      }
      await page.setViewportSize({ width: 1200, height: 900 });
    }
    // The phone menu, open.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/admin");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${who}_menu-open-375.png`, animations: "disabled" });
    await context.close();
    console.log(`${who}: ${menu.length} menu pages + ${EXTRA.length} others`);
  }
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await db.end();
  await browser.close();
  env.stop();
}
process.exit(failed ? 1 : 0);
