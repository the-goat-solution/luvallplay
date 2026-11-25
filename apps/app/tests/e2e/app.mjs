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
import { mkdirSync, readFileSync } from "node:fs";
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
  // The app's service worker is blocked unless a journey is about it: a page
  // it controls can bypass context.route, so the stand-ins (Stripe, the
  // photo store, failing calls) would be skipped.
  const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block", ...options });
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
  // Its shop: open, nothing in it yet.
  await serveJson(context, `${api}/clubs/harbour-smash/shop`, async () => ({ products: [], orders: [], cash: false }));
  await serveJson(context, `${api}/clubs/harbour-smash/me/photos`, async () => ({ photos: [], uploadMode: null, perDay: 20 }));
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

describe("APP · the Luvallplay frame and the club's look (decision AM)", () => {
  test("APP1 · sign in by email code: Luvallplay's look before, the club's after; sign out returns to Luvallplay", async () => {
    const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block" });
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
    const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block" });
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
    const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block" });
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
    const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block" });
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
    // Membership: plan and day, status, days left, and the way to manage it (the Membership screen).
    const card = page.locator(".membership");
    assert.equal(await card.getByRole("heading").textContent(), "Monthly · Fridays");
    assert.equal(await card.locator(".status").textContent(), "Active");
    assert.equal(await card.locator(".stat-value").textContent(), String(data.membership.daysLeft));
    const manage = card.getByRole("link", { name: /Manage membership/ });
    assert.equal(await manage.getAttribute("href"), "/membership");
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
    const { context, token } = await signedIn(PEOPLE.player.email);
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
      assert.equal(await join.getByRole("link", { name: /Choose your plan/ }).getAttribute("href"), "/membership");
      assert.match(await page.getByRole("region", { name: "Next up" }).textContent(), /Nothing booked yet/);
      // A day with casual spots offers a booking, in the club's money.
      const casual = (await (await fetch(`${api}/clubs/three-wolves/me`, { headers: { Authorization: `Bearer ${token}` } })).json()).calendar.filter((d) => !d.included && !d.booked && d.bookable && !d.paused && !d.closed && d.spots > 0);
      assert.equal(await page.getByRole("button", { name: /^Book · \$10/ }).count(), casual.length, "Book on every day with casual spots, in the club's money");
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
  // For people to look at, not compared pixel by pixel (fonts differ between
  // machines): CI uploads them as the "app-screens" artifact on every run.
  test("APP22 · every screen at the five window widths (and dark on a phone), Me for a member and a newcomer", { skip: !process.env.E2E_SHOTS }, async () => {
    const dir = process.env.E2E_SHOTS;
    mkdirSync(dir, { recursive: true });
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
    // Every other screen at each window class's width, and dark on a phone.
    const screens = [
      ["/player", '[data-screen="nav_player"][data-state="ready"]'],
      ["/arena", '[data-screen="nav_arena"][data-state="ready"]'],
      ["/leaderboard", '[data-screen="nav_leaderboard"][data-state="ready"]'],
      ["/membership", '[data-screen="membership"][data-state="ready"]'],
      ["/vision", '[data-screen="nav_vision"][data-state="ready"]'],
      ["/vision/track", '[data-testid="mode-camera"]'],
      ["/vision/label", '[data-screen="vision-label"]'],
      ["/settings", '[data-screen="nav_settings"] #details-title, [data-screen="nav_settings"] form'],
    ];
    for (const [width, colorScheme] of [...WIDTHS.map((w) => [w, "light"]), [375, "dark"]]) {
      const { context } = await signedIn(PEOPLE.member.email, { viewport: { width, height: width < 600 ? 812 : 1000 }, deviceScaleFactor: 2, colorScheme });
      const page = await context.newPage();
      for (const [route, ready] of screens) {
        await page.goto(`${APP}${route}`);
        await page.waitForSelector(ready);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${dir}/${route.slice(1).replace(/\//g, "-")}-${width}${colorScheme === "dark" ? "-dark" : ""}.png`, fullPage: true });
      }
      await context.close();
    }
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
    const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block", locale: "vi-VN" });
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
      await photo.locator(".avatar img").waitFor({ state: "detached" });
    } finally {
      await db.query(`UPDATE players SET avatar_url = $2 WHERE id = $1`, [before.id, before.avatar_url]);
      await context.close();
    }
  });

  test("APP30 · deleting the account: typed DELETE, back to sign-in; the club's only owner is told to hand over first", async () => {
    const owner = await signedIn(PEOPLE.owner.email);
    const op = await owner.context.newPage();
    await op.goto(`${APP}/settings`);
    await op.getByRole("button", { name: "Delete my account" }).click();
    const confirm = op.getByRole("button", { name: "Delete my account" });
    assert.equal(await confirm.isDisabled(), true, "nothing typed yet");
    await op.getByLabel("Type DELETE to confirm").fill("delete");
    await confirm.click();
    await op.getByRole("alert").filter({ hasText: "only owner" }).waitFor();
    await owner.context.close();

    const email = `app.delete.${Date.now()}@e2e.test`;
    const id = (await db.query(`INSERT INTO players (email, first_name, last_name, claimed_at) VALUES ($1, 'Dee', 'Leted', NOW()) RETURNING id`, [email])).rows[0].id;
    const { context, token } = await signedIn(email);
    const page = await context.newPage();
    await page.goto(`${APP}/settings`);
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByRole("button", { name: "Cancel" }).last().click();
    assert.equal(await page.getByLabel("Type DELETE to confirm").count(), 0, "Cancel closes it");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.waitForURL(`${APP}/signin`);
    assert.equal((await fetch(`${api}/auth/session`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
    assert.ok((await db.query(`SELECT deleted_at FROM players WHERE id = $1`, [id])).rows[0].deleted_at);
    await context.close();
  });

  test("APP31 · connected apps: a key made, shown once, disconnected; a webhook refused, added and removed", async () => {
    const { context } = await signedIn(PEOPLE.player.email, { viewport: { width: 900, height: 1000 } });
    const page = await context.newPage();
    const peteId = (await db.query(`SELECT id FROM players WHERE email = $1`, [PEOPLE.player.email])).rows[0].id;
    try {
      await page.goto(`${APP}/settings`);
      await page.getByText(/^Access keys \(\d+\)$/).click();
      await page.getByLabel("App name").fill("Habit tracker");
      await page.getByLabel("Read my upcoming play days (calendar feed)").check();
      await page.getByRole("button", { name: "Create key" }).click();
      const shown = page.getByRole("status").filter({ hasText: "won't be shown again" });
      await shown.waitFor();
      const key = await shown.locator("code").textContent();
      assert.match(key, /^tw_/);
      const row = (await db.query(`SELECT scopes FROM api_tokens WHERE player_id = $1 AND name = 'Habit tracker' AND revoked_at IS NULL`, [peteId])).rows[0];
      assert.deepEqual(row.scopes.sort(), ["read:attendance", "read:calendar", "read:stats"]);
      await page.getByRole("button", { name: "Disconnect: Habit tracker" }).click();
      await page.getByRole("button", { name: "Disconnect: Habit tracker" }).waitFor({ state: "detached" });
      assert.equal((await db.query(`SELECT 1 FROM api_tokens WHERE player_id = $1 AND revoked_at IS NULL`, [peteId])).rowCount, 0);

      await page.getByText(/^Webhooks \(\d+\)$/).click();
      await page.getByPlaceholder("https://").fill("https://localhost/hook");
      await page.getByRole("button", { name: "Add webhook" }).click();
      await page.getByRole("alert").filter({ hasText: "public https://" }).waitFor();
      await page.getByPlaceholder("https://").fill("https://hooks.example.com/tw");
      await page.getByRole("button", { name: "Add webhook" }).click();
      await page.getByRole("status").filter({ hasText: "Signing secret" }).waitFor();
      await page.getByRole("button", { name: "Disconnect: https://hooks.example.com/tw" }).click();
      await page.getByRole("button", { name: "Disconnect: https://hooks.example.com/tw" }).waitFor({ state: "detached" });
      assert.equal((await db.query(`SELECT 1 FROM webhook_endpoints WHERE player_id = $1`, [peteId])).rowCount, 0);
    } finally {
      await db.query(`DELETE FROM api_tokens WHERE player_id = $1`, [peteId]);
      await db.query(`DELETE FROM webhook_endpoints WHERE player_id = $1`, [peteId]);
      await context.close();
    }
  });

  test("APP32 · a brand-new account is asked its name after the code; skipping leaves a reminder that leads back", async () => {
    const signUp = async (email) => {
      const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(`${APP}/signin`);
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Send my code" }).click();
      await page.waitForSelector("text=Check your email");
      await page.getByLabel("6-digit code").fill(await outboxCode(email));
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(`${APP}/welcome`);
      return { context, page };
    };
    const stamp = Date.now();
    const first = `new.one.${stamp}@e2e.test`;
    const second = `new.two.${stamp}@e2e.test`;
    try {
      const a = await signUp(first);
      await a.page.getByRole("heading", { name: "What's your name?" }).waitFor();
      await a.page.getByLabel("First name").fill("Nina");
      await a.page.getByLabel("Last name").fill("New");
      await a.page.getByRole("button", { name: "Continue" }).click();
      await a.page.waitForURL(`${APP}/me`);
      await a.page.waitForSelector(ME_READY);
      assert.equal(await a.page.getByText("Add your name so your club knows who you are.").count(), 0);
      assert.deepEqual((await db.query(`SELECT first_name, last_name FROM players WHERE email = $1`, [first])).rows[0], { first_name: "Nina", last_name: "New" });
      await a.context.close();

      const b = await signUp(second);
      await b.page.getByRole("link", { name: "Cancel" }).click();
      await b.page.waitForURL(`${APP}/me`);
      await b.page.getByRole("link", { name: "Add my name" }).click();
      await b.page.waitForURL(`${APP}/welcome`);
      await b.page.getByLabel("First name").fill("Ned");
      await b.page.getByRole("button", { name: "Continue" }).click();
      await b.page.waitForURL(`${APP}/me`);
      assert.equal(await b.page.getByRole("link", { name: "Add my name" }).count(), 0);
      await b.context.close();
    } finally {
      await db.query(`DELETE FROM player_sessions WHERE player_id IN (SELECT id FROM players WHERE email = ANY($1))`, [[first, second]]);
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

describe("APP · the Arena", () => {
  const act = async (token, body) => {
    const r = await fetch(`${api}/clubs/three-wolves/arena`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await r.json();
    if (!r.ok) throw new Error(`${body.action}: ${r.status} ${json.error}`);
    return json;
  };
  const pairUp = async (a, b) => {
    const { code } = await act(a, { action: "pair_code" });
    await act(b, { action: "pair_enter", code: code.code });
    await act(a, { action: "pair_respond", accept: true });
  };
  const ARENA_READY = '[data-screen="nav_arena"][data-state="ready"]';

  test("APP33 · pairing by code in the app, a challenge put up and taken down, and an invite link that pairs whoever opens it", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const pete = await signedIn(PEOPLE.player.email);
    const cora = await signedIn(PEOPLE.coach.email);
    const mp = await mia.context.newPage();
    const pp = await pete.context.newPage();
    const problems = watch(mp);
    try {
      await mp.goto(`${APP}/arena`);
      await mp.waitForSelector(ARENA_READY);
      await mp.getByRole("heading", { name: "Team up" }).waitFor();
      await mp.getByRole("button", { name: "Other ways to pair" }).click();
      await mp.getByRole("button", { name: "Show my code" }).click();
      const digits = (await mp.locator(".code-tiles").getAttribute("aria-label")).replace(/\s/g, "");
      assert.match(digits, /^\d{5}$/);
      assert.match(await mp.getByRole("timer").textContent(), /New code in \d:\d\d/);

      await pp.goto(`${APP}/arena`);
      await pp.getByRole("button", { name: "Other ways to pair" }).click();
      await pp.getByRole("button", { name: "Enter their code" }).click();
      await pp.getByLabel("Partner's 5-digit code").fill("12");
      assert.equal(await pp.getByRole("button", { name: "Team up" }).isDisabled(), true);
      await pp.getByLabel("Partner's 5-digit code").fill(digits);
      await pp.getByRole("button", { name: "Team up" }).click();
      await pp.getByText("Waiting for Mia").waitFor();

      // Mia's board catches up by itself (it refreshes every few seconds).
      await mp.getByRole("heading", { name: /wants to team up with you/ }).waitFor({ timeout: 15000 });
      await mp.getByRole("button", { name: "Accept" }).click();
      await mp.getByRole("button", { name: "Throw down a challenge" }).waitFor();
      await mp.getByRole("button", { name: "Choose days or add a note" }).click();
      await mp.getByLabel("7 days").check();
      await mp.getByLabel("A note for challengers (optional)").fill("Fridays at Pioneer");
      await mp.getByRole("button", { name: "Put us up" }).click();
      await mp.getByText("You're up for a challenge").waitFor();
      // Cora (no partner) sees it, and why she can't take it yet.
      const cp = await cora.context.newPage();
      await cp.goto(`${APP}/arena`);
      const card = cp.locator(".fight", { hasText: "Fridays at Pioneer" });
      await card.waitFor();
      assert.match(await card.textContent(), /Team up first/);
      assert.match(await card.textContent(), /open 7 days|open 6 days/);
      await mp.getByRole("button", { name: "Take it down" }).click();
      await mp.getByRole("button", { name: "Throw down a challenge" }).waitFor();

      // An invite link (what the QR holds) pairs Cora with Olivia as soon as she opens it.
      const olivia = await sessionToken(PEOPLE.owner.email);
      const invite = await act(olivia, { action: "pair_invite" });
      await cp.goto(`${APP}/arena?join=${invite.code.code}`);
      await cp.getByText("You're a pair!").waitFor();
      assert.equal(new URL(cp.url()).search, "", "the code leaves the address bar");
      await cp.getByRole("heading", { name: /Olivia/ }).waitFor();
      assert.deepEqual(problems, []);
    } finally {
      for (const who of [mia.token, cora.token]) await act(who, { action: "pair_leave" }).catch(() => {});
      await mia.context.close();
      await pete.context.close();
      await cora.context.close();
    }
  });

  test("APP34 · a whole game: accepted (the versus splash), checked in, the score entered and confirmed, then the after-game card", async () => {
    const mia = await signedIn(PEOPLE.member.email, { viewport: { width: 1000, height: 1000 } });
    const pete = await sessionToken(PEOPLE.player.email);
    const cora = await signedIn(PEOPLE.coach.email);
    const adam = await sessionToken(PEOPLE.admin.email);
    try {
      await pairUp(mia.token, pete);
      await pairUp(cora.token, adam);
      const posted = await act(mia.token, { action: "post", days: 3, note: "" });
      const id = posted.state.mine.find((c) => c.status === "open").id;
      await act(cora.token, { action: "accept", id });

      const mp = await mia.context.newPage();
      await mp.goto(`${APP}/arena`);
      // The versus splash: both pairs, VS, and "Later" puts it off to a pill.
      const splash = mp.getByRole("dialog", { name: "Challenge accepted!" });
      await splash.waitFor();
      assert.match(await splash.textContent(), /threw it down[\s\S]*took it on/);
      if (process.env.E2E_SHOTS) await mp.screenshot({ path: `${process.env.E2E_SHOTS}/app-arena-versus.png` });
      await splash.getByRole("button", { name: /Minimize/ }).click();
      await mp.getByText("Your match is on").waitFor();
      // On the other tabs too: a pill back to the Arena.
      await mp.locator(".shell-nav").getByRole("link", { name: "Me" }).click();
      await mp.waitForSelector(ME_READY);
      await mp.getByTestId("match-pill").click();
      await mp.waitForURL(`${APP}/arena`);
      await mp.getByRole("button", { name: "Open", exact: true }).click();
      await splash.getByRole("button", { name: "Let's go" }).click();
      await splash.waitFor({ state: "detached" });
      await mp.reload();
      await mp.waitForSelector('[data-screen="nav_arena"][data-state="ready"]');
      assert.equal(await splash.count(), 0, "seen: not shown again");
      const mine = mp.locator(`#challenge-${id}`);
      await mine.getByText("Challenge accepted!").waitFor();
      await mine.getByRole("button", { name: "We're here" }).click();
      await mine.getByText("Game on!").waitFor();
      // Tracking the game: free during the trial, as on the website.
      await mine.getByRole("link", { name: /FREE NOW/ }).waitFor();
      // The game takes its time (the score opens a few minutes after check-in).
      await db.query(`UPDATE arena_challenges SET checked_in_at = NOW() - INTERVAL '40 minutes' WHERE id = $1`, [id]);

      await mine.getByRole("button", { name: "Final score" }).click();
      const dialog = mp.getByRole("dialog", { name: "Final score" });
      await dialog.waitFor();
      const send = dialog.getByRole("button", { name: /^Send to/ });
      await dialog.getByRole("textbox").nth(1).fill("21");
      assert.equal(await send.isDisabled(), true, "21–21 isn't a final score");
      await dialog.getByRole("textbox").nth(1).fill("15");
      await dialog.getByText("✓ Valid score").waitFor();
      await send.click();
      await dialog.waitFor({ state: "detached" });
      await mine.getByText(/Waiting for .* to confirm 21–15/).waitFor();

      const cp = await cora.context.newPage();
      await cp.goto(`${APP}/arena`);
      const theirs = cp.locator(`#challenge-${id}`);
      await theirs.getByText(/entered 15–21\. Is that right\?|entered 21–15\. Is that right\?/).waitFor();
      await theirs.getByRole("button", { name: "Confirm" }).click();

      // Mia's after-game card: the win, the points, and what next.
      const after = mp.getByRole("dialog", { name: "Victory!" });
      await after.waitFor({ timeout: 15000 });
      assert.match(await after.textContent(), /\+\d+ WP/);
      const done = after.getByRole("button", { name: "Done" });
      assert.equal(await done.isDisabled(), true);
      await after.getByLabel("Split up").check();
      await done.click();
      await after.waitFor({ state: "detached" });
      await mp.getByRole("heading", { name: "Team up" }).waitFor();
      const row = (await db.query(`SELECT status, score_posting, score_accepting FROM arena_challenges WHERE id = $1`, [id])).rows[0];
      assert.deepEqual(row, { status: "completed", score_posting: 21, score_accepting: 15 });
    } finally {
      for (const who of [mia.token, cora.token]) await act(who, { action: "pair_leave" }).catch(() => {});
      await mia.context.close();
      await cora.context.close();
    }
  });

  test("APP44 · the ladder's pictures on the Player tab, the Leaderboard and the Arena; a played game's tracked stats from the feed; a player's card that opens the Arena on them", async () => {
    const mia = await signedIn(PEOPLE.member.email, { viewport: { width: 1000, height: 1000 } });
    const pete = await sessionToken(PEOPLE.player.email);
    const cora = await sessionToken(PEOPLE.coach.email);
    const adam = await sessionToken(PEOPLE.admin.email);
    const page = await mia.context.newPage();
    const problems = watch(page);
    try {
      await pairUp(mia.token, pete);
      await pairUp(cora, adam);
      const posted = await act(mia.token, { action: "post", days: 3, note: "" });
      const id = posted.state.mine.find((c) => c.status === "open").id;
      await act(cora, { action: "accept", id });
      await act(mia.token, { action: "checkin_now", id });
      // Tracked stats, saved as the tracker does, then the game finished.
      const setup = await (await fetch(`${api}/clubs/three-wolves/vision/challenges/${id}`, { headers: { Authorization: `Bearer ${mia.token}` } })).json();
      const players = setup.setup.teams.flatMap((t) => t.players.map((p, k) => ({ playerId: p.id, hits: 10 + k, distance: 120.5, topSpeed: 6.2 })));
      const saved = await fetch(`${api}/clubs/three-wolves/vision/stats`, {
        method: "POST",
        headers: { Authorization: `Bearer ${mia.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: id, mode: "live", duration: 900, rallies: 31, longestRally: 17, avgRallyShots: 6, fastestShotKmh: 212, players }),
      });
      assert.equal(saved.status, 200);
      await db.query(`UPDATE arena_challenges SET checked_in_at = NOW() - INTERVAL '40 minutes' WHERE id = $1`, [id]);
      await act(mia.token, { action: "score", id, posting: 21, accepting: 12 });
      await act(cora, { action: "confirm", id });
      await act(mia.token, { action: "rank_seen" }); // a rank-up from this game isn't what this journey is about

      // The feed's Stats chip opens the game's numbers.
      await page.goto(`${APP}/arena`);
      await page.waitForSelector('[data-screen="nav_arena"][data-state="ready"]');
      const after = page.getByRole("dialog", { name: "Victory!" });
      await after.waitFor({ timeout: 15000 });
      await after.getByLabel("Split up").check();
      await after.getByRole("button", { name: "Done" }).click();
      await after.waitFor({ state: "detached" });
      await page.locator(".feed").getByRole("button", { name: /Stats/ }).first().click();
      const stats = page.getByTestId("match-stats");
      await stats.waitFor();
      assert.match(await stats.textContent(), /31[\s\S]*17[\s\S]*212/);
      assert.equal(await stats.locator("tbody tr").count(), 4);
      assert.match(await stats.textContent(), /120\.5 m[\s\S]*6\.2 m\/s/);
      await page.keyboard.press("Escape");

      // The Player tab: the rank's picture, the kit bag's and the ladder's.
      await page.goto(`${APP}/player`);
      await page.waitForSelector('[data-screen="nav_player"][data-state="ready"]');
      const hero = page.locator(".rank-hero > svg[role=img]");
      assert.equal(await hero.getAttribute("width"), "92");
      assert.ok((await hero.getAttribute("aria-label")).length > 2);
      assert.ok((await page.locator(".kit-item svg[role=img]").count()) >= 4);
      assert.ok((await page.locator(".achievements svg[role=img]").count()) > 0);
      assert.ok((await page.locator(".ladder svg[role=img]").count()) > 3);

      // The Leaderboard: a badge on every face; a card's Challenge opens the Arena on that player.
      await page.goto(`${APP}/leaderboard`);
      await page.waitForSelector('[data-screen="nav_leaderboard"][data-state="ready"]');
      const rows = await page.locator(".board-row").count();
      assert.equal(await page.locator(".board-row .board-face-rank[role=img]").count(), rows);
      await act(mia.token, { action: "pair_leave" });
      await act(cora, { action: "pair_leave" });
      const coraRow = page.locator(".board-row").filter({ hasText: "Cora" }).first();
      if (await coraRow.count()) {
        await coraRow.getByRole("button").click();
        const card = page.getByRole("dialog");
        await card.locator("svg[role=img]").first().waitFor();
        await card.getByRole("button", { name: "Challenge" }).click();
        await page.waitForURL(`${APP}/arena`);
        await page.getByText("Post a challenge with your partner, and they can accept it.").waitFor();
      }
      assert.deepEqual(problems.filter((p) => !/Failed to load resource/i.test(p)), []);
    } finally {
      for (const who of [mia.token, cora]) await act(who, { action: "pair_leave" }).catch(() => {});
      await mia.context.close();
    }
  });
});

describe("APP · the Leaderboard", () => {
  const READY = '[data-screen="nav_leaderboard"][data-state="ready"]';

  test("APP35 · the Leaderboard: the board as the API has it, periods and sources, a player's card whose Challenge opens the Arena", async () => {
    const { context, token } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    try {
      const board = await (await fetch(`${api}/clubs/three-wolves/leaderboard`, { headers: { Authorization: `Bearer ${token}` } })).json();
      await page.goto(`${APP}/leaderboard`);
      await page.waitForSelector(READY);
      await page.getByRole("heading", { name: "Leaderboard", level: 1 }).waitFor();
      assert.equal(await page.locator(".board:not(.board-pinned) .board-row").count(), Math.min(50, board.rows.length));
      if (board.rows.length) assert.match(await page.locator(".board-row").first().textContent(), new RegExp(board.rows[0].name));

      await page.getByRole("button", { name: "Month", exact: true }).click();
      await page.getByRole("heading", { level: 2, name: new RegExp(String(new Date().getFullYear())) }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Month", exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByRole("button", { name: "Previous" }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Next"]') && !document.querySelector('[aria-label="Next"]').disabled);
      await page.getByRole("button", { name: "Play days" }).click();
      await page.waitForFunction(() => document.querySelector(".chip-button[aria-pressed='true']")?.textContent === "Play days");

      await page.getByRole("button", { name: "All time" }).click();
      await page.getByRole("button", { name: "All points" }).click();
      const other = board.rows.find((r) => r.playerId !== board.me.id);
      if (other) {
        await page.locator(".board-row", { hasText: other.name }).first().getByRole("button").click();
        const card = page.getByRole("dialog", { name: other.name });
        await card.getByText("Recent form").waitFor();
        await card.getByRole("button", { name: /^(Challenge|Accept their challenge)$/ }).click();
        await page.waitForURL(`${APP}/arena`);
      }
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });
});

describe("APP · the Player tab", () => {
  test("APP36 · Player: the rank card, kit bag and achievements, play stats as the API has them, the 26 weeks, history and the ladder; no rank without the Arena", async () => {
    const { context, token } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    try {
      const stats = await (await fetch(`${api}/clubs/three-wolves/me/stats`, { headers: { Authorization: `Bearer ${token}` } })).json();
      await page.goto(`${APP}/player`);
      await page.waitForSelector('[data-screen="nav_player"][data-state="ready"]');
      await page.getByRole("heading", { name: "Wolf Points", level: 2 }).waitFor();
      await page.getByRole("heading", { name: "Kit bag" }).waitFor();
      await page.getByRole("heading", { name: "Achievements" }).waitFor();
      const allTime = page.locator(".stat", { hasText: "Play days · All time" });
      assert.equal(await allTime.locator("dd").textContent(), String(stats.attended.lifetime));
      assert.match(await page.locator(".stat-feature dd").textContent(), new RegExp(`${stats.streak.current}$`));
      await page.getByRole("img", { name: "Last 26 weeks" }).waitFor();
      assert.equal(await page.locator("#history-title ~ ul li").count(), Math.min(40, new Set([...stats.attendedDates, ...stats.rrHistory.map((r) => r.date)]).size));
      await page.getByRole("heading", { name: "The ladder" }).waitFor();
      assert.equal(await page.locator(".ladder [aria-current]").count(), 1, "your tier is marked");
      // A kit item says what it takes.
      await page.locator(".kit button").nth(1).click();
      assert.match(await page.locator("#kit-title ~ p").textContent(), /\d+ WP$/);
      assert.deepEqual(problems, []);

      await db.query(`UPDATE tenant_modules SET enabled = FALSE WHERE tenant_id = 1 AND module_id = 'arena'`);
      try {
        const p2 = await context.newPage();
        await p2.goto(`${APP}/player`);
        await p2.waitForSelector('[data-screen="nav_player"][data-state="ready"]');
        assert.equal(await p2.getByRole("heading", { name: "Kit bag" }).count(), 0);
        assert.equal(await p2.getByRole("heading", { name: "The ladder" }).count(), 0);
        assert.equal(await p2.getByRole("link", { name: /See the leaderboard/ }).count(), 0);
      } finally {
        await db.query(`UPDATE tenant_modules SET enabled = TRUE WHERE tenant_id = 1 AND module_id = 'arena'`);
      }
    } finally {
      await context.close();
    }
  });
});

/** A test product (a tee: men's M with 2 in stock, women's S sold out), and the modules the shop needs; undo() puts everything back. */
async function seedShop(db, { cash = true } = {}) {
  const before = (await db.query(`SELECT module_id, enabled FROM tenant_modules WHERE tenant_id = 1 AND module_id IN ('shop', 'payments-to-check')`)).rows;
  const set = (id, on) => db.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES (1, $1, $2) ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = $2`, [id, on]);
  await set("shop", true);
  await set("payments-to-check", cash);
  const slug = `e2e-tee-${Date.now()}`;
  const product = (await db.query(`INSERT INTO shop_products (slug, name_en, name_vi, desc_en, price_cents, has_fit, has_sizes, sort) VALUES ($1, 'E2E Tee', 'Áo E2E', 'A test shirt.', 4500, TRUE, TRUE, -1) RETURNING id`, [slug])).rows[0].id;
  const men = (await db.query(`INSERT INTO shop_variants (product_id, fit, size, stock) VALUES ($1, 'men', 'M', 2) RETURNING id`, [product])).rows[0].id;
  const women = (await db.query(`INSERT INTO shop_variants (product_id, fit, size, stock) VALUES ($1, 'women', 'S', 0) RETURNING id`, [product])).rows[0].id;
  return {
    product, men, women, set,
    async undo() {
      const orders = (await db.query(`SELECT DISTINCT order_id FROM shop_order_items WHERE variant_id IN ($1, $2)`, [men, women])).rows.map((r) => r.order_id);
      await db.query(`DELETE FROM shop_order_items WHERE order_id = ANY($1)`, [orders]);
      await db.query(`DELETE FROM shop_orders WHERE id = ANY($1)`, [orders]);
      await db.query(`DELETE FROM shop_stock_log WHERE variant_id IN ($1, $2)`, [men, women]);
      await db.query(`DELETE FROM shop_variants WHERE product_id = $1`, [product]);
      await db.query(`DELETE FROM shop_products WHERE id = $1`, [product]);
      for (const m of ["shop", "payments-to-check"]) {
        const was = before.find((r) => r.module_id === m);
        if (was) await set(m, was.enabled);
        else await db.query(`DELETE FROM tenant_modules WHERE tenant_id = 1 AND module_id = $1`, [m]);
      }
    },
  };
}

// Stripe's script, stood in for: the card fields mount, and paying succeeds.
const FAKE_STRIPE = `window.Stripe = function () {
  return {
    elements: function () {
      return { create: function () {
        var ready = null;
        return {
          on: function (e, cb) { if (e === "ready") ready = cb; },
          mount: function (el) { var d = document.createElement("div"); d.className = "fake-card-fields"; d.textContent = "4242 4242 4242 4242"; el.appendChild(d); setTimeout(function () { ready && ready(); }, 20); },
          destroy: function () {}
        };
      } };
    },
    confirmPayment: function () { window.__paid = (window.__paid || 0) + 1; return Promise.resolve({ paymentIntent: { id: "pi_test", status: "succeeded" } }); },
    confirmSetup: function () { return Promise.resolve({ setupIntent: { id: "seti_test", status: "succeeded" } }); }
  };
};`;

/** Stripe for one browser context: the club's key in its config, and Stripe's script stood in for. */
async function withStripe(context) {
  const base = await realConfig();
  await serveJson(context, `${api}/clubs/three-wolves/config`, () => ({ ...base, club: { ...base.club, stripeKey: "pk_test_e2e" } }));
  await context.route("https://js.stripe.com/v3/", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: FAKE_STRIPE }));
}

describe("APP · the club shop", () => {

  test("APP37 · the shop on Me: fits and sizes with stock, a cash reservation and its cancelling, and paying by card through Stripe's form", async () => {
    const shop = await seedShop(db);
    const { context } = await signedIn(PEOPLE.player.email);
    const page = await context.newPage();
    const problems = watch(page);
    try {
      await page.goto(`${APP}/me`);
      await page.waitForSelector(ME_READY);
      const tee = page.locator("article.product", { hasText: "E2E Tee" });
      await tee.waitFor();
      assert.match(await tee.textContent(), /\$45(\.00)?/);
      const pay = tee.getByRole("button", { name: /Choose a size|Pay by card/ });
      assert.equal(await pay.isDisabled(), true);
      await tee.getByRole("button", { name: "Women's", exact: true }).click();
      assert.equal(await tee.getByRole("button", { name: /S · Sold out/ }).isDisabled(), true);
      await tee.getByRole("button", { name: "Men's", exact: true }).click();
      await tee.getByRole("button", { name: /M · 2 left/ }).click();

      await tee.getByRole("button", { name: "Reserve & pay cash at a play day" }).click();
      await tee.getByRole("status").filter({ hasText: /Reserved! Bring \$45(\.00)? cash/ }).waitFor();
      const orders = page.locator(".card", { has: page.getByRole("heading", { name: "Your orders" }) });
      await orders.getByText(/Reserved: bring \$45(\.00)? cash by/).waitFor();
      await orders.getByRole("button", { name: "Cancel reservation" }).click();
      await orders.waitFor({ state: "detached" });
      assert.equal((await db.query(`SELECT reserved FROM shop_variants WHERE id = $1`, [shop.men])).rows[0].reserved, 0);

      // By card: the club's Stripe key, Stripe's form, the payment, then the order shows as paid.
      await withStripe(context);
      const order = { id: 999001, status: "pending_payment", method: "card", totalCents: 4500, holdExpiresAt: null, paidAt: null, collectedAt: null, createdAt: new Date().toISOString(), items: [{ label: "E2E Tee · Men's M", qty: 1, unitPriceCents: 4500 }] };
      await context.route(`${api}/clubs/three-wolves/shop/orders`, (route) =>
        route.request().method() === "POST" ? route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ order, clientSecret: "pi_test_secret_e2e", playDay: null }) }) : route.fallback(),
      );
      let confirmed = false;
      await context.route(`${api}/clubs/three-wolves/shop/orders/999001/confirm`, (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        confirmed = true;
        return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ order: { ...order, status: "paid", paidAt: new Date().toISOString() } }) });
      });
      await page.reload();
      await page.waitForSelector(ME_READY);
      await tee.getByRole("button", { name: /M · 2 left/ }).click();
      await tee.getByRole("button", { name: /^Pay by card · \$45(\.00)?$/ }).click();
      const dialog = page.getByRole("dialog", { name: "Pay by card" });
      await dialog.locator(".fake-card-fields").waitFor();
      await dialog.getByRole("button", { name: /^Pay by card · \$45(\.00)?$/ }).click();
      await tee.getByRole("status").filter({ hasText: "Paid! Collect it at your next play day." }).waitFor();
      assert.equal(confirmed, true);
      assert.equal(await page.evaluate(() => window.__paid), 1);
      assert.deepEqual(problems, []);
    } finally {
      await shop.undo();
      await context.close();
    }
  });
});

describe("APP · membership and casual booking", () => {
  const json = (body, status = 200) => ({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
  const MEM = '[data-screen="membership"][data-state="ready"]';

  test("APP38 · a member manages their membership in the app: billing, an upgrade, and turning auto-renew off through the four steps", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    await serveJson(context, `${api}/clubs/three-wolves/membership/billing`, () => ({
      card: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2029 },
      nextCharge: { date: "2026-12-18", amountCents: 4000 },
      pendingChange: null,
      receipts: [{ date: "2026-11-20", amountCents: 4000, description: "Monthly membership", url: null, refunded: false }],
    }));
    const sent = [];
    await context.route(`${api}/clubs/three-wolves/membership`, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON();
      sent.push(body);
      return route.fulfill(json(body.action === "change" ? { ok: true, from: "2026-12-18" } : { ok: true, endsOn: "2026-12-18" }));
    });
    const page = await context.newPage();
    const problems = watch(page);
    try {
      await page.goto(`${APP}/me`);
      await page.waitForSelector(ME_READY);
      await page.getByRole("link", { name: "Manage membership" }).click();
      await page.waitForURL(`${APP}/membership`);
      await page.waitForSelector(MEM);
      await page.getByText("VISA •••• 4242 · 04/29").waitFor();
      await page.getByText("Receipts (1)").waitFor();
      assert.equal(await page.getByRole("button", { name: "Update card" }).count(), 1);

      await page.getByRole("button", { name: /Upgrade to Quarterly/ }).click();
      await page.getByRole("dialog").getByRole("button", { name: /^Upgrade from/ }).click();
      await page.getByRole("status").filter({ hasText: "You'll switch to Quarterly on" }).waitFor();
      assert.deepEqual(sent.at(-1), { action: "change", plan: "quarterly", day: "friday" });

      await page.getByRole("button", { name: "Turn off auto-renew" }).click();
      const leave = page.getByRole("dialog", { name: "Turn off auto-renew" });
      await leave.getByText("Step 1 of 4").waitFor();
      await leave.getByRole("button", { name: "Continue" }).click();
      await leave.getByRole("button", { name: "No thanks, continue" }).click();
      const next = leave.getByRole("button", { name: "Continue" });
      assert.equal(await next.isDisabled(), true, "a reason first");
      await leave.getByLabel("Not enough time / schedule changed").check();
      await next.click();
      await leave.getByRole("button", { name: "Turn off auto-renew" }).click();
      await leave.getByRole("status").filter({ hasText: "Your membership ends on" }).waitFor();
      assert.deepEqual(sent.at(-1), { action: "cancel", reason: "time" });
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });

  test("APP39 · joining in the app (plan, billing, Stripe) and booking a casual spot from Me's calendar", async () => {
    const { context } = await signedIn(PEOPLE.player.email);
    await withStripe(context);
    let joined;
    await context.route(`${api}/clubs/three-wolves/membership/join`, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      joined = route.request().postDataJSON();
      return route.fulfill(json({ clientSecret: "pi_join_secret_e2e", periodStart: "2026-12-04" }));
    });
    let booked;
    await context.route(`${api}/clubs/three-wolves/me/book`, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      booked = route.request().postDataJSON();
      return route.fulfill(json({ clientSecret: "pi_book_secret_e2e", periodStart: null }));
    });
    const page = await context.newPage();
    const problems = watch(page);
    try {
      await page.goto(`${APP}/me`);
      await page.waitForSelector(ME_READY);
      // A casual spot, if one is open on Pete's calendar.
      const book = page.getByRole("button", { name: /^Book · / }).first();
      if (await book.count()) {
        await book.click();
        const dialog = page.getByRole("dialog", { name: "Book a casual session" });
        await dialog.locator(".fake-card-fields").waitFor();
        await dialog.getByRole("button", { name: /^Pay / }).click();
        await page.getByRole("status").filter({ hasText: "You're booked for" }).waitFor();
        assert.match(booked.date, /^\d{4}-\d{2}-\d{2}$/);
      }

      await page.getByRole("link", { name: "Choose your plan" }).click();
      await page.waitForURL(`${APP}/membership`);
      await page.getByRole("heading", { name: "Become a member" }).waitFor();
      await page.getByRole("button", { name: /^Monthly/ }).click();
      await page.getByLabel(/^Pay once/).check();
      await page.getByRole("button", { name: /^Continue to payment · / }).click();
      await page.locator(".fake-card-fields").waitFor();
      await page.getByRole("button", { name: /^Pay / }).click();
      await page.getByRole("status").filter({ hasText: "Your membership starts" }).waitFor();
      assert.equal(joined.plan, "monthly");
      assert.equal(joined.recurring, false);
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });
});

describe("APP · Vision", () => {
  test("APP40 · the Vision tab: the free trial with its dates and prices, the tracker in the app, a challenge that isn't there; the labelling tool marks hits by key and saves them", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    const miaId = (await db.query(`SELECT id FROM players WHERE email = $1`, [PEOPLE.member.email])).rows[0].id;
    try {
      await page.goto(`${APP}/vision`);
      await page.waitForSelector('[data-screen="nav_vision"][data-state="ready"]');
      await page.getByRole("heading", { name: /is free until 28 February 2027/ }).waitFor();
      assert.match(await page.locator(".trial").textContent(), /days left of the free trial|Last day of the free trial/);
      assert.match(await page.locator(".trial").textContent(), /From 1 March 2027: \$5(\.00)? a live match, \$2(\.00)? a video\./);
      const camera = page.getByRole("link", { name: /^Phone camera/ });
      assert.equal(await camera.getAttribute("href"), "/vision/track");
      assert.equal(await camera.getAttribute("target"), null);

      await page.goto(`${APP}/vision?challenge=999999`);
      await page.getByText("This challenge could not be found.").waitFor();
      assert.equal(await page.getByRole("link", { name: /^Analyse a video/ }).getAttribute("href"), "/vision/track?challenge=999999");
      problems.length = 0; // the 404 for the missing challenge is expected

      await page.getByRole("link", { name: "Open the labelling tool" }).click();
      await page.waitForURL(`${APP}/vision/label`);
      await page.getByTestId("label-file").setInputFiles({ name: "club-night.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video") });
      await page.getByRole("button", { name: "1 · Near left" }).waitFor();
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("1");
      await page.keyboard.press("r");
      await page.keyboard.press("4");
      await page.getByRole("button", { name: "3 · Far left" }).click();
      assert.match(await page.getByTestId("label-summary").textContent(), /3 hits in 2 rallies · rally 2/);
      await page.keyboard.press("Backspace");
      assert.match(await page.getByTestId("label-summary").textContent(), /2 hits in 2 rallies/);
      await page.getByRole("button", { name: "Save to the labelling set" }).click();
      await page.getByRole("status").filter({ hasText: "Saved 2 hits to the labelling set" }).waitFor();
      const row = (await db.query(`SELECT id, video_name, hits FROM wv_labels WHERE player_id = $1 ORDER BY id DESC LIMIT 1`, [miaId])).rows[0];
      assert.equal(row.video_name, "club-night.mp4");
      assert.deepEqual(row.hits.map((h) => [h.player, h.rally]), [[0, 0], [3, 1]]);
      await db.query(`DELETE FROM wv_labels WHERE id = $1`, [row.id]);
      assert.deepEqual(problems.filter((p) => !/MEDIA_ERR|media|video|Failed to load resource/i.test(p)), []);
    } finally {
      await context.close();
    }
  });

  test("APP41 · the tracker in the app: the club's words and language, its calls on the club's API, full screen during a session, a challenge that isn't there", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    const calls = [];
    page.on("request", (r) => r.url().includes("/api/") && calls.push(`${r.method()} ${new URL(r.url()).pathname}`));
    try {
      await page.goto(`${APP}/vision`);
      await page.waitForSelector('[data-screen="nav_vision"][data-state="ready"]');
      await page.getByRole("link", { name: /^Phone camera/ }).click();
      await page.waitForURL(`${APP}/vision/track`);
      await page.getByTestId("mode-camera").waitFor();
      const banner = await page.getByTestId("trial-banner").textContent();
      assert.match(banner, /Wolf Vision is free until 28 February 2027/);
      // The prices come from the club's API, in its money; no club's words of their own.
      await page.getByTestId("trial-banner").filter({ hasText: "From 1 March 2027: $5 a live match, $2 a video." }).waitFor();
      assert.doesNotMatch(await page.locator("body").innerText(), /NZ\$|\{(player|players|Player|Pair|priceLive|priceUpload)\}/);
      assert.ok(await page.locator(".shell-nav").isVisible(), "the tabs stay until a session starts");

      // Its language switch is the app's.
      await page.getByRole("button", { name: "VI", exact: true }).click();
      await page.getByTestId("trial-banner").filter({ hasText: "miễn phí đến hết 28 tháng 2 năm 2027" }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem("lp.lang")), "vi");
      await page.getByRole("button", { name: "EN", exact: true }).click();
      await page.getByTestId("trial-banner").filter({ hasText: "is free until" }).waitFor();

      // A session takes the whole screen; leaving gives the tabs back.
      await page.goto(`${APP}/vision/track?demo=1`);
      await page.getByTestId("stage").waitFor();
      await page.waitForSelector('.shell[data-focus="on"]');
      assert.equal(await page.locator(".shell-nav").isVisible(), false);
      await page.getByTestId("wv-exit").click();
      // Asks first only while tracking is running.
      if (await page.getByTestId("exit-modal").isVisible()) await page.getByTestId("exit-confirm").click();
      await page.waitForSelector(".shell:not([data-focus])");

      await page.goto(`${APP}/vision/track?challenge=999999`);
      await page.getByText("This challenge could not be found.").waitFor();
      assert.ok(calls.some((c) => /^GET \/api\/v1\/app\/clubs\/[^/]+\/vision\/challenges\/999999$/.test(c)), calls.join("\n"));
      assert.deepEqual(calls.filter((c) => /\/api\/(arena|wolf-vision)\//.test(c)), [], "only the app API");
      assert.deepEqual(problems.filter((p) => !/404|MEDIA_ERR|media|video|Failed to load resource/i.test(p)), []);
    } finally {
      await context.close();
    }
  });
});

describe("APP · every screen's states (build plan §7: loading, empty, error, offline)", () => {
  test("APP46 · each screen whose data can't load says so, with Try again, and comes back when it works", async () => {
    const { context } = await signedIn(PEOPLE.member.email, { viewport: { width: 1000, height: 900 } });
    const page = await context.newPage();
    const club = `${api}/clubs/three-wolves`;
    // Screen → the call it can't do without (a glob), and what shows once it works.
    const cases = [
      ["/me", `${club}/me`, ME_READY],
      ["/arena", `${club}/arena`, '[data-screen="nav_arena"][data-state="ready"]'],
      ["/leaderboard", `${club}/leaderboard*`, '[data-screen="nav_leaderboard"][data-state="ready"]'],
      ["/player", `${club}/me/stats`, '[data-screen="nav_player"][data-state="ready"]'],
      ["/vision", `${club}/vision`, '[data-screen="nav_vision"][data-state="ready"]'],
      ["/membership", `${club}/membership`, '[data-screen="membership"][data-state="ready"]'],
      ["/inbox", `${club}/messages`, ".thread-link, .inbox-empty, [data-screen='inbox']"],
      ["/settings", `${api}/account/profile`, "#details-title, [data-screen='nav_settings'] form"],
      // Cards on Me: the shop and My photos.
      ["/me", `${club}/shop`, ME_READY],
      ["/me", `${club}/me/photos`, '[data-testid="my-photos"]'],
    ];
    const failing = { status: 500, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ error: "failed" }) };
    try {
      for (const [route, url, ready] of cases) {
        const handler = (r) => (r.request().method() === "OPTIONS" ? r.fulfill({ status: 204, headers: CORS }) : r.fulfill(failing));
        await context.route(url, handler);
        await page.goto(`${APP}${route}`);
        const error = page.getByTestId("load-error");
        await error.waitFor({ timeout: 20000 }).catch((e) => {
          throw new Error(`${route} with ${url} failing shows no error: ${e.message.split("\n")[0]}`);
        });
        assert.equal(await error.getAttribute("role"), "alert", route);
        assert.match(await error.textContent(), /couldn't load this/, `${route} (${url})`);
        await context.unroute(url, handler);
        await error.getByRole("button", { name: "Try again" }).click();
        await page.waitForSelector(ready);
        await error.waitFor({ state: "detached" });
      }
    } finally {
      await context.close();
    }
  });
});

describe("APP · performance on a mid-range phone (build plan §4.4)", () => {
  // CPU four times slower and a slow 4G connection (150 ms, ~1.6 Mbit/s).
  // The limits leave room for slower CI machines; they catch regressions,
  // not milliseconds. The numbers are printed on every run.
  const LIMITS = { firstStart: 9000, savedStart: 4000, tab: 4500 };
  test("APP47 · first start, a start from the saved screens, and switching tabs stay within their limits", async () => {
    const { context } = await signedIn(PEOPLE.member.email, { serviceWorkers: "allow" });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    const timed = async (go, ready) => {
      const t0 = Date.now();
      await go();
      await page.waitForSelector(ready, { timeout: 30000 });
      return Date.now() - t0;
    };
    try {
      const firstStart = await timed(() => page.goto(`${APP}/me`), ME_READY);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => (localStorage.getItem("lp.cache") ?? "").includes('"me"'));
      const savedStart = await timed(() => page.reload(), ME_READY);
      const tabs = {};
      for (const [label, ready] of [
        ["Leaderboard", '[data-screen="nav_leaderboard"][data-state="ready"]'],
        ["Player", '[data-screen="nav_player"][data-state="ready"]'],
        ["Arena", '[data-screen="nav_arena"][data-state="ready"]'],
        ["Me", ME_READY],
      ]) {
        tabs[label] = await timed(() => page.locator(".shell-nav").getByRole("link", { name: label }).click(), ready);
      }
      console.log(`APP47 timings (ms): first start ${firstStart}, saved start ${savedStart}, tabs ${JSON.stringify(tabs)}`);
      assert.ok(firstStart < LIMITS.firstStart, `first start ${firstStart} ms`);
      assert.ok(savedStart < LIMITS.savedStart, `start from the saved screens ${savedStart} ms`);
      for (const [label, ms] of Object.entries(tabs)) assert.ok(ms < LIMITS.tab, `${label} ${ms} ms`);
    } finally {
      await context.close();
    }
  });
});

describe("APP · fonts", () => {
  test("APP48 · Luvallplay's own fonts before sign-in, the club's fonts from its website after", async () => {
    const loaded = (page, family) => page.evaluate(async (f) => {
      await document.fonts.ready;
      return [...document.fonts].filter((x) => x.family.replace(/["']/g, "") === f && x.status === "loaded").length;
    }, family);
    const anon = await browser.newContext({ viewport: PHONE, serviceWorkers: "block" });
    const page = await anon.newPage();
    const problems = watch(page);
    await page.goto(`${APP}/signin`);
    await page.getByRole("button").first().waitFor();
    assert.ok((await loaded(page, "Be Vietnam Pro")) > 0, "Be Vietnam Pro");
    assert.ok((await loaded(page, "Barlow Condensed")) > 0, "Barlow Condensed");
    await anon.close();

    const { context } = await signedIn(PEOPLE.member.email);
    const club = await context.newPage();
    const clubProblems = watch(club);
    await club.goto(`${APP}/me`);
    await club.waitForSelector(ME_READY);
    const faces = await club.evaluate(() => [...document.fonts].map((f) => f.family.replace(/["']/g, "")));
    assert.ok(faces.includes("Copperplate") && faces.includes("Montserrat"), faces.join(", "));
    assert.ok((await loaded(club, "Montserrat")) > 0, "Montserrat, from the club's website");
    assert.ok((await loaded(club, "Copperplate")) > 0, "Copperplate, from the club's website");
    // The website lets the app read them (fonts need it across origins).
    const r = await fetch(`${env.base}/fonts/UTM-Copperplate.ttf`, { headers: { Origin: APP } });
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual([...problems, ...clubProblems], []);
    await context.close();
  });
});

describe("APP · My photos", () => {
  test("APP45 · My photos on Me: not set up without a photo store; with one, photos are prepared on the device, go straight to the store and are registered with the caption and consent", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    const miaId = (await db.query(`SELECT id FROM players WHERE email = $1`, [PEOPLE.member.email])).rows[0].id;
    try {
      // The real API: no photo store in this environment.
      await page.goto(`${APP}/me`);
      await page.waitForSelector(ME_READY);
      await page.getByTestId("my-photos").getByText("Photo sharing isn't set up yet.").waitFor();

      // A store connected (stood in for): the upload handshake, the store's upload API, and registering.
      const base = `${env.base}/api/v1/app/clubs/three-wolves/me/photos`;
      const added = [];
      const handshakes = [];
      const stored = [];
      const cors = { ...CORS, "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" };
      await context.route(base, async (route) => {
        const r = route.request();
        if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        if (r.method() === "POST") {
          added.push(r.postDataJSON());
          return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ ok: true, id: 70 + added.length, status: "needs_review" }) });
        }
        return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ photos: [], uploadMode: "token", perDay: 20 }) });
      });
      await context.route(`${base}/upload`, async (route) => {
        const r = route.request();
        if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        handshakes.push({ body: r.postDataJSON(), auth: r.headers()["authorization"] });
        return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ type: "blob.generate-client-token", clientToken: "vercel_blob_client_e2estore_dGVzdA" }) });
      });
      await context.route("https://vercel.com/api/blob/**", async (route) => {
        const r = route.request();
        const open = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "PUT, POST, OPTIONS", "access-control-expose-headers": "*" };
        if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: open });
        const pathname = new URL(r.url()).searchParams.get("pathname");
        stored.push(pathname);
        const url = `https://e2estore.public.blob.vercel-storage.com/${pathname}`;
        return route.fulfill({ status: 200, headers: { ...open, "content-type": "application/json" }, body: JSON.stringify({ url, downloadUrl: `${url}?download=1`, pathname, contentType: "image/webp", contentDisposition: "inline" }) });
      });
      await page.reload();
      await page.waitForSelector(ME_READY);
      const card = page.getByTestId("my-photos");
      await card.getByRole("button", { name: "Choose photos" }).waitFor();
      const png = Buffer.from(
        await page.evaluate(() => {
          const c = document.createElement("canvas");
          c.width = c.height = 64;
          const x = c.getContext("2d");
          x.fillStyle = "#3a6";
          x.fillRect(0, 0, 64, 64);
          return c.toDataURL("image/png").split(",")[1];
        }),
        "base64",
      );
      await page.getByTestId("photo-library").setInputFiles([
        { name: "net.png", mimeType: "image/png", buffer: png },
        { name: "rally.png", mimeType: "image/png", buffer: png },
      ]);
      await card.getByText("2 photo(s) selected").waitFor();
      await card.getByLabel("Caption (optional)").fill("Club night");
      const share = card.getByRole("button", { name: "Share 2 photo(s)" });
      assert.equal(await share.isDisabled(), true, "not without the consent line");
      await card.getByRole("checkbox").check();
      await share.click();
      await page.waitForFunction(() => document.querySelectorAll(".photo-jobs li .photo-wait").length === 2 && [...document.querySelectorAll(".photo-jobs li span")].every((s) => s.textContent === "Under review"));

      assert.equal(added.length, 2);
      for (const a of added) {
        assert.deepEqual([a.consent, a.caption, a.width, a.height], [true, "Club night", 64, 64]);
        for (const k of ["originalUrl", "displayUrl", "thumbUrl"]) assert.match(a[k], new RegExp(`^https://e2estore\\.public\\.blob\\.vercel-storage\\.com/photos/${miaId}/`));
      }
      assert.equal(handshakes.length, 6, "three files a photo: original, display copy, thumbnail");
      assert.ok(handshakes.every((h) => /^Bearer /.test(h.auth ?? "")), "the handshake carries the session");
      assert.ok(handshakes.every((h) => h.body.payload.pathname.startsWith(`photos/${miaId}/`)));
      assert.deepEqual(stored.map((p) => p.replace(/^.*-(original|display|thumb)\..*$/, "$1")).sort(), ["display", "display", "original", "original", "thumb", "thumb"]);
      assert.deepEqual(problems.filter((p) => !/Failed to load resource/i.test(p)), []);
    } finally {
      await context.close();
    }
  });
});

