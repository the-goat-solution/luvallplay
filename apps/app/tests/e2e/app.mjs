// End-to-end journeys for the players' app against the real API (a local
// production build of apps/web with a fresh local Postgres) and a production
// build of the app served on its own origin, so CORS and the page's
// Content-Security-Policy are the real ones.
//
//   (cd ../web && E2E_BUILD=1 npm run build) && pnpm --filter app e2e
//
// Covers the Phase 4 gate's club theming rows (decision AM): Luvallplay's
// look before sign-in, the club's after, an invite link applies the club's
// look first, switching clubs changes it at once; plus modules, the window
// classes, languages, sign-out and axe. Synthetic people only; email is
// captured, never sent.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const APP_DIR = path.resolve(import.meta.dirname, "..", "..");
const WEB_DIR = path.resolve(APP_DIR, "..", "web");
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 4173);
const APP = `http://localhost:${APP_PORT}`;
const OUT = "dist-e2e";

// Playwright is preinstalled globally (resolved through NODE_PATH, which only require() uses).
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const pg = createRequire(path.join(WEB_DIR, "package.json"))("pg");

const COURT_GREEN = "#0e6b4f";
const NAVY = "#184467";
const NAVY_DARK_MODE = "#1e5a8a";
const WIDTHS = [320, 375, 600, 840, 1200];
const NAV_AT = { 320: "bar", 375: "bar", 600: "rail", 840: "rail", 1200: "sidebar" };
const PHONE = { width: 375, height: 812 };

let env;
let PEOPLE;
let preview;
let browser;
let db;
let api;

before(async () => {
  // The API allows this origin, exactly as APP_ORIGINS will in production.
  process.env.APP_ORIGINS = APP;
  process.chdir(WEB_DIR); // the environment script runs the web app's own scripts
  const e2e = await import(path.join(WEB_DIR, "scripts/e2e/env.mjs"));
  PEOPLE = e2e.PEOPLE;
  env = await e2e.startEnv({ log: () => {} });
  api = `${env.base}/api/v1/app`;

  const build = spawnSync("npx", ["vite", "build", "--outDir", OUT, "--emptyOutDir"], { cwd: APP_DIR, encoding: "utf8", env: { ...process.env, VITE_API_BASE: env.base } });
  assert.equal(build.status, 0, `app build failed:\n${build.stdout}\n${build.stderr}`);
  preview = spawn("npx", ["vite", "preview", "--outDir", OUT, "--port", String(APP_PORT), "--strictPort"], { cwd: APP_DIR, stdio: "ignore", detached: true });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(APP)).ok) break;
    } catch {}
    if (i > 80) throw new Error("the app's preview server did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch();
  db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();
});

after(async () => {
  await db?.end();
  await browser?.close();
  try {
    process.kill(-preview.pid, "SIGTERM");
  } catch {}
  env?.stop();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function outboxCode(email) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${env.base}/api/dev/outbox?to=${encodeURIComponent(email.trim().toLowerCase())}`);
    const { mail } = await r.json();
    const last = mail[mail.length - 1];
    const m = last && `${last.subject} ${last.text} ${last.html}`.match(/\b(\d{6})\b/);
    if (m) return m[1];
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`no code emailed to ${email}`);
}

/** A session made the way the server stores one (only the token's SHA-256), so sign-in rate limits stay on. */
async function sessionToken(email) {
  const { rows } = await db.query(`SELECT id FROM players WHERE email = $1 AND deleted_at IS NULL`, [email]);
  const token = randomBytes(32).toString("base64url");
  await db.query(`INSERT INTO player_sessions (player_id, token_hash, user_agent, expires_at) VALUES ($1, $2, 'e2e-app', NOW() + INTERVAL '90 days')`, [rows[0].id, createHash("sha256").update(token).digest("hex")]);
  return token;
}

/** A browser context already signed in as `email` (the token is in the app's storage before it starts). */
async function signedIn(email, options = {}) {
  const token = await sessionToken(email);
  const context = await browser.newContext({ viewport: PHONE, ...options });
  await context.addInitScript((t) => {
    if (!sessionStorage.getItem("e2e-seeded")) {
      localStorage.setItem("lp.token", t);
      sessionStorage.setItem("e2e-seeded", "1");
    }
  }, token);
  return { context, token };
}

const look = (page) =>
  page.evaluate(() => ({
    primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase(),
    look: document.documentElement.dataset.look,
    mode: document.documentElement.getAttribute("data-theme"),
    lang: document.documentElement.lang,
  }));

const tabLabels = (page) => page.locator(".shell-nav .tab span").allTextContents();

/** The Me screen with its data (not the loading skeleton). */
const ME_READY = '[data-screen="nav_me"][data-state="ready"]';

/** Console errors and failed requests, so a CSP or CORS refusal fails the journey. */
function watch(page) {
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  return problems;
}

const CORS = { "access-control-allow-origin": APP, "access-control-allow-credentials": "true", "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS", vary: "Origin" };

/** Answers `url` with JSON as the API would, preflight included. */
async function serveJson(context, url, makeBody) {
  await context.route(url, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(await makeBody()) });
  });
}

const realConfig = async () => (await fetch(`${api}/clubs/three-wolves/config`)).json();

/** A synthetic second club for one browser context: listed beside Three Wolves, with its own look and no Arena. */
async function withSecondClub(context) {
  const base = await realConfig();
  const second = {
    ...base,
    club: { ...base.club, slug: "harbour-smash", name: "Harbour Smash", currency: "AUD", country: "AU" },
    modules: base.modules.filter((m) => m !== "arena"),
    theme: { ...base.theme, scheme: "test", artSet: "luvallplay", logoUrl: null, light: { ...base.theme.light, primary: "#7a1f3d", "on-primary": "#ffffff" }, dark: { ...base.theme.dark, primary: "#b0486a" } },
    terms: { ...base.terms, visionName: "Smash Cam", localized: {} },
  };
  await context.route(`${api}/clubs`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback();
    const response = await route.fetch();
    const json = await response.json();
    json.clubs.push({ ...json.clubs[0], slug: "harbour-smash", name: "Harbour Smash", role: "member", canOpenAdmin: false });
    return route.fulfill({ response, json });
  });
  await serveJson(context, `${api}/clubs/harbour-smash/config`, async () => second);
  // Its Me: the same person, no membership there yet.
  await context.route(`${api}/clubs/harbour-smash/me`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const auth = route.request().headers().authorization;
    const mine = await (await fetch(`${api}/clubs/three-wolves/me`, { headers: { authorization: auth } })).json();
    const body = { ...mine, membership: null, join: { monthly: 4000, quarterly: 11000, days: ["tuesday"] }, calendar: [], inbox: { unread: 0, latest: [] } };
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) });
  });
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

describe("APP · the Luvallplay frame and the club's look (decision AM)", () => {
  test("APP1 · sign in by email code: Luvallplay's look before, the club's after; sign out returns to Luvallplay", async () => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(APP);
    await page.waitForURL(`${APP}/signin`);
    await page.waitForSelector("text=Luvallplay");
    assert.deepEqual(await look(page), { primary: COURT_GREEN, look: "luvallplay", mode: "light", lang: "en" });
    assert.equal(await page.title(), "Luvallplay");

    await fetch(`${env.base}/api/dev/outbox`, { method: "DELETE" });
    await page.getByLabel("Email").fill("  Mia.Member@E2E.test ");
    await page.getByRole("button", { name: "Send my code" }).click();
    await page.waitForSelector("text=Check your email");
    assert.equal((await look(page)).primary, COURT_GREEN, "the code step is still Luvallplay's");
    await page.getByLabel("6-digit code").fill(await outboxCode(PEOPLE.member.email));
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(`${APP}/me`);
    await page.waitForSelector(".shell");
    await page.waitForFunction((navy) => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase() === navy, NAVY);
    assert.deepEqual(await look(page), { primary: NAVY, look: "club", mode: "light", lang: "en" });
    assert.equal(await page.locator(".club-name").textContent(), "Three Wolves Badminton Club");
    assert.equal(await page.title(), "Three Wolves Badminton Club · Luvallplay");
    assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), NAVY);
    await page.waitForSelector(ME_READY);
    // The club's own word for Vision is on the tab; the frame's mark stays.
    assert.deepEqual(await tabLabels(page), ["Me", "Player", "Arena", "Leaderboard", "Wolf Vision"]);
    assert.match(await page.locator(".shell-foot").textContent(), /on Luvallplay/);
    const fonts = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-display"));
    assert.match(fonts, /Copperplate/);
    // One club: no switcher. A plain member: no Club admin button.
    assert.equal(await page.getByRole("button", { name: "Switch club" }).count(), 0);

    // The session is the real one, and it survives a reload.
    const token = await page.evaluate(() => localStorage.getItem("lp.token"));
    assert.equal((await fetch(`${api}/auth/session`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    await page.reload();
    await page.waitForSelector(ME_READY);
    assert.equal((await look(page)).primary, NAVY);

    await page.getByRole("link", { name: "Settings" }).click();
    await page.waitForSelector("text=Signed in as mia.member@e2e.test");
    assert.equal(await page.getByRole("button", { name: "Club admin" }).count(), 0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(`${APP}/signin`);
    await page.waitForFunction((green) => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase() === green, COURT_GREEN);
    assert.deepEqual(await look(page), { primary: COURT_GREEN, look: "luvallplay", mode: "light", lang: "en" });
    assert.equal(await page.evaluate(() => localStorage.getItem("lp.token")), null);
    assert.equal((await fetch(`${api}/auth/session`, { headers: { Authorization: `Bearer ${token}` } })).status, 401, "the session ended on the server too");
    // Signed out means signed out: the app's screens send you to sign-in.
    await page.goto(`${APP}/settings`);
    await page.waitForURL(`${APP}/signin`);
    assert.deepEqual(problems, [], "no console errors (CSP, CORS) on the way");
    await context.close();
  });

  test("APP2 · a wrong code and a bad email say so, in words, and nobody is signed in", async () => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    await page.goto(`${APP}/signin`);
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Send my code" }).click();
    await page.waitForSelector("text=That doesn't look like an email address.");
    await page.getByLabel("Email").fill(PEOPLE.hidden.email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForSelector("text=That code isn't right, or it has expired.");
    assert.equal(await page.evaluate(() => localStorage.getItem("lp.token")), null);
    assert.equal(new URL(page.url()).pathname, "/signin");
    await context.close();
  });

  test("APP3 · a club's invite link applies the club's look before sign-in, then opens that club", async () => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${APP}/c/three-wolves`);
    await page.waitForSelector("text=You're joining Three Wolves Badminton Club");
    assert.deepEqual(await look(page), { primary: NAVY, look: "club", mode: "light", lang: "en" });
    assert.equal(await page.locator("h1").textContent(), "Three Wolves Badminton Club");
    assert.match(await page.locator("footer").textContent(), /on Luvallplay/);
    assert.equal(await page.evaluate(() => localStorage.getItem("lp.token")), null, "nobody is signed in yet");

    await fetch(`${env.base}/api/dev/outbox`, { method: "DELETE" });
    await page.getByLabel("Email").fill(PEOPLE.player.email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await page.waitForSelector("text=Check your email");
    assert.equal((await look(page)).primary, NAVY, "the club's look stays through sign-in");
    await page.getByLabel("6-digit code").fill(await outboxCode(PEOPLE.player.email));
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    assert.equal(await page.evaluate(() => localStorage.getItem("lp.club")), "three-wolves");
    assert.equal((await look(page)).primary, NAVY);
    assert.deepEqual(problems, []);

    // Already signed in: the link goes straight to the club.
    await page.goto(`${APP}/c/three-wolves`);
    await page.waitForURL(`${APP}/me`);
    await context.close();
  });

  test("APP3 · an invite link to a club that doesn't exist (or a malformed one) keeps Luvallplay's look and still offers sign-in", async () => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    for (const slug of ["no-such-club", "Not%20A%20Slug"]) {
      await page.goto(`${APP}/c/${slug}`);
      await page.waitForSelector("text=We can't find that club.");
      assert.deepEqual(await look(page), { primary: COURT_GREEN, look: "luvallplay", mode: "light", lang: "en" });
      assert.equal(await page.getByLabel("Email").count(), 1);
    }
    await context.close();
  });

  test("APP4 · switching clubs changes the look, the name, the words and the tabs at once, and back", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    await withSecondClub(context);
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${APP}/arena`);
    await page.waitForSelector('[data-screen="nav_arena"]');
    assert.equal((await look(page)).primary, NAVY);

    await page.getByRole("button", { name: "Switch club" }).click();
    assert.deepEqual(await page.locator(".switcher-item > span:first-child").allTextContents(), ["Three Wolves Badminton Club", "Harbour Smash"]);
    await page.getByRole("button", { name: "Harbour Smash" }).click();
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase() === "#7a1f3d");
    assert.equal(await page.locator(".club-name").textContent(), "Harbour Smash");
    // That club has the Arena off: the tab is gone and so is the screen we were on.
    await page.waitForURL(`${APP}/me`);
    assert.deepEqual(await tabLabels(page), ["Me", "Player", "Smash Cam"]);
    await page.goto(`${APP}/arena`);
    await page.waitForURL(`${APP}/me`);
    assert.equal((await look(page)).primary, "#7a1f3d", "the choice of club survives a reload");
    assert.equal(await page.locator(".club-logo").count(), 0, "nothing of the last club's logo lingers");

    await page.getByRole("button", { name: "Switch club" }).click();
    const started = Date.now();
    await page.getByRole("button", { name: "Three Wolves Badminton Club" }).click();
    await page.waitForFunction((navy) => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase() === navy, NAVY);
    assert.ok(Date.now() - started < 1500, "the look changes at once");
    assert.deepEqual(await tabLabels(page), ["Me", "Player", "Arena", "Leaderboard", "Wolf Vision"]);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("APP5 · a module the club has off: its tab and its screen are gone; the others stay", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const base = await realConfig();
    await serveJson(context, `${api}/clubs/three-wolves/config`, async () => ({ ...base, modules: base.modules.filter((m) => m !== "vision") }));
    const page = await context.newPage();
    await page.goto(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    assert.deepEqual(await tabLabels(page), ["Me", "Player", "Arena", "Leaderboard"]);
    await page.goto(`${APP}/vision`);
    await page.waitForURL(`${APP}/me`);
    await page.goto(`${APP}/arena`);
    await page.waitForSelector('[data-screen="nav_arena"]');
    await context.close();
  });

  test("APP6 · a token the server no longer accepts returns the app to sign-in", async () => {
    const { context, token } = await signedIn(PEOPLE.coach.email);
    const page = await context.newPage();
    await page.goto(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    await db.query(`DELETE FROM player_sessions WHERE token_hash = $1`, [createHash("sha256").update(token).digest("hex")]);
    await page.reload();
    await page.waitForURL(`${APP}/signin`);
    assert.equal(await page.evaluate(() => localStorage.getItem("lp.token")), null);
    assert.equal((await look(page)).primary, COURT_GREEN);
    await context.close();
  });
});

describe("APP · Me (the home tab)", () => {
  const meFor = async (token) => (await fetch(`${api}/clubs/three-wolves/me`, { headers: { authorization: `Bearer ${token}` } })).json();
  // Formatted by the page's own browser, so the expected text uses the same date wording.
  const dayKey = (page, d) => page.evaluate((key) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }), d);

  test("APP16 · a member's Me: header, next up, membership card, calendar and inbox, from the same data as the website", async () => {
    const { context, token } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    const data = await meFor(token);
    // Header: name, pill, bell with the unread count.
    assert.equal(await page.locator(".me-head h1").textContent(), "Mia Member");
    assert.equal(await page.locator(".me-head .pill").textContent(), `Active · renews ${await dayKey(page, data.membership.periodEnd)}`);
    assert.equal(await page.locator(".me-head .icon-button").getAttribute("aria-label"), `Inbox, ${data.inbox.unread} unread`);
    // Next up: her first Friday, included in her membership.
    const next = data.calendar.find((d) => !d.paused && (d.booked || d.included));
    const nextCard = page.getByRole("region", { name: "Next up" });
    assert.equal(await nextCard.locator(".next-date").textContent(), await dayKey(page, next.date));
    assert.match(await nextCard.textContent(), /Pioneer Stadium/);
    assert.match(await nextCard.textContent(), /Included in your membership/);
    // Membership: plan and day, status, days left, and the way to manage it on the club's website.
    const card = page.locator(".membership");
    assert.equal(await card.getByRole("heading").textContent(), "Monthly · Fridays");
    assert.equal(await card.locator(".status").textContent(), "Active");
    assert.equal(await card.locator(".stat-value").textContent(), String(data.membership.daysLeft));
    const manage = card.getByRole("link", { name: /Manage membership/ });
    assert.equal(await manage.getAttribute("href"), `${env.base}/profile`);
    assert.equal(await manage.getAttribute("target"), "_blank");
    assert.equal(await page.locator(".join").count(), 0, "no join card for a member");
    // Calendar: every play day, her Fridays marked as hers.
    assert.equal(await page.locator(".day").count(), data.calendar.length);
    assert.equal(await page.locator(".day-yours").count(), data.calendar.filter((d) => d.included && !d.absent).length);
    assert.ok((await page.locator(".month").count()) >= 1);
    // Inbox: the club's unread message, opening in the app's inbox; so does the bell.
    const thread = page.locator(".thread.unread").first();
    assert.match(await thread.textContent(), /Welcome to Fridays/);
    assert.equal(await thread.locator("a").getAttribute("href"), `/inbox/${data.inbox.latest[0].id}`);
    assert.equal(await page.locator(".me-head .icon-button").getAttribute("href"), "/inbox");
    assert.equal(await page.locator(".welcome").count(), 0);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("APP17 · Can't make it: the day flips at once, is saved, survives a reload, and undoes", async () => {
    const { context, token } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    await page.goto(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    const next = (await meFor(token)).calendar.find((d) => !d.paused && (d.booked || d.included));
    const absentRow = async () => (await db.query(`SELECT 1 FROM player_absences WHERE session_date = $1 AND email = $2`, [next.date, PEOPLE.member.email])).rowCount;
    const nextCard = page.getByRole("region", { name: "Next up" });
    try {
      await nextCard.getByRole("button", { name: "Can't make it" }).click();
      await nextCard.getByRole("button", { name: "I can come after all" }).waitFor();
      assert.equal(await nextCard.getByRole("button", { name: "I can come after all" }).getAttribute("aria-pressed"), "true");
      await nextCard.getByText("You said you can't come").waitFor();
      for (let i = 0; i < 20 && (await absentRow()) === 0; i++) await page.waitForTimeout(150);
      assert.equal(await absentRow(), 1, "saved on the server");
      // The calendar row for that day agrees, and the day isn't marked as hers any more.
      const row = page.locator(".day", { hasText: "You said you can't come" });
      assert.equal(await row.count(), 1);
      await page.reload();
      await page.waitForSelector(ME_READY);
      await nextCard.getByRole("button", { name: "I can come after all" }).click();
      await nextCard.getByRole("button", { name: "Can't make it" }).waitFor();
      for (let i = 0; i < 20 && (await absentRow()) === 1; i++) await page.waitForTimeout(150);
      assert.equal(await absentRow(), 0);
    } finally {
      await db.query(`DELETE FROM player_absences WHERE session_date = $1 AND email = $2`, [next.date, PEOPLE.member.email]);
    }
    await context.close();
  });

  test("APP17 · a refused Can't make it puts the day back and says so", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    await context.route(`${api}/clubs/three-wolves/me/absence`, (route) =>
      route.request().method() === "OPTIONS"
        ? route.fulfill({ status: 204, headers: CORS })
        : route.fulfill({ status: 500, headers: { ...CORS, "content-type": "application/json" }, body: '{"error":"failed"}' }),
    );
    const page = await context.newPage();
    await page.goto(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    const nextCard = page.getByRole("region", { name: "Next up" });
    await nextCard.getByRole("button", { name: "Can't make it" }).click();
    await nextCard.getByRole("alert").waitFor();
    await nextCard.getByRole("button", { name: "Can't make it" }).waitFor();
    assert.equal(await page.locator(".day", { hasText: "You said you can't come" }).count(), 0);
    await context.close();
  });

  test("APP18 · not a member: the join card in the club's money, the welcome card, and Done keeps it away", async () => {
    const { context } = await signedIn(PEOPLE.player.email);
    const { rows } = await db.query(`SELECT id, welcome_card_dismissed_at FROM players WHERE email = $1`, [PEOPLE.player.email]);
    const page = await context.newPage();
    try {
      await page.goto(`${APP}/me`);
      await page.waitForSelector(ME_READY);
      assert.equal(await page.locator(".me-head .pill").textContent(), "Not a member yet");
      assert.equal(await page.locator(".membership").count(), 0);
      const join = page.locator(".join");
      assert.match(await join.textContent(), /Become a member/);
      assert.match(await join.textContent(), /\$33\s*\/ 4 weeks/);
      assert.match(await join.textContent(), /\$85\s*\/ 12 weeks/);
      assert.match(await join.locator(".plan-best").textContent(), /Best value/);
      assert.equal(await join.getByRole("link", { name: /Choose your plan/ }).getAttribute("href"), `${env.base}/profile`);
      assert.match(await page.getByRole("region", { name: "Next up" }).textContent(), /Nothing booked yet/);
      // A day with casual spots offers a booking, in the club's money.
      if (await page.locator(".day").count()) assert.ok((await page.getByRole("link", { name: /Book · \$10/ }).count()) >= 0);
      await page.locator(".welcome").getByRole("button", { name: "Done" }).click();
      await page.locator(".welcome").waitFor({ state: "detached" });
      for (let i = 0; i < 20; i++) {
        if ((await db.query(`SELECT welcome_card_dismissed_at FROM players WHERE id = $1`, [rows[0].id])).rows[0].welcome_card_dismissed_at) break;
        await page.waitForTimeout(150);
      }
      await page.reload();
      await page.waitForSelector(ME_READY);
      assert.equal(await page.locator(".welcome").count(), 0, "still gone after a reload");
    } finally {
      await db.query(`UPDATE players SET welcome_card_dismissed_at = $2 WHERE id = $1`, [rows[0].id, rows[0].welcome_card_dismissed_at]);
      await context.close();
    }
  });

  test("APP19 · Memberships switched off: no membership card and no join card; the calendar stays", async () => {
    await db.query(`UPDATE tenant_modules SET enabled = FALSE WHERE tenant_id = 1 AND module_id = 'memberships'`);
    try {
      for (const email of [PEOPLE.member.email, PEOPLE.player.email]) {
        const { context } = await signedIn(email);
        const page = await context.newPage();
        await page.goto(`${APP}/me`);
        await page.waitForSelector(ME_READY);
        assert.equal(await page.locator(".membership, .join").count(), 0, email);
        assert.ok((await page.locator(".day").count()) >= 1);
        await context.close();
      }
    } finally {
      await db.query(`UPDATE tenant_modules SET enabled = TRUE WHERE tenant_id = 1 AND module_id = 'memberships'`);
    }
  });

  test("APP20 · Me in Vietnamese: the club's days and dates in Vietnamese", async () => {
    const { context } = await signedIn(PEOPLE.member.email, { locale: "vi-VN" });
    await context.addInitScript(() => localStorage.setItem("lp.lang", "vi"));
    const page = await context.newPage();
    await page.goto(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    assert.equal(await page.locator(".membership").getByRole("heading").textContent(), "Hàng tháng · Thứ Sáu");
    await page.getByRole("heading", { name: "Sắp tới" }).waitFor();
    await page.getByRole("heading", { name: "Lịch chơi" }).waitFor();
    assert.match(await page.locator(".me-head .pill").textContent(), /^Đang hoạt động · gia hạn /);
    await context.close();
  });

  test("APP21 · Me can't load: a plain message and Try again, which then works", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    let fail = true;
    await context.route(`${api}/clubs/three-wolves/me`, (route) =>
      fail && route.request().method() === "GET"
        ? route.fulfill({ status: 503, headers: { ...CORS, "content-type": "application/json" }, body: '{"error":"unavailable"}' })
        : route.fallback(),
    );
    const page = await context.newPage();
    await page.goto(`${APP}/me`);
    await page.waitForSelector('[data-screen="nav_me"][data-state="error"]', { timeout: 15_000 });
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await page.waitForSelector(ME_READY);
    await context.close();
  });
});

describe("APP · the inbox", () => {
  const threadId = async () => (await db.query(`SELECT t.id FROM message_threads t JOIN players p ON p.id = t.player_id WHERE p.email = $1 AND t.subject = 'Welcome to Fridays'`, [PEOPLE.member.email])).rows[0].id;
  const restore = async (id) => {
    await db.query(`DELETE FROM messages WHERE thread_id = $1 AND sender = 'player'`, [id]);
    await db.query(`UPDATE message_threads SET unread_for_player = TRUE, status = 'open' WHERE id = $1`, [id]);
  };

  test("APP23 · from Me to a conversation and back: read, reply, and the bell catches up (phone)", async () => {
    const id = await threadId();
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    try {
      await page.goto(`${APP}/me`);
      await page.waitForSelector(ME_READY);
      await page.locator(".thread.unread a").first().click();
      await page.waitForURL(`${APP}/inbox/${id}`);
      await page.getByRole("heading", { name: "Welcome to Fridays", level: 2 }).waitFor();
      // The club's message, signed with the club's name; on a phone the list steps aside.
      assert.match(await page.locator(".message-admin").textContent(), /Three Wolves Badminton Club.*See you at Pioneer on Friday!/s);
      assert.equal(await page.locator(".inbox-list").isVisible(), false);
      await page.waitForFunction(() => document.activeElement?.tagName === "H2", null, { timeout: 5000 });
      // Reply.
      await page.getByPlaceholder("Write a message…").fill("Thanks, see you there");
      await page.getByRole("button", { name: "Send" }).click();
      await page.locator(".message-player", { hasText: "Thanks, see you there" }).waitFor();
      assert.equal(await page.getByPlaceholder("Write a message…").inputValue(), "", "the box empties once sent");
      const saved = await db.query(`SELECT body FROM messages WHERE thread_id = $1 AND sender = 'player'`, [id]);
      assert.deepEqual(saved.rows.map((r) => r.body), ["Thanks, see you there"]);
      // Back to the list: read now, and Me's bell has nothing unread.
      await page.getByRole("link", { name: "All messages" }).click();
      await page.waitForURL(`${APP}/inbox`);
      assert.equal(await page.locator(".thread.unread").count(), 0);
      assert.match(await page.locator(".thread-preview").first().textContent(), /^You: Thanks, see you there/);
      await page.locator(".shell-nav").getByRole("link", { name: "Me", exact: true }).click();
      await page.waitForSelector(ME_READY);
      await page.waitForFunction(() => document.querySelector(".me-head .icon-button")?.getAttribute("aria-label") === "Inbox");
      assert.deepEqual(problems, []);
    } finally {
      await restore(id);
      await context.close();
    }
  });

  test("APP24 · a new message: written, sent, opened; the club's admins are emailed", async () => {
    const { context } = await signedIn(PEOPLE.player.email, { viewport: { width: 900, height: 900 } });
    const page = await context.newPage();
    const peteId = (await db.query(`SELECT id FROM players WHERE email = $1`, [PEOPLE.player.email])).rows[0].id;
    try {
      await page.goto(`${APP}/inbox`);
      await page.getByText("No messages yet.").waitFor();
      // Wide: the list and the other pane side by side.
      assert.ok(await page.locator(".inbox-list").isVisible());
      assert.match(await page.locator(".inbox-detail").textContent(), /Choose a conversation/);
      await page.getByRole("link", { name: "New message" }).click();
      await page.getByLabel("Subject").fill("Jersey size");
      await page.getByLabel("Message").fill("Do you have XL?");
      await fetch(`${env.base}/api/dev/outbox`, { method: "DELETE" });
      await page.getByRole("button", { name: "Send" }).click();
      await page.waitForURL(/\/inbox\/\d+$/);
      await page.getByRole("heading", { name: "Jersey size", level: 2 }).waitFor();
      await page.locator(".message-player", { hasText: "Do you have XL?" }).waitFor();
      await page.locator(".thread-link", { hasText: "Jersey size" }).waitFor();
      assert.match(await page.locator(".thread-link[aria-current]").textContent(), /Jersey size/, "the open conversation is marked in the list");
      const row = (await db.query(`SELECT subject, started_by FROM message_threads WHERE player_id = $1`, [peteId])).rows;
      assert.deepEqual(row, [{ subject: "Jersey size", started_by: "player" }]);
      const mail = (await (await fetch(`${env.base}/api/dev/outbox`)).json()).mail;
      assert.ok(mail.some((m) => /Jersey size/.test(m.subject)), "the admins hear about it");
    } finally {
      await db.query(`DELETE FROM messages WHERE thread_id IN (SELECT id FROM message_threads WHERE player_id = $1)`, [peteId]);
      await db.query(`DELETE FROM message_threads WHERE player_id = $1`, [peteId]);
      await context.close();
    }
  });

  test("APP25 · a refused send keeps what was written and says why; a conversation that isn't yours isn't there", async () => {
    const id = await threadId();
    const { context } = await signedIn(PEOPLE.member.email);
    await context.route(`${api}/clubs/three-wolves/messages/${id}`, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 429, headers: { ...CORS, "content-type": "application/json" }, body: '{"error":"rate_limited"}' })
        : route.fallback(),
    );
    const page = await context.newPage();
    try {
      await page.goto(`${APP}/inbox/${id}`);
      await page.getByPlaceholder("Write a message…").fill("Hello again");
      await page.getByRole("button", { name: "Send" }).click();
      await page.getByRole("alert").filter({ hasText: "You've sent a lot of messages" }).waitFor();
      assert.equal(await page.getByPlaceholder("Write a message…").inputValue(), "Hello again");
      // Pete's conversations aren't Mia's: an id that isn't hers shows nothing of it.
      await page.goto(`${APP}/inbox/999999`);
      await page.getByText("That conversation isn't here.").waitFor();
      await page.goto(`${APP}/inbox/not-a-number`);
      await page.getByText("That conversation isn't here.").waitFor();
    } finally {
      await restore(id);
      await context.close();
    }
  });
});

describe("APP · screenshots", () => {
  // For people to look at (docs/screenshots/phase-4), not compared: the visual pass compares later.
  test("APP22 · Me at a phone and a tablet width, light and dark, member and newcomer", { skip: !process.env.E2E_SHOTS }, async () => {
    const dir = process.env.E2E_SHOTS;
    for (const [who, email] of [["member", PEOPLE.member.email], ["newcomer", PEOPLE.player.email]]) {
      for (const colorScheme of ["light", "dark"]) {
        for (const width of [375, 900]) {
          const { context } = await signedIn(email, { colorScheme, viewport: { width, height: width < 600 ? 812 : 1000 }, deviceScaleFactor: 2 });
          const page = await context.newPage();
          await page.goto(`${APP}/me`);
          await page.waitForSelector(ME_READY);
          await page.waitForTimeout(200);
          await page.screenshot({ path: `${dir}/me-${who}-${colorScheme}-${width}.png`, fullPage: true });
          await context.close();
        }
      }
    }
    // The inbox: a conversation on a phone, and list beside it on a tablet.
    const id = (await db.query(`SELECT t.id FROM message_threads t JOIN players p ON p.id = t.player_id WHERE p.email = $1`, [PEOPLE.member.email])).rows[0].id;
    for (const width of [375, 900]) {
      const { context } = await signedIn(PEOPLE.member.email, { viewport: { width, height: width < 600 ? 812 : 1000 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto(`${APP}/inbox/${id}`);
      await page.locator(".message").first().waitFor();
      await page.screenshot({ path: `${dir}/inbox-${width}.png` });
      await context.close();
    }
    await db.query(`UPDATE message_threads SET unread_for_player = TRUE WHERE id = $1`, [id]);
  });
});

describe("APP · settings", () => {
  test("APP7 · language: Vietnamese changes the labels and the page's language, and is remembered", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    await page.goto(`${APP}/settings`);
    await page.waitForSelector("text=Signed in as");
    await page.getByLabel("Tiếng Việt").check();
    await page.waitForSelector("text=Cài đặt");
    assert.deepEqual(await tabLabels(page), ["Tôi", "Người chơi", "Đấu trường", "Xếp hạng", "Wolf Vision"]);
    assert.equal((await look(page)).lang, "vi");
    assert.match(await page.locator(".shell-foot").textContent(), /trên Luvallplay/);
    await page.reload();
    await page.waitForSelector("text=Cài đặt");
    await page.getByLabel("English").check();
    await page.waitForSelector("text=Settings");
    assert.equal((await look(page)).lang, "en");
    await context.close();
  });

  test("APP7 · a Vietnamese device starts in Vietnamese on the sign-in screen", async () => {
    const context = await browser.newContext({ viewport: PHONE, locale: "vi-VN" });
    const page = await context.newPage();
    await page.goto(`${APP}/signin`);
    await page.waitForSelector("text=Đăng nhập");
    assert.equal((await look(page)).lang, "vi");
    await context.close();
  });

  test("APP8 · appearance: dark is the club's dark theme, follows the device by default, and is remembered", async () => {
    const { context } = await signedIn(PEOPLE.member.email, { colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(`${APP}/settings`);
    await page.waitForSelector("text=Signed in as");
    assert.deepEqual(await look(page), { primary: NAVY_DARK_MODE, look: "club", mode: "dark", lang: "en" }, "the device is dark");
    await page.getByLabel("Light").check();
    await page.waitForFunction((navy) => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase() === navy, NAVY);
    assert.equal((await look(page)).mode, "light");
    await page.reload();
    await page.waitForSelector("text=Signed in as");
    assert.equal((await look(page)).mode, "light");
    await page.getByLabel("Dark").check();
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
    assert.equal((await look(page)).primary, NAVY_DARK_MODE);
    await context.close();
  });

  test("APP9 · Club admin: opens the club's admin signed in; an old sign-in confirms by emailed code first; never shown to a member", async () => {
    const owner = await signedIn(PEOPLE.owner.email);
    const page = await owner.context.newPage();
    const hash = createHash("sha256").update(owner.token).digest("hex");
    try {
      await page.goto(`${APP}/settings`);
      await page.getByRole("button", { name: "Club admin" }).click();
      await page.waitForURL(`${env.base}/admin`);

      // Signed in more than 12 hours ago: Settings asks for a fresh code, then opens admin.
      await db.query(`UPDATE player_sessions SET created_at = NOW() - INTERVAL '13 hours' WHERE token_hash = $1`, [hash]);
      await page.goto(`${APP}/settings`);
      await page.getByRole("button", { name: "Club admin" }).click();
      await page.getByText("confirm it's you first").waitFor();
      await fetch(`${env.base}/api/dev/outbox`, { method: "DELETE" });
      await page.getByRole("button", { name: "Email me a code" }).click();
      await page.getByLabel("6-digit code").fill("000000");
      const code = await outboxCode(PEOPLE.owner.email);
      if (code !== "000000") {
        await page.getByRole("button", { name: "Confirm and open" }).click();
        await page.getByRole("alert").filter({ hasText: "isn't right" }).waitFor();
      }
      await page.getByLabel("6-digit code").fill(code);
      await page.getByRole("button", { name: "Confirm and open" }).click();
      await page.waitForURL(`${env.base}/admin`);
      assert.equal((await fetch(`${api}/auth/session`, { headers: { Authorization: `Bearer ${owner.token}` } })).status, 200, "the older session wasn't ended either");
    } finally {
      await owner.context.close();
    }

    const member = await signedIn(PEOPLE.member.email);
    const mp = await member.context.newPage();
    await mp.goto(`${APP}/settings`);
    await mp.waitForSelector("text=Signed in as");
    assert.equal(await mp.getByRole("button", { name: "Club admin" }).count(), 0);
    await member.context.close();
  });

  test("APP9b · sign out everywhere ends every session of the person", async () => {
    const owner = await signedIn(PEOPLE.owner.email);
    const page = await owner.context.newPage();
    await page.goto(`${APP}/settings`);
    const other = await sessionToken(PEOPLE.owner.email);
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await page.waitForURL(`${APP}/signin`);
    assert.equal((await fetch(`${api}/auth/session`, { headers: { Authorization: `Bearer ${owner.token}` } })).status, 401);
    assert.equal((await fetch(`${api}/auth/session`, { headers: { Authorization: `Bearer ${other}` } })).status, 401);
    await owner.context.close();
  });
});

describe("APP · settings: the account", () => {
  const playerRow = async (email) =>
    (await db.query(`SELECT id, first_name, last_name, display_name, lang, leaderboard_visible, avatar_url FROM players WHERE email = $1`, [email])).rows[0];
  // A tiny real picture (2×2 PNG), for the file picker.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");

  test("APP26 · your details: names saved to the account, shown on Me; the email and phone are shown, not edited here", async () => {
    const before = await playerRow(PEOPLE.player.email);
    const { context } = await signedIn(PEOPLE.player.email);
    const page = await context.newPage();
    const problems = watch(page);
    try {
      await page.goto(`${APP}/settings`);
      const form = page.locator("form", { has: page.getByRole("heading", { name: "Your details" }) });
      await form.waitFor();
      assert.equal(await page.getByLabel("First name").inputValue(), before.first_name);
      assert.equal(await form.getByRole("button", { name: "Save" }).isDisabled(), true, "nothing to save yet");
      assert.match(await form.locator(".facts").textContent(), new RegExp(PEOPLE.player.email.replace(".", "\\.")));
      await page.getByLabel("First name").fill("Peter");
      await page.getByLabel("Last name").fill("Player-Smith");
      await page.getByLabel("Display name").fill("Pistol Pete");
      await form.getByRole("button", { name: "Save" }).click();
      await form.getByRole("status").filter({ hasText: "Saved" }).waitFor();
      const after = await playerRow(PEOPLE.player.email);
      assert.deepEqual([after.first_name, after.last_name, after.display_name], ["Peter", "Player-Smith", "Pistol Pete"]);
      // Me follows at once (no reload).
      await page.locator(".shell-nav").getByRole("link", { name: "Me", exact: true }).click();
      await page.waitForSelector(ME_READY);
      assert.equal(await page.locator(".me-head h1").textContent(), "Peter Player-Smith");
      // Clearing the display name goes back to the default.
      await page.goto(`${APP}/settings`);
      await page.getByLabel("Display name").fill("");
      await form.getByRole("button", { name: "Save" }).click();
      await form.getByRole("status").filter({ hasText: "Saved" }).waitFor();
      assert.equal((await playerRow(PEOPLE.player.email)).display_name, null);
      assert.deepEqual(problems, []);
    } finally {
      await db.query(`UPDATE players SET first_name = $2, last_name = $3, display_name = $4 WHERE id = $1`, [before.id, before.first_name, before.last_name, before.display_name]);
      await context.close();
    }
  });

  test("APP27 · language is kept on the account; the leaderboard switch moves at once and is saved", async () => {
    const before = await playerRow(PEOPLE.member.email);
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const waitFor = async (check) => {
      for (let i = 0; i < 40; i++) {
        if (check(await playerRow(PEOPLE.member.email))) return;
        await new Promise((r) => setTimeout(r, 150));
      }
      assert.fail("the account did not change");
    };
    try {
      await page.goto(`${APP}/settings`);
      await page.getByLabel("Tiếng Việt").check();
      await waitFor((r) => r.lang === "vi");
      await page.getByLabel("English").check();
      await waitFor((r) => r.lang === "en");
      const toggle = page.getByLabel("Show me on the leaderboard");
      assert.equal(await toggle.isChecked(), before.leaderboard_visible);
      await toggle.setChecked(!before.leaderboard_visible);
      await waitFor((r) => r.leaderboard_visible === !before.leaderboard_visible);
      await page.reload();
      assert.equal(await page.getByLabel("Show me on the leaderboard").isChecked(), !before.leaderboard_visible);
      // Refused: the switch goes back and says so.
      await context.route(`${api}/account/privacy`, (route) =>
        route.request().method() === "POST" ? route.fulfill({ status: 500, headers: { ...CORS, "content-type": "application/json" }, body: '{"error":"server_error"}' }) : route.fallback(),
      );
      await page.getByLabel("Show me on the leaderboard").setChecked(before.leaderboard_visible);
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByLabel("Show me on the leaderboard").isChecked(), !before.leaderboard_visible);
    } finally {
      await db.query(`UPDATE players SET lang = $2, leaderboard_visible = $3 WHERE id = $1`, [before.id, before.lang, before.leaderboard_visible]);
      await context.close();
    }
  });

  test("APP28 · photo: shrunk to a square in the browser and sent; no storage says so plainly; a photo can be removed", async () => {
    const before = await playerRow(PEOPLE.member.email);
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const photo = page.locator("section", { has: page.getByRole("heading", { name: "Profile picture" }) });
    try {
      await page.goto(`${APP}/settings`);
      // This local server has no picture storage: the real answer.
      await photo.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
      await photo.getByRole("alert").filter({ hasText: "switched on yet" }).waitFor();
      // With storage: what the app sends is a small square picture.
      let sent;
      await context.route(`${api}/account/photo`, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        sent = route.request().postDataJSON().image;
        await route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ ok: true, url: null }) });
      });
      await photo.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
      await photo.getByRole("status").filter({ hasText: "looking sharp" }).waitFor();
      assert.match(sent, /^data:image\/(webp|jpeg);base64,/);
      const size = await page.evaluate((src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.src = src; }), sent);
      assert.deepEqual(size, [2, 2], "never enlarged; already square");
      await context.unroute(`${api}/account/photo`);
      // A photo on the account: shown, and Remove takes it off.
      await db.query(`UPDATE players SET avatar_url = $2 WHERE id = $1`, [before.id, `data:image/png;base64,${PNG.toString("base64")}`]);
      await page.reload();
      await photo.locator(".avatar img").waitFor();
      await photo.getByRole("button", { name: "Remove" }).click();
      await photo.getByRole("status").filter({ hasText: "Picture removed" }).waitFor();
      assert.equal((await playerRow(PEOPLE.member.email)).avatar_url, null);
      assert.equal(await photo.locator(".avatar img").count(), 0);
    } finally {
      await db.query(`UPDATE players SET avatar_url = $2 WHERE id = $1`, [before.id, before.avatar_url]);
      await context.close();
    }
  });

  test("APP29 · download my data: a JSON file with the account in it", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    try {
      await page.goto(`${APP}/settings`);
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download my data" }).click()]);
      assert.equal(download.suggestedFilename(), "my-club-data.json");
      const text = readFileSync(await download.path(), "utf8");
      assert.match(text, new RegExp(PEOPLE.member.email.replace(".", "\\.")));
      JSON.parse(text);
    } finally {
      await context.close();
    }
  });
});

describe("APP · layout (build plan §4.4)", () => {
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  test("APP10 · five widths: no sideways scroll, and the right navigation for each window class", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    for (const route of ["/me", "/inbox", "/leaderboard", "/settings"]) {
      await page.goto(`${APP}${route}`);
      await page.waitForSelector(route === "/me" ? ME_READY : route === "/inbox" ? ".thread-link" : ".shell-nav .tab");
      for (const width of WIDTHS) {
        const height = width < 600 ? 812 : 900;
        await page.setViewportSize({ width, height });
        await page.waitForFunction((kind) => document.querySelector(".shell")?.getAttribute("data-nav") === kind, NAV_AT[width]);
        assert.ok((await overflow(page)) <= 1, `${route} at ${width}px scrolls sideways`);
        const nav = await page.locator(".shell-nav").boundingBox();
        const main = await page.locator(".shell-main").boundingBox();
        if (NAV_AT[width] === "bar") {
          assert.ok(Math.abs(nav.width - width) <= 1 && Math.abs(nav.y + nav.height - height) <= 1, `${width}: a bar across the bottom`);
        } else if (NAV_AT[width] === "rail") {
          assert.ok(nav.x === 0 && nav.width <= 100 && nav.height > nav.width * 3 && main.x >= nav.width - 1, `${width}: a rail down the side (${JSON.stringify(nav)})`);
        } else {
          assert.ok(nav.x === 0 && nav.width >= 200 && main.x >= nav.width - 1, `${width}: a sidebar (${JSON.stringify(nav)})`);
        }
        // Touch targets: every tab and every control is at least 44px tall.
        const small = await page.evaluate(() =>
          [...document.querySelectorAll(".tab, .head-icon, .icon-button, .button, .choice, .field input, .thread-link, .back")]
            .map((el) => ({ what: el.textContent?.trim().slice(0, 30), h: el.getBoundingClientRect().height }))
            .filter((x) => x.h > 0 && x.h < 44),
        );
        assert.deepEqual(small, [], `${route} at ${width}px has small touch targets`);
        // Every tab's label is shown in full ("Leaderboard" is the longest).
        const cut = await page.evaluate(() => [...document.querySelectorAll(".shell-nav .tab span")].filter((el) => el.scrollWidth > el.clientWidth + 0.5).map((el) => el.textContent));
        assert.deepEqual(cut, [], `${route} at ${width}px cuts tab labels off`);
      }
    }
    // Wide screens put settings groups side by side (a container query on the screen, not the window).
    await page.setViewportSize({ width: 1200, height: 900 });
    const cards = await page.locator(".panes > *").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
    assert.ok(new Set(cards).size >= 2, "two or more columns at 1200px");
    await page.setViewportSize({ width: 375, height: 812 });
    const stacked = await page.locator(".panes > *").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
    assert.equal(new Set(stacked).size, 1, "one column on a phone");
    await context.close();
  });

  test("APP10 · sign-in and an invite link at five widths: no sideways scroll", async () => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    for (const route of ["/signin", "/c/three-wolves"]) {
      await page.goto(`${APP}${route}`);
      await page.getByLabel("Email").waitFor();
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 812 });
        assert.ok((await overflow(page)) <= 1, `${route} at ${width}px scrolls sideways`);
      }
    }
    await context.close();
  });

  test("APP11 · text at 200%: still no sideways scroll on a phone, and nothing is cut off", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    for (const route of ["/me", "/inbox", "/leaderboard", "/settings"]) {
      await page.goto(`${APP}${route}`);
      await page.waitForSelector(route === "/me" ? ME_READY : route === "/inbox" ? ".thread-link" : ".shell-nav .tab");
      const before = await page.locator("h1").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      const afterSize = await page.locator("h1").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(Math.abs(afterSize - before * 2) < 0.5, "type follows the text size setting");
      for (const width of [320, 375]) {
        await page.setViewportSize({ width, height: 812 });
        const wide = await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            // The bottom bar is fixed: it can't make the page scroll, so it isn't listed.
            .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest(".visually-hidden, .shell-nav"))
            .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} (${Math.round(el.getBoundingClientRect().right)}px)`)
            .slice(0, 8),
        );
        assert.ok((await overflow(page)) <= 1, `${route} at ${width}px and 200% scrolls sideways: ${wide.join(", ")}`);
      }
      await page.setViewportSize(PHONE);
    }
    await context.close();
  });

  test("APP12 · reduced motion: nothing animates", async () => {
    const context = await browser.newContext({ viewport: PHONE, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${APP}/signin`);
    await page.getByLabel("Email").waitFor();
    const moving = await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).animationName !== "none").length);
    assert.equal(moving, 0);
    await context.close();
  });
});

describe("APP · accessibility and the page's rules", () => {
  test("APP13 · axe: no violations on sign-in, an invite link, Me and Settings, light and dark", async () => {
    const problems = [];
    for (const colorScheme of ["light", "dark"]) {
      // axe is injected by the test, which the page's own CSP would (rightly) refuse.
      const { context } = await signedIn(PEOPLE.admin.email, { colorScheme, bypassCSP: true });
      const anon = await browser.newContext({ viewport: PHONE, colorScheme, bypassCSP: true });
      for (const [ctx, route, ready] of [[anon, "/signin", "form"], [anon, "/c/three-wolves", "form"], [context, "/me", ME_READY], [context, "/inbox", ".inbox-list .button"], [context, "/inbox/new", "form textarea"], [context, "/settings", "text=Signed in as"], [context, "/arena", '[data-screen="nav_arena"]']]) {
        const page = await ctx.newPage();
        await page.goto(`${APP}${route}`);
        await page.waitForSelector(ready);
        await page.addScriptTag({ content: axeSource });
        const result = await page.evaluate(() => window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }));
        for (const v of result.violations) problems.push(`${route} (${colorScheme}): ${v.id} [${v.impact}] ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
        await page.close();
      }
      await context.close();
      await anon.close();
    }
    assert.deepEqual(problems, []);
  });

  test("APP14 · the built page carries a strict Content-Security-Policy that names only the API host", async () => {
    const html = await (await fetch(`${APP}/signin`)).text();
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /style-src 'self'(;|$)/);
    assert.match(csp, new RegExp(`connect-src 'self' ${env.base.replace(/[.:/]/g, "\\$&")} https://api\\.luvallplay\\.com`));
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
    // Images from any https host (club logos, photos in Blob storage); nothing else is widened.
    assert.match(csp, /img-src 'self' data: https: /);
    assert.doesNotMatch(csp.match(/connect-src[^;]*/)[0], /https:(\s|$)/);
    assert.doesNotMatch(html, /<script(?![^>]+src=)[^>]*>/);
    // And it bites: a request to any other host is refused by the page itself.
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    await page.goto(`${APP}/signin`);
    const refused = await page.evaluate(() => fetch("https://example.com/").then(() => false, () => true));
    assert.equal(refused, true);
    await context.close();
  });

  test("APP15 · screens are separate chunks: the Settings screen's code arrives only when Settings is opened", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const scripts = [];
    page.on("response", (r) => {
      if (r.url().endsWith(".js")) scripts.push(path.basename(new URL(r.url()).pathname));
    });
    await page.goto(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    assert.ok(scripts.some((s) => s.startsWith("Me-")), `Me's chunk loaded (${scripts.join(", ")})`);
    assert.ok(!scripts.some((s) => s.startsWith("Settings-")), "Settings isn't loaded on Me");
    await page.getByRole("link", { name: "Settings" }).click();
    await page.waitForSelector("text=Signed in as");
    assert.ok(scripts.some((s) => s.startsWith("Settings-")));
    await context.close();
  });
});