describe("APP · offline and installing (build plan §4.1)", () => {
  const meFor = async (token) => (await fetch(`${env.base}/api/v1/app/clubs/three-wolves/me`, { headers: { authorization: `Bearer ${token}` } })).json();

  test("APP42 · offline: the app and Me open from this device, Can't make it waits on it and is sent when the connection is back", async () => {
    const { context, token } = await signedIn(PEOPLE.member.email, { serviceWorkers: "allow" });
    const page = await context.newPage();
    const problems = watch(page);
    const next = (await meFor(token)).calendar.find((d) => !d.paused && d.included && !d.booked && !d.absent);
    const absentRow = async () => (await db.query(`SELECT 1 FROM player_absences WHERE session_date = $1 AND email = $2`, [next.date, PEOPLE.member.email])).rowCount;
    const nextCard = page.getByRole("region", { name: "Next up" });
    try {
      await page.goto(`${APP}/me`);
      await page.waitForSelector(ME_READY);
      // The service worker takes over, and Me is saved on the device.
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await page.waitForSelector(ME_READY);
      assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true);
      await page.waitForFunction(() => (localStorage.getItem("lp.cache") ?? "").includes('"me"'));

      await context.setOffline(true);
      await page.reload();
      await page.waitForSelector(ME_READY);
      await page.getByRole("status").filter({ hasText: "You're offline: this is what was saved on this device." }).waitFor();

      await nextCard.getByRole("button", { name: "Can't make it" }).click();
      await nextCard.getByRole("button", { name: "I can come after all" }).waitFor();
      await nextCard.getByRole("status").filter({ hasText: "Saved on this device" }).waitFor();
      assert.equal(await absentRow(), 0, "not sent yet");
      assert.match(await page.evaluate(() => localStorage.getItem("lp.queue")), new RegExp(next.date));

      // Still waiting after a restart without a connection.
      await page.waitForTimeout(1500); // the saved copy is written a moment after a change
      await page.reload();
      await page.waitForSelector(ME_READY);
      await nextCard.getByRole("button", { name: "I can come after all" }).waitFor();

      // Back online: sent, and Me shows the club's own answer.
      await context.setOffline(false);
      await page.waitForFunction(() => localStorage.getItem("lp.queue") === null);
      for (let i = 0; i < 50 && !(await absentRow()); i++) await new Promise((r) => setTimeout(r, 100));
      assert.equal(await absentRow(), 1);
      await nextCard.getByRole("button", { name: "I can come after all" }).waitFor();
      assert.deepEqual(problems.filter((p) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/i.test(p)), []);
    } finally {
      await context.setOffline(false);
      await db.query(`DELETE FROM player_absences WHERE session_date = $1 AND email = $2`, [next.date, PEOPLE.member.email]);
      await context.close();
    }
  });

  test("APP43 · installing: a manifest with icons, the service worker served fresh, and the Install card (the browser's prompt, or the steps on an iPhone)", async () => {
    const html = await (await fetch(`${APP}/me`)).text();
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
    const manifest = await (await fetch(`${APP}/manifest.webmanifest`)).json();
    assert.deepEqual([manifest.name, manifest.display, manifest.start_url], ["Luvallplay", "standalone", "/me"]);
    for (const icon of manifest.icons.filter((i) => i.type === "image/png")) {
      const r = await fetch(`${APP}${icon.src}`);
      assert.equal(r.headers.get("content-type"), "image/png", icon.src);
      const png = Buffer.from(await r.arrayBuffer());
      const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      assert.equal(`${w}x${h}`, icon.sizes, icon.src);
    }
    assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
    const sw = await (await fetch(`${APP}/sw.js`)).text();
    const assets = JSON.parse(sw.match(/const ASSETS = (\[.*?\]);/)[1]);
    assert.ok(assets.some((a) => /\/assets\/Me-.*\.js$/.test(a)) && assets.some((a) => /\/assets\/index-.*\.js$/.test(a)), "the screens are kept on the device");
    assert.equal(assets.some((a) => a.startsWith("/mediapipe/") || a.startsWith("/api/")), false);

    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    try {
      await page.goto(`${APP}/settings`);
      await page.waitForSelector('[data-screen="nav_settings"]');
      assert.equal(await page.locator("[data-install]").count(), 0, "nothing to offer when the browser offers nothing");
      // The browser offers its prompt.
      await page.evaluate(() => {
        const e = new Event("beforeinstallprompt");
        e.prompt = async () => { window.__prompted = true; };
        e.userChoice = Promise.resolve({ outcome: "accepted" });
        window.dispatchEvent(e);
      });
      await page.getByRole("button", { name: "Install" }).click();
      await page.getByText("Installed: open it from your home screen.").waitFor();
      assert.equal(await page.evaluate(() => window.__prompted), true);
    } finally {
      await context.close();
    }
    const iphone = await signedIn(PEOPLE.member.email, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    const p2 = await iphone.context.newPage();
    try {
      await p2.goto(`${APP}/settings`);
      await p2.getByText("On an iPhone or iPad: tap Share, then Add to Home Screen.").waitFor();
    } finally {
      await iphone.context.close();
    }
  });
});

describe("APP · layout (build plan §4.4)", () => {
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  test("APP10 · five widths: no sideways scroll, and the right navigation for each window class", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    for (const route of ["/me", "/inbox", "/player", "/arena", "/leaderboard", "/vision", "/vision/track", "/vision/label", "/membership", "/settings"]) {
      await page.goto(`${APP}${route}`);
      await page.waitForSelector(route === "/vision/track" ? '[data-testid="mode-camera"]' : route === "/vision/label" ? '[data-screen="vision-label"]' : route === "/me" ? ME_READY : route === "/inbox" ? ".thread-link" : route === "/arena" ? '[data-screen="nav_arena"][data-state="ready"]' : route === "/leaderboard" ? '[data-screen="nav_leaderboard"][data-state="ready"]' : route === "/player" ? '[data-screen="nav_player"][data-state="ready"]' : route === "/membership" ? '[data-screen="membership"][data-state="ready"]' : route === "/vision" ? '[data-screen="nav_vision"][data-state="ready"]' : ".shell-nav .tab");
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
    const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block" });
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
    for (const route of ["/me", "/inbox", "/player", "/arena", "/leaderboard", "/vision", "/vision/track", "/vision/label", "/membership", "/settings"]) {
      await page.goto(`${APP}${route}`);
      await page.waitForSelector(route === "/vision/track" ? '[data-testid="mode-camera"]' : route === "/vision/label" ? '[data-screen="vision-label"]' : route === "/me" ? ME_READY : route === "/inbox" ? ".thread-link" : route === "/arena" ? '[data-screen="nav_arena"][data-state="ready"]' : route === "/leaderboard" ? '[data-screen="nav_leaderboard"][data-state="ready"]' : route === "/player" ? '[data-screen="nav_player"][data-state="ready"]' : route === "/membership" ? '[data-screen="membership"][data-state="ready"]' : route === "/vision" ? '[data-screen="nav_vision"][data-state="ready"]' : ".shell-nav .tab");
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
    const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block", reducedMotion: "reduce" });
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
      const anon = await browser.newContext({ viewport: PHONE, serviceWorkers: "block", colorScheme, bypassCSP: true });
      for (const [ctx, route, ready] of [[anon, "/signin", "form"], [anon, "/c/three-wolves", "form"], [context, "/me", ME_READY], [context, "/inbox", ".inbox-list .button"], [context, "/inbox/new", "form textarea"], [context, "/settings", "text=Signed in as"], [context, "/welcome", "#welcome-title"], [context, "/vision", '[data-screen="nav_vision"][data-state="ready"]'], [context, "/vision/label", '[data-testid="label-file"]'], [context, "/membership", '[data-screen="membership"][data-state="ready"]'], [context, "/arena", '[data-screen="nav_arena"]']]) {
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

  test("APP14 · the built page carries a strict Content-Security-Policy that names only the API host, Stripe's, the tracker's models and the photo store", async () => {
    const html = await (await fetch(`${APP}/signin`)).text();
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
    assert.match(csp, /default-src 'self'/);
    // Stripe's published hosts, for the card form (loaded only on a payment step);
    // WebAssembly (the tracker's runtime) may compile, but no script may eval.
    assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' https:\/\/js\.stripe\.com(;|$)/);
    assert.match(csp, /frame-src https:\/\/js\.stripe\.com https:\/\/hooks\.stripe\.com(;|$)/);
    assert.match(csp, /style-src 'self'(;|$)/);
    // Videos chosen on the device only (the tracker and the labelling tool).
    assert.match(csp, /media-src 'self' blob:(;|$)/);
    assert.match(csp, new RegExp(`connect-src 'self' ${env.base.replace(/[.:/]/g, "\\$&")} https://api\\.luvallplay\\.com https://api\\.stripe\\.com https://storage\\.googleapis\\.com https://vercel\\.com/api/blob/ https://\\*\\.public\\.blob\\.vercel-storage\\.com(;|$)`));
    assert.match(csp, /worker-src 'self' blob:(;|$)/);
    // Fonts: the app's own, and a club's from its website (the API host).
    assert.match(csp, new RegExp(`font-src 'self' ${env.base.replace(/[.:/]/g, "\\$&")} https://api\\.luvallplay\\.com(;|$)`));
    // The one wildcard is the photo store's own host (its name carries the store's id).
    assert.doesNotMatch(csp.replace("https://*.public.blob.vercel-storage.com", ""), /unsafe-inline|'unsafe-eval'|\*/);
    // Images from any https host (club logos, photos in Blob storage); nothing else is widened.
    assert.match(csp, /img-src 'self' data: blob: https: /);
    assert.doesNotMatch(csp.match(/connect-src[^;]*/)[0], /https:(\s|$)/);
    assert.doesNotMatch(html, /<script(?![^>]+src=)[^>]*>/);
    // And it bites: a request to any other host is refused by the page itself.
    const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block" });
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
