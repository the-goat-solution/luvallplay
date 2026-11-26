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
const { chromium, devices } = require("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const pg = createRequire(path.join(WEB_DIR, "package.json"))("pg");

const COURT_GREEN = "#0e6b4f";
const NAVY = "#184467";
const NAVY_DARK_MODE = "#1e5a8a";
// 382: half of iPhone Duo's inner display in Split View; 466: its outer display's width (on a phone-height window here).
const WIDTHS = [320, 375, 382, 466, 600, 840, 1200];
const NAV_AT = { 320: "bar", 375: "bar", 382: "bar", 466: "bar", 600: "rail", 840: "rail", 1200: "sidebar" };
const PHONE = { width: 375, height: 812 };
const STORE = { ios: "https://apps.apple.com/app/luvallplay/id0000000000", android: "https://play.google.com/store/apps/details?id=com.luvallplay.app" };

let env;
let PEOPLE;
let JOIN_CLUB_SQL;
let preview;
let browser;
let db;
let api;

before(async () => {
  // The API allows this origin, exactly as APP_ORIGINS will in production.
  process.env.APP_ORIGINS = APP;
  // Juniors is hidden platform-wide (Phase 3b ships dark). The test server offers it, as a preview would;
  // it stays off for the club until a journey switches it on (the Family journeys).
  process.env.JUNIORS_AVAILABILITY = "available";
  // A throwaway key so a made-up child's medical note can be encrypted in these journeys.
  process.env.JUNIORS_KEKS = `e2e:${Buffer.alloc(32, 7).toString("base64")}`;
  process.chdir(WEB_DIR); // the environment script runs the web app's own scripts
  const e2e = await import(path.join(WEB_DIR, "scripts/e2e/env.mjs"));
  PEOPLE = e2e.PEOPLE;
  JOIN_CLUB_SQL = e2e.JOIN_CLUB_SQL;
  env = await e2e.startEnv({ log: () => {} });
  api = `${env.base}/api/v1/app`;

  // Store links as if the store apps were live, so "Get the app" can be seen (APP49); computers never get it.
  const build = spawnSync("npx", ["vite", "build", "--outDir", OUT, "--emptyOutDir"], { cwd: APP_DIR, encoding: "utf8", env: { ...process.env, VITE_API_BASE: env.base, VITE_APP_STORE_URL: STORE.ios, VITE_PLAY_STORE_URL: STORE.android } });
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
  // An account made straight in the database is in no club yet.
  await db.query(JOIN_CLUB_SQL, [rows[0].id]);
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
const ME_READY = '[data-screen="nav_home"][data-state="ready"]';
/** My profile with the membership loaded (the pill says what it is). */
const PROFILE_READY = '[data-screen="nav_profile"] .profile-head .pill';

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
// Harbour Smash's play days: Tuesdays with casual spots, two weeks out, and a conversation.
const tuesdayIn = (weeks) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((2 - d.getUTCDay() + 7) % 7 || 7) + 7 * weeks);
  return d.toISOString().slice(0, 10);
};
const HARBOUR_DAYS = [0, 1].map((w) => ({ date: tuesdayIn(w), startTime: `${tuesdayIn(w)}T05:30:00Z`, endTime: `${tuesdayIn(w)}T07:30:00Z`, location: "Harbour Hall", included: false, booked: false, absent: false, paused: false, closed: false, bookable: true, spots: 6 - w }));
const HARBOUR_THREAD = { id: 1, subject: "New courts on Tuesdays", preview: "From next week we have two more courts.", unread: true, lastMessageAt: new Date().toISOString() };

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
    const body = { ...mine, membership: null, join: { monthly: 4000, quarterly: 11000, days: ["tuesday"] }, calendar: HARBOUR_DAYS, inbox: { unread: 1, latest: [HARBOUR_THREAD] }, welcome: false };
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) });
  });
  await serveJson(context, `${api}/clubs/harbour-smash/messages`, async () => ({ threads: [{ ...HARBOUR_THREAD, status: "open", lastSender: "admin" }] }));
  await serveJson(context, `${api}/clubs/harbour-smash/messages/1`, async () => ({ thread: { id: 1, subject: HARBOUR_THREAD.subject, status: "open", messages: [{ id: 1, sender: "admin", body: HARBOUR_THREAD.preview, createdAt: HARBOUR_THREAD.lastMessageAt }] } }));
  // Its Player and Vision: the same person's, as Three Wolves answers them (the shapes are what matter here).
  const mirror = async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = route.request().url().replace("/clubs/harbour-smash/", "/clubs/three-wolves/");
    const answer = await fetch(url, { headers: { authorization: route.request().headers().authorization } });
    return route.fulfill({ status: answer.status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" }, body: await answer.text() });
  };
  await context.route(`${api}/clubs/harbour-smash/me/stats`, mirror);
  await context.route(new RegExp(`^${api.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/clubs/harbour-smash/vision(\\?.*)?$`), mirror);
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
    assert.equal(await page.title(), "Sign in · Luvallplay");

    await fetch(`${env.base}/api/dev/outbox`, { method: "DELETE" });
    await page.getByLabel("Email").fill("  Mia.Member@E2E.test ");
    await page.getByRole("button", { name: "Send my code" }).click();
    await page.waitForSelector("text=Check your email");
    assert.equal((await look(page)).primary, COURT_GREEN, "the code step is still Luvallplay's");
    await page.getByLabel("6-digit code").fill(await outboxCode(PEOPLE.member.email));
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(`${APP}/home`);
    await page.waitForSelector(".shell");
    await page.waitForFunction((navy) => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase() === navy, NAVY);
    assert.deepEqual(await look(page), { primary: NAVY, look: "club", mode: "light", lang: "en" });
    assert.equal(await page.locator(".club-name").textContent(), "Three Wolves Badminton Club");
    assert.equal(await page.title(), "Home · Three Wolves Badminton Club · Luvallplay");
    assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), NAVY);
    await page.waitForSelector(ME_READY);
    // The club's own word for Vision is on the tab; the frame's mark stays.
    assert.deepEqual(await tabLabels(page), ["Home", "Player", "Arena", "Leaderboard", "Wolf Vision"]);
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

    await page.getByRole("link", { name: "My profile" }).click();
    await page.waitForURL(`${APP}/profile`);
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

  test("APP2b · Send a new code: after a pause, said when sent, and the new code signs in", async () => {
    const context = await browser.newContext({ viewport: PHONE, serviceWorkers: "block" });
    // Its two code requests come from an address of their own, so they don't
    // use up the ten per address per 15 minutes the other journeys share.
    await context.route(`${api}/auth/email/start`, (route) =>
      route.request().method() === "OPTIONS" ? route.fallback() : route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": "203.0.113.9" } }),
    );
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(`${APP}/signin`);
    await fetch(`${env.base}/api/dev/outbox`, { method: "DELETE" });
    await page.getByLabel("Email").fill(PEOPLE.coach.email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await page.waitForSelector("text=Check your email");
    const first = await outboxCode(PEOPLE.coach.email);
    // Not straight away: the email may just be slow.
    assert.equal(await page.getByRole("button", { name: /Send a new code \(\d+s\)/ }).isDisabled(), true);
    await page.clock.fastForward(31_000);
    await fetch(`${env.base}/api/dev/outbox`, { method: "DELETE" });
    await page.getByRole("button", { name: "Send a new code", exact: true }).click();
    await page.getByRole("status").filter({ hasText: `A new code is on its way to ${PEOPLE.coach.email}` }).waitFor();
    const second = await outboxCode(PEOPLE.coach.email);
    assert.notEqual(second, first);
    await page.getByLabel("6-digit code").fill(second);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${APP}/home`);
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
    await page.waitForURL(`${APP}/home`);
    await page.waitForSelector(ME_READY);
    assert.equal(await page.evaluate(() => localStorage.getItem("lp.club")), "three-wolves");
    assert.equal((await look(page)).primary, NAVY);
    assert.deepEqual(problems, []);

    // Already signed in: the link goes straight to the club.
    await page.goto(`${APP}/c/three-wolves`);
    await page.waitForURL(`${APP}/home`);
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

  test("APP4 · several clubs: Home brings them together in Luvallplay's look, each item tagged with its club; the filter narrows it and is kept", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    await withSecondClub(context);
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${APP}/me`);
    await page.waitForSelector(`${ME_READY}[data-home="clubs"]`);
    assert.deepEqual(await look(page), { primary: COURT_GREEN, look: "luvallplay", mode: "light", lang: "en" }, "Home is Luvallplay's, not one club's");
    assert.equal(await page.locator(".shell-head .club-name").textContent(), "Luvallplay");
    assert.equal(await page.getByRole("button", { name: "Switch club" }).count(), 0, "no switching on Home");

    const filter = page.getByRole("group", { name: "Show" });
    const names = (buttons) => buttons.evaluateAll((els) => els.map((b) => (b.querySelector(".club-tag-name") ?? b).textContent.trim()));
    assert.deepEqual(await names(filter.getByRole("button")), ["All clubs", "Three Wolves Badminton Club", "Harbour Smash"]);
    // Next up is the earliest day across clubs, with its club.
    const next = page.locator(".next-up");
    assert.match(await next.textContent(), /Three Wolves Badminton Club/);
    // The way in at the club she isn't a member of; memberships themselves are in My profile.
    assert.equal(await page.locator(".membership").count(), 0);
    assert.match(await page.locator(".join").textContent(), /Harbour Smash/);
    // One calendar: both clubs' days, each row its club's, the Harbour days bookable there.
    const days = page.locator(".days .day");
    const clubOfRow = await days.evaluateAll((rows) => rows.map((r) => r.querySelector(".club-tag-name")?.textContent));
    assert.ok(clubOfRow.includes("Harbour Smash") && clubOfRow.includes("Three Wolves Badminton Club"), JSON.stringify(clubOfRow));
    assert.equal(await days.filter({ hasText: "Harbour Smash" }).first().getByRole("button", { name: /^Book · \$10/ }).count(), 1, "Harbour's price, in its money");
    // Messages from both, the bell counts both.
    assert.match(await page.locator(".threads").first().textContent(), /New courts on Tuesdays[\s\S]*Welcome to Fridays|Welcome to Fridays[\s\S]*New courts on Tuesdays/);
    assert.equal(await page.locator(".top-actions .badge").textContent(), "2", "the bell counts both clubs");
    assert.equal(await page.locator('[id]').evaluateAll((els) => { const ids = els.map((e) => e.id); return ids.length - new Set(ids).size; }), 0, "no id twice on the page");

    // Narrowed to one club: only its things; kept after a reload.
    await filter.getByRole("button", { name: "Harbour Smash" }).click();
    await filter.getByRole("button", { name: "Three Wolves Badminton Club" }).click();
    assert.equal(await page.locator(".join").count(), 0, "narrowed to Three Wolves: no way in to Harbour");
    await filter.getByRole("button", { name: "Harbour Smash" }).click();
    assert.equal(await page.locator(".join").count(), 1);
    assert.deepEqual([...new Set(await page.locator(".days .day .club-tag-name").allTextContents())], ["Harbour Smash"]);
    await page.reload();
    await page.waitForSelector(ME_READY);
    assert.equal(await filter.getByRole("button", { name: "Harbour Smash" }).getAttribute("aria-pressed"), "true");
    await filter.getByRole("button", { name: "All clubs" }).click();
    assert.ok((await page.locator(".days .day").count()) > 2);

    // My profile: one card per club, each tagged; the pill counts the memberships.
    await page.locator(".top-actions .head-avatar").click();
    await page.waitForSelector(PROFILE_READY);
    assert.equal(await page.locator(".profile-head .pill").textContent(), "Member at 1 of 2 clubs");
    assert.match(await page.locator(".membership").textContent(), /Three Wolves Badminton Club/);
    assert.match(await page.locator(".join").textContent(), /Harbour Smash/);
    assert.deepEqual((await look(page)).look, "luvallplay");
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("APP4b · several clubs: a club's space wears its look and is picked in the top bar; a club without the space isn't offered; back on Home it's Luvallplay's at once", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    await withSecondClub(context);
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${APP}/vision`);
    await page.waitForSelector('[data-screen="nav_vision"]');
    assert.equal((await look(page)).primary, NAVY);
    // Every club's tabs, each in the words of the club it opens.
    assert.deepEqual(await tabLabels(page), ["Home", "Player", "Arena", "Leaderboard", "Wolf Vision"]);

    const picker = page.getByRole("button", { name: /Three Wolves Badminton Club, Switch club/ });
    await picker.click();
    assert.deepEqual(await page.locator(".switcher-item .switcher-name").allTextContents(), ["Three Wolves Badminton Club", "Harbour Smash"]);
    await page.getByRole("button", { name: "Harbour Smash" }).click();
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase() === "#7a1f3d");
    assert.equal(await page.locator(".shell-head .club-name").textContent(), "Harbour Smash");
    assert.equal(await page.locator(".shell-head .club-logo").count(), 0, "nothing of the last club's logo lingers");
    assert.deepEqual(await tabLabels(page), ["Home", "Player", "Arena", "Leaderboard", "Smash Cam"]);
    await page.waitForURL(`${APP}/vision`);

    // Harbour has no Arena: the Arena shows the club that has one, with nothing to pick.
    await page.locator(".shell-nav").getByRole("link", { name: "Arena" }).click();
    await page.waitForSelector('[data-screen="nav_arena"]');
    assert.equal((await look(page)).primary, NAVY);
    assert.equal(await page.getByRole("button", { name: /Switch club/ }).count(), 0);

    // Player: the last club picked (Harbour) is kept.
    await page.locator(".shell-nav").getByRole("link", { name: "Player" }).click();
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase() === "#7a1f3d");

    const started = Date.now();
    await page.locator(".shell-nav").getByRole("link", { name: "Home" }).click();
    await page.waitForFunction((green) => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase() === green, COURT_GREEN);
    assert.ok(Date.now() - started < 1500, "the look changes at once");
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("APP4c · several clubs: one inbox for all of them; a conversation is its club's; a new message starts with the club", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    await withSecondClub(context);
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${APP}/inbox`);
    const list = page.locator(".inbox-list");
    await list.getByText("New courts on Tuesdays").waitFor();
    await list.getByText("Welcome to Fridays").waitFor();
    await list.getByRole("link", { name: /New courts on Tuesdays/ }).click();
    await page.waitForURL(/\/inbox\/1\?club=harbour-smash$/);
    const detail = page.locator(".inbox-detail");
    await detail.getByText("From next week we have two more courts.").waitFor();
    assert.match(await detail.locator(".message-who").first().textContent(), /^Harbour Smash/, "the club's own name on its messages");
    assert.match(await detail.textContent(), /Harbour Smash/);

    await page.goto(`${APP}/inbox/new`);
    const pick = page.locator(".pick-club");
    await pick.waitFor();
    assert.deepEqual(await pick.locator(".club-tag-name").allTextContents(), ["Three Wolves Badminton Club", "Harbour Smash"]);
    await pick.getByRole("link", { name: /Harbour Smash/ }).click();
    await page.waitForURL(/\/inbox\/new\?club=harbour-smash$/);
    assert.equal(await page.locator(".compose-to .club-tag-name").textContent(), "Harbour Smash");
    assert.match(await page.locator(".compose-to").textContent(), /^Write to/);
    assert.equal(await page.getByLabel("Subject").count(), 1);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("APP5b · Vision is for badminton clubs: a club that plays another sport has no Vision tab and no Vision screen, whatever it switched on", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const base = await realConfig();
    assert.ok(base.modules.includes("vision") && base.club.sports.includes("badminton"), "Three Wolves plays badminton and has Vision on");
    await serveJson(context, `${api}/clubs/three-wolves/config`, async () => ({ ...base, club: { ...base.club, sports: ["tennis"] } }));
    const page = await context.newPage();
    await page.goto(`${APP}/home`);
    await page.waitForSelector(ME_READY);
    assert.deepEqual(await tabLabels(page), ["Home", "Player", "Arena", "Leaderboard"]);
    await page.goto(`${APP}/vision`);
    await page.waitForURL(`${APP}/home`);
    await context.close();
  });

  test("APP5 · a module the club has off: its tab and its screen are gone; the others stay", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const base = await realConfig();
    await serveJson(context, `${api}/clubs/three-wolves/config`, async () => ({ ...base, modules: base.modules.filter((m) => m !== "vision") }));
    const page = await context.newPage();
    await page.goto(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    assert.deepEqual(await tabLabels(page), ["Home", "Player", "Arena", "Leaderboard"]);
    await page.goto(`${APP}/vision`);
    await page.waitForURL(`${APP}/home`);
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
    // The greeting (no picture on Home: it's in the top bar), and the bell with the unread count.
    assert.match(await page.locator(".greeting h1").textContent(), /^Good (morning|afternoon|evening), Mia$/);
    assert.equal(await page.locator("[data-screen=nav_home] .avatar").count(), 0);
    assert.equal(await page.locator(".top-actions .head-icon").getAttribute("aria-label"), `Inbox, ${data.inbox.unread} unread`);
    assert.equal(await page.locator(".top-actions .head-avatar").getAttribute("href"), "/profile");
    // Next up: her first Friday, included in her membership.
    const next = data.calendar.find((d) => !d.paused && (d.booked || d.included));
    const nextCard = page.getByRole("region", { name: "Next up" });
    assert.equal(await nextCard.locator(".next-date").textContent(), await dayKey(page, next.date));
    assert.match(await nextCard.textContent(), /Pioneer Stadium/);
    assert.match(await nextCard.textContent(), /Included in your membership/);
    assert.equal(await page.locator(".membership").count(), 0, "the membership is in My profile");
    assert.equal(await page.locator(".join").count(), 0, "no join card for a member");
    // Calendar: every play day, her Fridays marked as hers.
    assert.equal(await page.locator(".day").count(), data.calendar.length);
    assert.equal(await page.locator(".day-yours").count(), data.calendar.filter((d) => d.included && !d.absent).length);
    assert.ok((await page.locator(".month").count()) >= 1);
    // Inbox: the club's unread message, opening in the app's inbox; so does the bell.
    const thread = page.locator(".thread.unread").first();
    assert.match(await thread.textContent(), /Welcome to Fridays/);
    assert.equal(await thread.locator("a").getAttribute("href"), `/inbox/${data.inbox.latest[0].id}`);
    assert.equal(await page.locator(".top-actions .head-icon").getAttribute("href"), "/inbox");
    assert.equal(await page.locator(".welcome").count(), 0);
    // My profile (her picture in the top bar): name, the membership pill, and the membership: plan and day, status, days left, Manage.
    await page.locator(".top-actions .head-avatar").click();
    await page.waitForSelector(PROFILE_READY);
    assert.equal(await page.locator(".profile-head h1").textContent(), "Mia Member");
    assert.equal(await page.locator(".profile-head .pill").textContent(), `Active · renews ${await dayKey(page, data.membership.periodEnd)}`);
    const card = page.locator(".membership");
    assert.equal(await card.getByRole("heading").textContent(), "Monthly · Fridays");
    assert.equal(await card.locator(".status").textContent(), "Active");
    assert.equal(await card.locator(".stat-value").textContent(), String(data.membership.daysLeft));
    const manage = card.getByRole("link", { name: /Manage membership/ });
    assert.equal(await manage.getAttribute("href"), "/membership");
    assert.equal(await page.locator(".join").count(), 0, "no join card for a member");
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

  test("APP17 · Can't make it the server can't take waits and shows; one the club refuses is put back and said", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    let answer = { status: 500, body: '{"error":"failed"}' };
    let calls = 0;
    await context.route(`${api}/clubs/three-wolves/me/absence`, (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      calls++;
      return route.fulfill({ status: answer.status, headers: { ...CORS, "content-type": answer.type ?? "application/json" }, body: answer.body });
    });
    const page = await context.newPage();
    await page.goto(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    const nextCard = page.getByRole("region", { name: "Next up" });
    const calendar = page.getByRole("region", { name: "Play calendar" });

    // The server is down: the choice stays on screen (also over a fresh Me) and waits on this device.
    await nextCard.getByRole("button", { name: "Can't make it" }).click();
    await nextCard.getByRole("button", { name: "I can come after all" }).waitFor();
    await nextCard.getByRole("status").filter({ hasText: "Saved on this device" }).waitFor();
    assert.equal(await page.locator(".day", { hasText: "You said you can't come" }).count(), 1);
    assert.match(await page.evaluate(() => localStorage.getItem("lp.queue")), /"absent":true/);
    await page.reload();
    await page.waitForSelector(ME_READY);
    await nextCard.getByRole("button", { name: "I can come after all" }).waitFor();

    // A Wi-Fi sign-in page answering "200" in the API's place: still waiting, nothing dropped.
    answer = { status: 200, type: "text/html", body: "<html>Sign in to Wi-Fi</html>" };
    const before = calls;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(500);
    assert.ok(calls > before, "tried again");
    assert.match(await page.evaluate(() => localStorage.getItem("lp.queue")), /"absent":true/);
    assert.equal(await calendar.getByRole("alert").count(), 0);

    // The club says no for good: the day goes back, and the person is told (until they close it).
    answer = { status: 409, body: '{"error":"too_late"}' };
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await calendar.getByRole("alert").filter({ hasText: "couldn't be saved" }).waitFor();
    await nextCard.getByRole("button", { name: "Can't make it" }).waitFor();
    assert.equal(await page.locator(".day", { hasText: "You said you can't come" }).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("lp.queue")), null);
    await calendar.getByRole("alert").getByRole("button", { name: "Close" }).click();
    assert.equal(await calendar.getByRole("alert").count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("lp.dropped")), null);
    await context.close();
  });

  test("APP17b · a new screen takes the focus and names itself in the title; a screen that fails says so", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    await page.goto(`${APP}/home`);
    await page.waitForSelector(ME_READY);
    assert.equal(await page.title(), "Home · Three Wolves Badminton Club · Luvallplay");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Player" }).click();
    await page.waitForURL(`${APP}/player`);
    await page.waitForFunction(() => document.title.startsWith("Player · "));
    assert.equal(await page.evaluate(() => document.activeElement?.id), "main", "focus is on the new screen's content");

    // A screen whose code can't be fetched (a broken deploy): one reload is tried, then the error screen, with a way on.
    await context.route(/\/assets\/Leaderboard-[^/]+\.js$/, (route) => route.abort());
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Leaderboard" }).click();
    const crash = page.getByTestId("crash");
    await crash.getByRole("heading", { name: "Something went wrong" }).waitFor();
    await crash.getByRole("button", { name: "Reload the app" }).waitFor();
    await context.unroute(/\/assets\/Leaderboard-[^/]+\.js$/);
    await crash.getByRole("button", { name: "Try again" }).click();
    await page.waitForSelector('[data-screen="nav_leaderboard"]');
    await context.close();
  });

  test("APP18 · not a member: the join card in the club's money, the welcome card, and Done keeps it away", async () => {
    const { context, token } = await signedIn(PEOPLE.player.email);
    const { rows } = await db.query(`SELECT id, welcome_card_dismissed_at FROM players WHERE email = $1`, [PEOPLE.player.email]);
    const page = await context.newPage();
    try {
      await page.goto(`${APP}/me`);
      await page.waitForSelector(ME_READY);
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
    await page.getByRole("heading", { name: "Sắp tới" }).waitFor();
    await page.getByRole("heading", { name: "Lịch chơi" }).waitFor();
    assert.match(await page.locator(".greeting h1").textContent(), /^Chào buổi (sáng|chiều|tối), Mia$/);
    await page.goto(`${APP}/profile`);
    await page.waitForSelector(PROFILE_READY);
    assert.equal(await page.locator(".membership").getByRole("heading").textContent(), "Hàng tháng · Thứ Sáu");
    assert.match(await page.locator(".profile-head .pill").textContent(), /^Đang hoạt động · gia hạn /);
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
    await page.waitForSelector('[data-screen="nav_home"][data-state="error"]', { timeout: 15_000 });
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
      // Back to the list: read now, and the bell has nothing unread.
      await page.getByRole("link", { name: "All messages" }).click();
      await page.waitForURL(`${APP}/inbox`);
      assert.equal(await page.locator(".thread.unread").count(), 0);
      assert.match(await page.locator(".thread-preview").first().textContent(), /^You: Thanks, see you there/);
      await page.locator(".shell-nav").getByRole("link", { name: "Home", exact: true }).click();
      await page.waitForSelector(ME_READY);
      await page.waitForFunction(() => document.querySelector(".top-actions .head-icon")?.getAttribute("aria-label") === "Inbox");
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
    assert.deepEqual(await tabLabels(page), ["Trang chủ", "Người chơi", "Đấu trường", "Xếp hạng", "Wolf Vision"]);
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
      // Home and My profile follow at once (no reload).
      await page.locator(".shell-nav").getByRole("link", { name: "Home", exact: true }).click();
      await page.waitForSelector(ME_READY);
      assert.match(await page.locator(".greeting h1").textContent(), /, Peter$/);
      await page.goto(`${APP}/profile`);
      await page.waitForSelector(".profile-head h1");
      await page.waitForFunction(() => document.querySelector(".profile-head h1")?.textContent === "Peter Player-Smith");
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
    const photo = page.locator("section.card", { has: page.getByRole("heading", { name: "Profile picture" }) });
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

  test("APP30 · deleting the account: two taps (ask, then yes), back to sign-in; the club's only owner is told to hand over first", async () => {
    const owner = await signedIn(PEOPLE.owner.email);
    const op = await owner.context.newPage();
    await op.goto(`${APP}/settings`);
    await op.getByRole("button", { name: "Delete my account" }).click();
    await op.getByText("Delete your account? You'll be signed out everywhere.").waitFor();
    assert.equal(await op.getByRole("button", { name: "Delete my account", exact: true }).count(), 0, "the first button gives way to the question");
    await op.getByRole("button", { name: "Yes, delete my account" }).click();
    await op.getByRole("alert").filter({ hasText: "only owner" }).waitFor();
    await owner.context.close();

    const email = `app.delete.${Date.now()}@e2e.test`;
    const id = (await db.query(`INSERT INTO players (email, first_name, last_name, claimed_at) VALUES ($1, 'Dee', 'Leted', NOW()) RETURNING id`, [email])).rows[0].id;
    const { context, token } = await signedIn(email);
    const page = await context.newPage();
    await page.goto(`${APP}/settings`);
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByRole("button", { name: "Cancel" }).last().click();
    assert.equal(await page.getByRole("button", { name: "Yes, delete my account" }).count(), 0, "Cancel closes it");
    assert.equal((await db.query(`SELECT deleted_at FROM players WHERE id = $1`, [id])).rows[0].deleted_at, null, "one tap deletes nothing");
    await page.getByRole("button", { name: "Delete my account", exact: true }).click();
    await page.getByRole("button", { name: "Yes, delete my account" }).click();
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
      // Two taps: the question first (Cancel keeps it), then Disconnect.
      await page.getByRole("button", { name: "Disconnect: Habit tracker" }).click();
      const asking = page.getByRole("group", { name: "Disconnect: Habit tracker" });
      await asking.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Disconnect: Habit tracker" }).click();
      await asking.getByRole("button", { name: "Disconnect" }).click();
      await asking.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Disconnect: Habit tracker" }).waitFor({ state: "detached" });
      assert.equal((await db.query(`SELECT 1 FROM api_tokens WHERE player_id = $1 AND revoked_at IS NULL`, [peteId])).rowCount, 0);

      await page.getByText(/^Webhooks \(\d+\)$/).click();
      await page.getByPlaceholder("https://").fill("https://localhost/hook");
      await page.getByRole("button", { name: "Add webhook" }).click();
      await page.getByRole("alert").filter({ hasText: "public https://" }).waitFor();
      await page.getByPlaceholder("https://").fill("https://hooks.example.com/tw");
      await page.getByRole("button", { name: "Add webhook" }).click();
      await page.getByRole("status").filter({ hasText: "Signing secret" }).waitFor();
      // Two taps: the question first (Cancel keeps it), then Disconnect.
      await page.getByRole("button", { name: "Disconnect: https://hooks.example.com/tw" }).click();
      const askingHook = page.getByRole("group", { name: "Disconnect: https://hooks.example.com/tw" });
      await askingHook.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Disconnect: https://hooks.example.com/tw" }).click();
      await askingHook.getByRole("button", { name: "Disconnect" }).click();
      await askingHook.waitFor({ state: "detached" });
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
      await a.page.waitForURL(`${APP}/home`);
      await a.page.waitForSelector(ME_READY);
      assert.equal(await a.page.getByText("Add your name so your club knows who you are.").count(), 0);
      assert.deepEqual((await db.query(`SELECT first_name, last_name FROM players WHERE email = $1`, [first])).rows[0], { first_name: "Nina", last_name: "New" });
      await a.context.close();

      const b = await signUp(second);
      await b.page.getByRole("link", { name: "Cancel" }).click();
      await b.page.waitForURL(`${APP}/home`);
      await b.page.getByRole("link", { name: "Add my name" }).click();
      await b.page.waitForURL(`${APP}/welcome`);
      await b.page.getByLabel("First name").fill("Ned");
      await b.page.getByRole("button", { name: "Continue" }).click();
      await b.page.waitForURL(`${APP}/home`);
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
      // Exactly the days chosen, at any hour: it closes at the end of the club's day, 7 to 8 days away, and whole days are counted.
      assert.match(await card.textContent(), /open 7 days/);
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
      await mp.locator(".shell-nav").getByRole("link", { name: "Home" }).click();
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
        // The saved copy of the club's settings shows first; the fresh one takes the Arena away.
        await p2.getByRole("heading", { name: "Kit bag" }).waitFor({ state: "detached" });
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
      // The club's config changed (it has a Stripe key now). The screens saved on
      // this device hold a copy under a minute old, which the app rightly keeps
      // using for that minute; drop it, as if the minute had passed.
      // Dropped as the page starts again, not before: a save that was already
      // on its way (they're written a moment after a change) would put it back.
      await page.addInitScript(() => localStorage.removeItem("lp.cache"));
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
      await page.goto(`${APP}/profile`);
      await page.waitForSelector(PROFILE_READY);
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

describe("APP · Family (Phase 3b: a guardian's children; journey J1, the guardian's part)", () => {
  const FAMILY = '[data-screen="family"][data-state="ready"]';
  const auth = (token) => ({ headers: { authorization: `Bearer ${token}` } });
  const juniorsOn = () =>
    db.query(
      `INSERT INTO tenant_modules (tenant_id, module_id, enabled, enabled_at, settings) VALUES
         (1, 'forms-waivers', TRUE, now(), '{}'::jsonb),
         (1, 'juniors', TRUE, now(), '{"safeguarding":{"version":"2026-11","byPlayerId":1,"at":"2026-11-26T00:00:00.000Z"}}'::jsonb)
       ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = TRUE, settings = EXCLUDED.settings`,
    );
  const juniorsOff = async () => {
    await db.query(`UPDATE sessions s SET booked_spots = GREATEST(0, s.booked_spots - (SELECT count(*) FROM junior_bookings b WHERE b.session_date = s.date AND b.status IN ('pending', 'confirmed')))`);
    await db.query(`DELETE FROM junior_bookings`);
    await db.query(`TRUNCATE junior_safety_checks`);
    await db.query(`DELETE FROM form_signatures`);
    await db.query(`DELETE FROM club_forms`);
    await db.query(`DELETE FROM junior_medical_notes`);
    await db.query(`DELETE FROM junior_emergency_contacts`);
    await db.query(`DELETE FROM guardianships`);
    await db.query(`DELETE FROM junior_profiles`);
    await db.query(`DELETE FROM tenant_modules WHERE module_id IN ('juniors', 'forms-waivers')`);
  };

  test("APP52 · Juniors off (as every club is today): no Family row, the endpoints answer 404, and the address says it is off", async () => {
    await juniorsOff();
    const { context, token } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    try {
      assert.ok(!(await realConfig()).modules.includes("juniors"));
      const r = await fetch(`${api}/clubs/three-wolves/family`, auth(token));
      assert.equal(r.status, 404);
      assert.equal((await r.json()).error, "module_off");
      const add = await fetch(`${api}/clubs/three-wolves/family`, { method: "POST", headers: { ...auth(token).headers, "content-type": "application/json" }, body: JSON.stringify({ name: "Test Child", birthYear: 2016, guardianConfirmed: true }) });
      assert.equal(add.status, 404);
      await page.goto(`${APP}/profile`);
      await page.waitForSelector(PROFILE_READY);
      assert.equal(await page.locator('[data-entry="family"]').count(), 0);
      await page.goto(`${APP}/family`);
      await page.waitForSelector('[data-screen="family"][data-state="off"]');
      assert.equal(await page.locator('[data-action="family-add"]').count(), 0);
      // A row written by hand without an owner's acknowledgement is still off (Juniors fails closed).
      await db.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled, enabled_at) VALUES (1, 'forms-waivers', TRUE, now()), (1, 'juniors', TRUE, now())`);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family`, auth(token))).status, 404);
    } finally {
      await juniorsOff();
      await context.close();
    }
  });

  test("APP53 · a guardian adds a child, switches one consent on, and corrects the name; another person sees none of it; no account is made for the child", async () => {
    await juniorsOn();
    const accountsBefore = (await db.query(`SELECT count(*)::int AS n FROM players`)).rows[0].n;
    const { context, token } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    try {
      await page.goto(`${APP}/profile`);
      await page.waitForSelector(PROFILE_READY);
      await page.locator('[data-entry="family"]').click();
      await page.waitForURL(`${APP}/family`);
      await page.waitForSelector(FAMILY);
      await page.getByText("You haven't added a child yet.").waitFor();

      await page.locator('[data-action="family-add"]').click();
      const form = page.locator('[data-form="family-add"]');
      // Refused in turn: no name, a name that is an email address, no confirmation.
      await form.getByRole("button", { name: "Save" }).click();
      await form.getByRole("alert").filter({ hasText: "Enter the child's name." }).waitFor();
      await form.getByLabel("Child's name").fill("kid@example.test");
      await form.getByLabel("Year of birth").selectOption("2016");
      await form.getByRole("button", { name: "Save" }).click();
      await form.getByRole("alert").filter({ hasText: "confirm you are this child's parent or guardian" }).waitFor();
      await form.getByLabel(/I am this child's parent or legal guardian/).check();
      await form.getByRole("button", { name: "Save" }).click();
      await form.getByRole("alert").filter({ hasText: "no email address, phone number or link" }).waitFor();
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM junior_profiles`)).rows[0].n, 0);

      await form.getByLabel("Child's name").fill("Tama Testchild");
      await form.getByRole("button", { name: "Save" }).click();
      await page.getByRole("status").filter({ hasText: "Tama Testchild was added." }).waitFor();
      const card = page.locator("[data-child]");
      await card.getByRole("heading", { name: "Tama Testchild" }).waitFor();
      await card.getByText("Born 2016").waitFor();
      // Everything optional starts off.
      for (const item of ["leaderboard", "photos", "vision"]) assert.equal(await card.locator(`[data-consent="${item}"]`).isChecked(), false, item);

      const saved = page.waitForResponse((r) => r.url().endsWith("/consent") && r.request().method() === "PUT");
      await card.locator('[data-consent="photos"]').check();
      assert.equal((await saved).status(), 200);
      await page.reload();
      await page.waitForSelector(FAMILY);
      assert.equal(await page.locator('[data-child] [data-consent="photos"]').isChecked(), true);
      assert.equal(await page.locator('[data-child] [data-consent="vision"]').isChecked(), false);

      await page.locator("[data-child]").getByRole("button", { name: "Edit details" }).click();
      const edit = page.locator('[data-form="family-edit"]');
      await edit.getByLabel("Child's name").fill("Tama T Testchild");
      await edit.getByRole("button", { name: "Save" }).click();
      await page.locator("[data-child]").getByRole("heading", { name: "Tama T Testchild" }).waitFor();

      // The database: one profile in this club with a name and a year, one guardianship, and no new account.
      const rows = (await db.query(`SELECT j.name, j.birth_year, j.tenant_id, g.consent_scope FROM junior_profiles j JOIN guardianships g ON g.junior_profile_id = j.id`)).rows;
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].name, rows[0].birth_year, rows[0].tenant_id], ["Tama T Testchild", 2016, 1]);
      assert.equal(rows[0].consent_scope.items.photos.granted, true);
      assert.equal(rows[0].consent_scope.items.leaderboard.granted, false);
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM players`)).rows[0].n, accountsBefore, "a child gets no account");

      // Another signed-in person: an empty family, and this child can't be read or changed by its id.
      const childId = (await db.query(`SELECT id FROM junior_profiles`)).rows[0].id;
      const other = await sessionToken(PEOPLE.player.email);
      assert.deepEqual((await (await fetch(`${api}/clubs/three-wolves/family`, auth(other))).json()).children, []);
      const tamper = await fetch(`${api}/clubs/three-wolves/family/${childId}/consent`, { method: "PUT", headers: { ...auth(other).headers, "content-type": "application/json" }, body: JSON.stringify({ vision: true }) });
      assert.equal(tamper.status, 404);
      const rename = await fetch(`${api}/clubs/three-wolves/family/${childId}`, { method: "PATCH", headers: { ...auth(other).headers, "content-type": "application/json" }, body: JSON.stringify({ name: "Renamed" }) });
      assert.equal(rename.status, 404);
      // Signed out: nothing at all.
      assert.equal((await fetch(`${api}/clubs/three-wolves/family`)).status, 401);
      // The guardian's own list is as they left it.
      const mine = (await (await fetch(`${api}/clubs/three-wolves/family`, auth(token))).json()).children;
      assert.deepEqual([mine.length, mine[0].name, mine[0].consent], [1, "Tama T Testchild", { leaderboard: false, photos: true, vision: false }]);
      // The one refusal this journey asked for (the email address as a name) and nothing else: no CORS or CSP trouble.
      assert.deepEqual(problems, ["Failed to load resource: the server responded with a status of 400 (Bad Request)"]);
    } finally {
      await juniorsOff();
      await context.close();
    }
  });

  test("APP54 · a guardian books a play day for their child and cancels it; the place is counted and given back; at a club that charges they pay by card and nothing is booked unpaid", async () => {
    await juniorsOn();
    const mode = (await db.query(`SELECT payment_mode FROM tenants WHERE id = 1`)).rows[0].payment_mode;
    await db.query(`UPDATE tenants SET payment_mode = 'free' WHERE id = 1`);
    const { context, token } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    const json = { ...auth(token).headers, "content-type": "application/json" };
    const extra = [];
    try {
      const added = await fetch(`${api}/clubs/three-wolves/family`, { method: "POST", headers: json, body: JSON.stringify({ name: "Tama Testchild", birthYear: 2016, guardianConfirmed: true }) });
      assert.equal(added.status, 200, await added.clone().text());
      const childId = (await db.query(`SELECT id FROM junior_profiles`)).rows[0].id;

      await page.goto(`${APP}/family`);
      await page.waitForSelector(FAMILY);
      const days = page.locator(`[data-bookings="${childId}"] [data-day]`);
      await days.first().waitFor();
      const open = page.locator(`[data-bookings="${childId}"] [data-day]`).filter({ has: page.getByRole("button", { name: "Book a place" }) }).first();
      const date = await open.getAttribute("data-day");
      const row = page.locator(`[data-bookings="${childId}"] [data-day="${date}"]`);
      const spots = async () => (await db.query(`SELECT booked_spots FROM sessions WHERE date = $1`, [date])).rows[0].booked_spots;
      const before = await spots();

      const answered = page.waitForResponse((r) => r.url().endsWith(`/family/${childId}/bookings`) && r.request().method() === "POST");
      await row.getByRole("button", { name: "Book a place" }).click();
      const answer = await answered;
      assert.equal(answer.status(), 200, await answer.text());
      await row.getByRole("button", { name: "Cancel booking" }).waitFor();
      assert.equal(await row.getAttribute("data-booked"), "yes");
      assert.equal(await spots(), before + 1, "the child's place is counted");
      const booked = (await db.query(`SELECT status FROM junior_bookings WHERE junior_profile_id = $1 AND session_date = $2`, [childId, date])).rows;
      assert.equal(booked.length, 1);
      assert.equal(booked[0].status, "confirmed");

      // Booking the same day again changes nothing; another person can't book or cancel for this child.
      const again = await fetch(`${api}/clubs/three-wolves/family/${childId}/bookings`, { method: "POST", headers: json, body: JSON.stringify({ date }) });
      assert.equal(again.status, 200);
      assert.equal(await spots(), before + 1);
      const other = { ...auth(await sessionToken(PEOPLE.player.email)).headers, "content-type": "application/json" };
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/bookings`, { method: "POST", headers: other, body: JSON.stringify({ date }) })).status, 404);
      const bookingId = (await (await fetch(`${api}/clubs/three-wolves/family/bookings`, auth(token))).json()).bookings[0].id;
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/bookings/${bookingId}/cancel`, { method: "POST", headers: other, body: "{}" })).status, 404);
      assert.deepEqual((await (await fetch(`${api}/clubs/three-wolves/family/bookings`, { headers: other })).json()).bookings, []);

      await row.getByRole("button", { name: "Cancel booking" }).click();
      await row.getByRole("button", { name: "Book a place" }).waitFor();
      assert.equal(await spots(), before, "the place is given back");

      // A club that charges: nothing is booked unpaid. The guardian pays by card; the place appears once the payment succeeds.
      await db.query(`UPDATE tenants SET payment_mode = 'online' WHERE id = 1`);
      const unpaid = await fetch(`${api}/clubs/three-wolves/family/${childId}/bookings`, { method: "POST", headers: json, body: JSON.stringify({ date }) });
      assert.deepEqual([unpaid.status, (await unpaid.json()).error], [409, "payment_needed"]);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/bookings/pay`, { method: "POST", headers: other, body: JSON.stringify({ date }) })).status, 404, "only the child's guardian can start a payment");
      assert.equal(await spots(), before);
      const paying = await signedIn(PEOPLE.member.email);
      extra.push(paying.context);
      await withStripe(paying.context);
      let asked;
      await paying.context.route(`${api}/clubs/three-wolves/family/${childId}/bookings/pay`, (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        asked = route.request().postDataJSON();
        return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ clientSecret: "pi_junior_secret_e2e", amountMinor: 1000, currency: "NZD" }) });
      });
      const payPage = await paying.context.newPage();
      const payProblems = watch(payPage);
      await payPage.goto(`${APP}/family`);
      await payPage.waitForSelector(FAMILY);
      const payRow = payPage.locator(`[data-bookings="${childId}"] [data-day="${date}"]`);
      await payRow.getByRole("button", { name: /^Book and pay / }).click();
      const dialog = payPage.getByRole("dialog", { name: "Book a place" });
      await dialog.locator(".fake-card-fields").waitFor();
      await dialog.getByRole("button", { name: /^Pay / }).click();
      await payPage.getByRole("status").filter({ hasText: "Payment received." }).waitFor();
      assert.deepEqual(asked, { date });
      assert.deepEqual(payProblems, []);
      assert.equal(await spots(), before, "the app books nothing itself: the payment provider's report does");

      // The paid booking as the payment's report writes it (tests/juniors-payments.test.ts): shown as paid, with no cancel in the app.
      await db.query(`INSERT INTO junior_bookings (tenant_id, junior_profile_id, session_date, booked_by_user_id, payment_intent_id, amount_minor, currency, status) SELECT 1, $1, $2, g.guardian_user_id, 'pi_junior_e2e', 1000, 'NZD', 'confirmed' FROM guardianships g WHERE g.junior_profile_id = $1`, [childId, date]);
      await db.query(`UPDATE sessions SET booked_spots = booked_spots + 1 WHERE date = $1`, [date]);
      await page.reload();
      await page.waitForSelector(FAMILY);
      await row.getByText("Booked and paid. To cancel, contact the club.").waitFor();
      assert.equal(await row.getByRole("button").count(), 0);
      const paidId = (await db.query(`SELECT id FROM junior_bookings WHERE payment_intent_id = 'pi_junior_e2e'`)).rows[0].id;
      const refused = await fetch(`${api}/clubs/three-wolves/family/bookings/${paidId}/cancel`, { method: "POST", headers: json, body: "{}" });
      assert.deepEqual([refused.status, (await refused.json()).error], [409, "paid_booking"]);
      assert.equal(await spots(), before + 1);
      assert.deepEqual(problems, []);
    } finally {
      for (const c of extra) await c.close();
      await db.query(`UPDATE tenants SET payment_mode = $1 WHERE id = 1`, [mode]);
      await juniorsOff();
      await context.close();
    }
  });

  test("APP55 · a guardian records who to call and a medical note for their child; the note is stored encrypted; nobody else can read or change either", async () => {
    await juniorsOn();
    const { context, token } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    const json = { ...auth(token).headers, "content-type": "application/json" };
    const NOTE = "Asthma: blue inhaler in the bag.";
    try {
      const added = await fetch(`${api}/clubs/three-wolves/family`, { method: "POST", headers: json, body: JSON.stringify({ name: "Tama Testchild", birthYear: 2016, guardianConfirmed: true }) });
      assert.equal(added.status, 200);
      const childId = (await db.query(`SELECT id FROM junior_profiles`)).rows[0].id;

      await page.goto(`${APP}/family`);
      await page.waitForSelector(FAMILY);
      const care = page.locator(`[data-care="${childId}"]`);
      // Closed until asked for: no contact or note is fetched with the card.
      assert.equal(await care.locator("form").count(), 0);
      await care.getByRole("button", { name: "Show" }).click();
      const contacts = care.locator('[data-form="care-contacts"]');
      await contacts.waitFor();

      // A contact without a phone number is refused; with one it is saved.
      await contacts.getByRole("button", { name: "Add a contact" }).click();
      await contacts.getByLabel("Name").fill("Nan Guardian");
      await contacts.getByRole("button", { name: "Save contacts" }).click();
      await contacts.getByRole("alert").filter({ hasText: "Enter a phone number for each contact." }).waitFor();
      await contacts.getByLabel("Phone").fill("021 555 0101");
      await contacts.getByLabel("Relationship (optional)").fill("Grandmother");
      await contacts.getByRole("button", { name: "Save contacts" }).click();
      await contacts.getByRole("status").filter({ hasText: "Contacts saved." }).waitFor();
      assert.deepEqual((await db.query(`SELECT position, name, phone, relationship FROM junior_emergency_contacts`)).rows, [{ position: 1, name: "Nan Guardian", phone: "021 555 0101", relationship: "Grandmother" }]);

      const notes = care.locator('[data-form="care-notes"]');
      await notes.getByLabel("Medical notes").fill(NOTE);
      await notes.getByRole("button", { name: "Save notes" }).click();
      await notes.getByRole("status").filter({ hasText: "Notes saved." }).waitFor();
      const sealed = (await db.query(`SELECT sealed FROM junior_medical_notes WHERE junior_profile_id = $1`, [childId])).rows[0].sealed;
      assert.match(sealed, /^v1\.e2e\./);
      assert.ok(!sealed.includes("Asthma") && !sealed.includes("inhaler"), "the database holds no readable note");

      // Back later: both are there for the guardian.
      await page.reload();
      await page.waitForSelector(FAMILY);
      await page.locator(`[data-care="${childId}"]`).getByRole("button", { name: "Show" }).click();
      assert.equal(await page.locator(`[data-care="${childId}"] [data-form="care-notes"]`).getByLabel("Medical notes").inputValue(), NOTE);
      assert.equal(await page.locator(`[data-care="${childId}"] [data-contact="1"]`).getByLabel("Name").inputValue(), "Nan Guardian");

      // Another signed-in person: can't read or change either. Signed out: nothing.
      const other = { ...auth(await sessionToken(PEOPLE.player.email)).headers, "content-type": "application/json" };
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/care`, { headers: other })).status, 404);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/care/contacts`, { method: "PUT", headers: other, body: JSON.stringify({ contacts: [] }) })).status, 404);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/care/medical-notes`, { method: "PUT", headers: other, body: JSON.stringify({ notes: "changed" }) })).status, 404);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/care`)).status, 401);
      const mine = await (await fetch(`${api}/clubs/three-wolves/family/${childId}/care`, auth(token))).json();
      assert.deepEqual([mine.contacts.length, mine.medicalNotes, mine.medicalNotesAvailable], [1, NOTE, true]);
      // The one refusal this journey asked for (the contact with no phone number) and nothing else.
      assert.deepEqual(problems, ["Failed to load resource: the server responded with a status of 400 (Bad Request)"]);
    } finally {
      await juniorsOff();
      await context.close();
    }
  });

  test("APP56 · a guardian reads the club's waiver and signs it for their child by typing their name; new wording asks again; nobody else can sign for the child", async () => {
    await juniorsOn();
    const { context, token } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    const json = { ...auth(token).headers, "content-type": "application/json" };
    const publish = async (version, body) =>
      (await db.query(`INSERT INTO club_forms (tenant_id, slug, version, kind, title, body, published_by_user_id) VALUES (1, 'junior-waiver', $1, 'waiver', 'Junior waiver', $2, 1) RETURNING id`, [version, body])).rows[0].id;
    try {
      const added = await fetch(`${api}/clubs/three-wolves/family`, { method: "POST", headers: json, body: JSON.stringify({ name: "Tama Testchild", birthYear: 2016, guardianConfirmed: true }) });
      assert.equal(added.status, 200);
      const childId = (await db.query(`SELECT id FROM junior_profiles`)).rows[0].id;

      // A club that asks for nothing shows no forms part.
      await page.goto(`${APP}/family`);
      await page.waitForSelector(FAMILY);
      await page.locator(`[data-care="${childId}"]`).waitFor();
      assert.equal(await page.locator(`[data-forms="${childId}"]`).count(), 0);

      const v1 = await publish(1, "I accept the risks of playing badminton for my child.\n\nI will collect my child on time.");
      await page.reload();
      await page.waitForSelector(FAMILY);
      const part = page.locator(`[data-forms="${childId}"]`);
      await part.locator("[data-forms-status]").filter({ hasText: "1 to sign" }).waitFor();
      await part.getByRole("button", { name: "Read and sign" }).click();
      const dialog = page.getByRole("dialog", { name: "Junior waiver" });
      await dialog.getByText("I will collect my child on time.").waitFor();
      // No name, no signature.
      await dialog.getByRole("button", { name: "Sign" }).click();
      await dialog.getByRole("alert").waitFor();
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM form_signatures`)).rows[0].n, 0);
      await dialog.getByLabel("Type your full name to sign").fill("Mia Guardian");
      await dialog.getByRole("button", { name: "Sign" }).click();
      await part.locator("[data-forms-status]").filter({ hasText: "All signed" }).waitFor();
      await part.getByText(/^Signed by Mia Guardian on /).waitFor();
      const rows = (await db.query(`SELECT form_id, junior_profile_id, signed_name FROM form_signatures`)).rows;
      assert.deepEqual(rows, [{ form_id: v1, junior_profile_id: childId, signed_name: "Mia Guardian" }]);

      // Another signed-in person can't see or sign for this child; signed out, nothing.
      const other = { ...auth(await sessionToken(PEOPLE.player.email)).headers, "content-type": "application/json" };
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/forms`, { headers: other })).status, 404);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/forms/${v1}/sign`, { method: "POST", headers: other, body: JSON.stringify({ name: "Someone Else" }) })).status, 404);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/forms`)).status, 401);

      // The club rewords the form: asked again, and the old version can no longer be signed.
      const v2 = await publish(2, "New wording.");
      const old = await fetch(`${api}/clubs/three-wolves/family/${childId}/forms/${v1}/sign`, { method: "POST", headers: json, body: JSON.stringify({ name: "Mia Guardian" }) });
      assert.deepEqual([old.status, (await old.json()).error], [409, "not_current"]);
      await page.reload();
      await page.waitForSelector(FAMILY);
      await page.locator(`[data-forms="${childId}"] [data-forms-status]`).filter({ hasText: "1 to sign" }).waitFor();
      const mine = (await (await fetch(`${api}/clubs/three-wolves/family/${childId}/forms`, auth(token))).json()).forms;
      assert.deepEqual(mine.map((f) => [f.id, f.version, f.signedAt]), [[v2, 2, null]]);
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM form_signatures`)).rows[0].n, 1, "the first signature is kept as a record");
      assert.deepEqual(problems, []);
    } finally {
      await juniorsOff();
      await context.close();
    }
  });

  test("APP57 · a guardian downloads everything the club holds about their child, then deletes it for good; a coming place blocks the delete; nobody else can do either", async () => {
    await juniorsOn();
    const mode = (await db.query(`SELECT payment_mode FROM tenants WHERE id = 1`)).rows[0].payment_mode;
    await db.query(`UPDATE tenants SET payment_mode = 'free' WHERE id = 1`);
    const { context, token } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const problems = watch(page);
    const json = { ...auth(token).headers, "content-type": "application/json" };
    const put = (path, body) => fetch(`${api}/clubs/three-wolves/family/${path}`, { method: "PUT", headers: json, body: JSON.stringify(body) });
    try {
      const added = await fetch(`${api}/clubs/three-wolves/family`, { method: "POST", headers: json, body: JSON.stringify({ name: "Tama Testchild", birthYear: 2016, guardianConfirmed: true }) });
      assert.equal(added.status, 200);
      const childId = (await db.query(`SELECT id FROM junior_profiles`)).rows[0].id;
      assert.equal((await put(`${childId}/care/contacts`, { contacts: [{ name: "Nan Guardian", phone: "021 555 0101" }] })).status, 200);
      assert.equal((await put(`${childId}/care/medical-notes`, { notes: "Asthma: blue inhaler." })).status, 200);
      const formId = (await db.query(`INSERT INTO club_forms (tenant_id, slug, version, kind, title, body, published_by_user_id) VALUES (1, 'junior-waiver', 1, 'waiver', 'Junior waiver', 'Words.', 1) RETURNING id`)).rows[0].id;
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/forms/${formId}/sign`, { method: "POST", headers: json, body: JSON.stringify({ name: "Mia Guardian" }) })).status, 200);
      const date = (await (await fetch(`${api}/clubs/three-wolves/family/bookings`, auth(token))).json()).days.find((d) => d.spotsLeft > 0).date;
      const booked = await (await fetch(`${api}/clubs/three-wolves/family/${childId}/bookings`, { method: "POST", headers: json, body: JSON.stringify({ date }) })).json();

      // The export, as the endpoint gives it: everything, the note in plain words.
      const all = await (await fetch(`${api}/clubs/three-wolves/family/${childId}/export`, auth(token))).json();
      assert.deepEqual([all.child.name, all.child.birthYear, all.emergencyContacts.length, all.medicalNotes.notes, all.forms.length, all.bookings.length], ["Tama Testchild", 2016, 1, "Asthma: blue inhaler.", 1, 1]);
      // Nobody else: another signed-in person gets 404 for both; signed out, 401.
      const other = { ...auth(await sessionToken(PEOPLE.player.email)).headers, "content-type": "application/json" };
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/export`, { headers: other })).status, 404);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/delete`, { method: "POST", headers: other, body: JSON.stringify({ confirm: true }) })).status, 404);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/export`)).status, 401);
      const unconfirmed = await fetch(`${api}/clubs/three-wolves/family/${childId}/delete`, { method: "POST", headers: json, body: JSON.stringify({ confirm: false }) });
      assert.deepEqual([unconfirmed.status, (await unconfirmed.json()).error], [400, "confirm_required"]);

      await page.goto(`${APP}/family`);
      await page.waitForSelector(FAMILY);
      const rights = page.locator(`[data-rights="${childId}"]`);
      // The download: a file with the child's information.
      const download = page.waitForEvent("download");
      await rights.getByRole("button", { name: "Download" }).click();
      const file = await download;
      assert.equal(file.suggestedFilename(), "child-information.json");
      const saved = JSON.parse(await (await import("node:fs/promises")).readFile(await file.path(), "utf8"));
      assert.deepEqual([saved.child.name, saved.medicalNotes.notes], ["Tama Testchild", "Asthma: blue inhaler."]);

      // A coming place blocks the delete, and nothing is removed.
      await rights.getByRole("button", { name: "Delete" }).click();
      const dialog = page.getByRole("dialog", { name: "Delete Tama Testchild's information?" });
      await dialog.getByRole("button", { name: "Delete for good" }).click();
      await rights.getByRole("alert").filter({ hasText: "Cancel this child's coming play days first." }).waitFor();
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM junior_medical_notes`)).rows[0].n, 1);

      assert.equal((await fetch(`${api}/clubs/three-wolves/family/bookings/${booked.booking.id}/cancel`, { method: "POST", headers: json, body: "{}" })).status, 200);
      await rights.getByRole("button", { name: "Delete" }).click();
      // Changing your mind keeps everything.
      await dialog.getByRole("button", { name: "Keep" }).click();
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM junior_medical_notes`)).rows[0].n, 1);
      await rights.getByRole("button", { name: "Delete" }).click();
      await dialog.getByRole("button", { name: "Delete for good" }).click();
      await page.getByRole("status").filter({ hasText: "Tama Testchild's information was deleted." }).waitFor();
      await page.getByText("You haven't added a child yet.").waitFor();

      const left = (await db.query(`SELECT (SELECT count(*) FROM junior_medical_notes)::int AS notes, (SELECT count(*) FROM junior_emergency_contacts)::int AS contacts, (SELECT count(*) FROM form_signatures)::int AS signatures, (SELECT count(*) FROM junior_bookings)::int AS bookings`)).rows[0];
      assert.deepEqual(left, { notes: 0, contacts: 0, signatures: 0, bookings: 1 });
      const profile = (await db.query(`SELECT name, birth_year, deleted_at IS NOT NULL AS deleted FROM junior_profiles WHERE id = $1`, [childId])).rows[0];
      assert.deepEqual(profile, { name: "(deleted)", birth_year: null, deleted: true });
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/export`, auth(token))).status, 404);
      // The one refusal this journey asked for (the delete while a place was held) and nothing else.
      assert.deepEqual(problems, ["Failed to load resource: the server responded with a status of 409 (Conflict)"]);
    } finally {
      await db.query(`UPDATE tenants SET payment_mode = $1 WHERE id = 1`, [mode]);
      await juniorsOff();
      await context.close();
    }
  });

  test("APP58 · the club's side: Admin → Juniors isn't there while Juniors is off; on, an owner records a safety check, sees it as valid, and withdraws it", async () => {
    await juniorsOff();
    const owner = await signedIn(PEOPLE.owner.email);
    const page = await owner.context.newPage();
    const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    try {
      await page.goto(`${APP}/settings`);
      await page.getByRole("button", { name: "Club admin" }).click();
      await page.waitForURL(`${env.base}/admin`);
      // Off: no menu entry, and the page isn't served.
      assert.equal(await page.getByRole("link", { name: "Juniors", exact: true }).count(), 0);
      assert.equal((await page.goto(`${env.base}/admin/juniors`)).status(), 404);

      await juniorsOn();
      await page.goto(`${env.base}/admin`);
      // On: the menu has it (the menu can sit behind its drawer at this window size, so the page is opened by its address).
      assert.equal(await page.getByRole("link", { name: "Juniors", exact: true }).first().getAttribute("href"), "/admin/juniors");
      assert.equal((await page.goto(`${env.base}/admin/juniors`)).status(), 200);
      await page.getByRole("heading", { name: "Safety checks" }).waitFor();
      await page.getByText(/no current safety check\./).waitFor();
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM junior_safety_checks`)).rows[0].n, 0);

      // Dates the wrong way round are refused and nothing is written.
      const ownerId = (await db.query(`SELECT id FROM players WHERE lower(email) = lower($1)`, [PEOPLE.owner.email])).rows[0].id;
      const form = page.locator("#record form");
      const fill = async (doneOn, expiresOn) => {
        await form.getByLabel("Person").selectOption(String(ownerId));
        await form.getByLabel("Kind of check").selectOption("police-vet");
        await form.getByLabel("Done on").evaluate((el, v) => { el.removeAttribute("max"); el.value = v; }, doneOn);
        await form.getByLabel("Expires on").evaluate((el, v) => { el.removeAttribute("min"); el.value = v; }, expiresOn);
        await form.getByLabel(/Your reference/).fill("Folder B");
        await form.getByRole("button", { name: "Record the check" }).click();
      };
      await fill(day(-1), day(365 * 4));
      await page.getByText("Check the dates").first().waitFor();
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM junior_safety_checks`)).rows[0].n, 0);

      await fill(day(-1), day(365));
      await page.getByText("Safety check recorded.").first().waitFor();
      const row = (await db.query(`SELECT user_id, kind, reference, recorded_by_user_id, revoked_at FROM junior_safety_checks`)).rows;
      assert.deepEqual(row, [{ user_id: ownerId, kind: "police-vet", reference: "Folder B", recorded_by_user_id: ownerId, revoked_at: null }]);
      const mine = page.locator("#safety-checks tr, #safety-checks [role=row]").filter({ hasText: "Police vet" });
      await mine.getByText("valid", { exact: true }).waitFor();
      // The audit log says who and what kind, never the club's reference.
      const logged = (await db.query(`SELECT action, meta::text AS meta FROM admin_audit_log WHERE action LIKE 'juniors.safety_check.%' ORDER BY id`)).rows;
      assert.ok(logged.some((l) => l.action === "juniors.safety_check.record"), JSON.stringify(logged));
      assert.ok(!logged.some((l) => l.meta.includes("Folder B")), "the reference isn't logged");

      page.once("dialog", (d) => d.accept());
      await mine.getByRole("button", { name: "Withdraw" }).click();
      await page.getByText("Safety check withdrawn.").first().waitFor();
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM junior_safety_checks WHERE revoked_at IS NOT NULL`)).rows[0].n, 1);
      await page.locator("#safety-checks").getByText("withdrawn", { exact: true }).waitFor();
    } finally {
      await juniorsOff();
      await owner.context.close();
    }
  });

  test("APP59 · the junior roster: closed without a safety check; with one, the day's children, their guardian and who to call, marking who came; the medical note opens for an owner and is logged, never for an admin", async () => {
    await juniorsOn();
    const mode = (await db.query(`SELECT payment_mode FROM tenants WHERE id = 1`)).rows[0].payment_mode;
    await db.query(`UPDATE tenants SET payment_mode = 'free' WHERE id = 1`);
    const guardian = await sessionToken(PEOPLE.member.email);
    const json = { ...auth(guardian).headers, "content-type": "application/json" };
    const owner = await signedIn(PEOPLE.owner.email);
    const admin = await signedIn(PEOPLE.admin.email);
    const page = await owner.context.newPage();
    const idOf = async (email) => (await db.query(`SELECT id FROM players WHERE lower(email) = lower($1)`, [email])).rows[0].id;
    const check = async (email) => db.query(`INSERT INTO junior_safety_checks (tenant_id, user_id, kind, checked_on, expires_on, recorded_by_user_id) VALUES (1, $1, 'police-vet', CURRENT_DATE - 30, CURRENT_DATE + 300, $1)`, [await idOf(email)]);
    const NOTE = "Asthma: blue inhaler in the bag.";
    try {
      // A guardian's made-up child with a contact, a note and a place on a play day.
      assert.equal((await fetch(`${api}/clubs/three-wolves/family`, { method: "POST", headers: json, body: JSON.stringify({ name: "Tama Testchild", birthYear: 2016, guardianConfirmed: true }) })).status, 200);
      const childId = (await db.query(`SELECT id FROM junior_profiles`)).rows[0].id;
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/care/contacts`, { method: "PUT", headers: json, body: JSON.stringify({ contacts: [{ name: "Nan Guardian", phone: "021 555 0101", relationship: "Grandmother" }] }) })).status, 200);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/care/medical-notes`, { method: "PUT", headers: json, body: JSON.stringify({ notes: NOTE }) })).status, 200);
      const date = (await (await fetch(`${api}/clubs/three-wolves/family/bookings`, auth(guardian))).json()).days.find((d) => d.spotsLeft > 0).date;
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/bookings`, { method: "POST", headers: json, body: JSON.stringify({ date }) })).status, 200);

      await page.goto(`${APP}/settings`);
      await page.getByRole("button", { name: "Club admin" }).click();
      await page.waitForURL(`${env.base}/admin`);
      // No safety check: the roster is closed even to an owner, and so is the note.
      await page.goto(`${env.base}/admin/juniors`);
      await page.locator("#roster").getByText("You need a current safety check").waitFor();
      assert.equal(await page.getByText("Tama Testchild").count(), 0);

      await check(PEOPLE.owner.email);
      await page.goto(`${env.base}/admin/juniors`);
      const row = page.locator("#roster tr, #roster [role=row]").filter({ hasText: "Tama Testchild" });
      await row.getByText("Tama Testchild (born 2016)").waitFor();
      await row.getByText(new RegExp(PEOPLE.member.email)).waitFor();
      await row.getByText("Nan Guardian (Grandmother): 021 555 0101").waitFor();
      assert.equal(await page.getByText("Asthma").count(), 0, "the roster doesn't show the note");

      await row.getByRole("button", { name: "Mark as here" }).click();
      await page.getByText("Marked as here.").first().waitFor();
      assert.deepEqual((await db.query(`SELECT source, removed FROM junior_attendance WHERE junior_profile_id = $1`, [childId])).rows, [{ source: "admin", removed: false }]);
      await page.locator("#roster").getByRole("button", { name: "Here ✓ (undo)" }).waitFor();

      // The medical note: one child at a time, and every view is logged without its words.
      await page.locator("#roster").getByRole("link", { name: /^Read/ }).click();
      await page.waitForURL(`${env.base}/admin/juniors/child/${childId}/medical`);
      assert.equal(await page.locator("[data-medical-note]").textContent(), NOTE);
      const logged = (await db.query(`SELECT action, target, meta::text AS meta FROM admin_audit_log WHERE action LIKE 'juniors.%' ORDER BY id`)).rows;
      assert.ok(logged.some((l) => l.action === "juniors.medical_note.read" && l.target === String(childId)), JSON.stringify(logged));
      assert.ok(logged.some((l) => l.action === "juniors.attendance"));
      assert.ok(!logged.some((l) => l.meta.includes("Asthma") || l.meta.includes("Tama")), "no note and no name in the log");

      // An admin with a check sees the roster and is told a note exists, but can't open it.
      await check(PEOPLE.admin.email);
      const adminPage = await admin.context.newPage();
      await adminPage.goto(`${APP}/settings`);
      await adminPage.getByRole("button", { name: "Club admin" }).click();
      await adminPage.waitForURL(`${env.base}/admin`);
      await adminPage.goto(`${env.base}/admin/juniors`);
      await adminPage.locator("#roster").getByText("Tama Testchild (born 2016)").waitFor();
      assert.equal(await adminPage.locator("#roster").getByRole("link", { name: /^Read/ }).count(), 0);
      // Asking for the note's address directly: the "not found" screen (the page streams, so the status alone doesn't say), no note, and a logged refusal.
      await adminPage.goto(`${env.base}/admin/juniors/child/${childId}/medical`);
      await adminPage.waitForLoadState("networkidle");
      assert.equal(await adminPage.locator("[data-medical-note]").count(), 0);
      assert.equal(await adminPage.getByText("Asthma").count(), 0);
      assert.equal(await adminPage.getByText("Medical note: Tama Testchild").count(), 0, "not even the child's name");
      const refused = (await db.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'juniors.medical_note.read.refused'`)).rows[0].n;
      assert.equal(refused, 1, "the refused attempt is logged too");
    } finally {
      await db.query(`DELETE FROM junior_attendance`);
      await db.query(`UPDATE tenants SET payment_mode = $1 WHERE id = 1`, [mode]);
      await juniorsOff();
      await owner.context.close();
      await admin.context.close();
    }
  });

  test("APP60 · an owner publishes a waiver in the admin; the guardian is asked to sign it in the app; the admin sees the signature; new wording asks again; retiring stops asking", async () => {
    await juniorsOn();
    const guardian = await sessionToken(PEOPLE.member.email);
    const json = { ...auth(guardian).headers, "content-type": "application/json" };
    const owner = await signedIn(PEOPLE.owner.email);
    const page = await owner.context.newPage();
    const mine = async () => (await (await fetch(`${api}/clubs/three-wolves/family/${childId}/forms`, auth(guardian))).json()).forms;
    let childId = 0;
    try {
      assert.equal((await fetch(`${api}/clubs/three-wolves/family`, { method: "POST", headers: json, body: JSON.stringify({ name: "Tama Testchild", birthYear: 2016, guardianConfirmed: true }) })).status, 200);
      childId = (await db.query(`SELECT id FROM junior_profiles`)).rows[0].id;
      assert.deepEqual(await mine(), []);

      await page.goto(`${APP}/settings`);
      await page.getByRole("button", { name: "Club admin" }).click();
      await page.waitForURL(`${env.base}/admin`);
      await page.goto(`${env.base}/admin/juniors`);
      await page.getByRole("link", { name: "Forms and waivers guardians sign" }).click();
      await page.waitForURL(`${env.base}/admin/juniors/forms`);
      await page.getByText("The club isn't asking guardians to sign anything yet.").waitFor();

      const form = page.locator("#publish form");
      const publish = async (slug, title, body) => {
        await form.getByLabel(/^Short name/).evaluate((el, v) => { el.removeAttribute("pattern"); el.value = v; }, slug);
        await form.getByLabel("Title").fill(title);
        await form.getByLabel("The form's words").fill(body);
        await form.getByRole("button", { name: "Publish" }).click();
      };
      // A short name with spaces is refused and nothing is written.
      await publish("Junior Waiver", "Junior waiver", "Words.");
      await page.getByText("The short name can only have").first().waitFor();
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM club_forms`)).rows[0].n, 0);

      await publish("junior-waiver", "Junior waiver", "I accept the risks of playing badminton for my child.");
      await page.getByText("Form published.").first().waitFor();
      const row = page.locator("#current tr, #current [role=row]").filter({ hasText: "junior-waiver" });
      await row.getByText("0 signatures").waitFor();

      // The guardian is asked, and signs.
      const asked = await mine();
      assert.deepEqual(asked.map((f) => [f.slug, f.version, f.signedAt]), [["junior-waiver", 1, null]]);
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/forms/${asked[0].id}/sign`, { method: "POST", headers: json, body: JSON.stringify({ name: "Mia Member" }) })).status, 200);
      await page.reload();
      await row.getByText("1 signature", { exact: true }).waitFor();

      // New wording: version 2, nobody has signed it yet, and the guardian is asked again.
      await publish("junior-waiver", "Junior waiver", "New wording.");
      await page.getByText("Version 2 published.").first().waitFor();
      await row.getByText("0 signatures").waitFor();
      assert.deepEqual((await mine()).map((f) => [f.version, f.signedAt]), [[2, null]]);
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM form_signatures`)).rows[0].n, 1, "the first signature is kept");

      // Retired: no longer asked for.
      page.once("dialog", (d) => d.accept());
      await row.getByRole("button", { name: "Retire" }).click();
      await page.getByText("Form retired.").first().waitFor();
      await page.getByText("The club isn't asking guardians to sign anything yet.").waitFor();
      assert.deepEqual(await mine(), []);
      // The log names the form, not its words.
      const logged = (await db.query(`SELECT action, target, meta::text AS meta FROM admin_audit_log WHERE action LIKE 'juniors.form.%' ORDER BY id`)).rows;
      assert.deepEqual(logged.filter((l) => !l.action.endsWith(".refused")).map((l) => [l.action, l.target]), [["juniors.form.publish", "junior-waiver"], ["juniors.form.publish", "junior-waiver"], ["juniors.form.retire", "junior-waiver"]]);
      assert.ok(!logged.some((l) => l.meta.includes("accept the risks")));
    } finally {
      await juniorsOff();
      await owner.context.close();
    }
  });

  test("APP61 · a coach in Admin → Juniors: no roster without a safety check; with one, the roster and a child's medical note, but never other people's safety-check status or the form to record one", async () => {
    await juniorsOn();
    const mode = (await db.query(`SELECT payment_mode FROM tenants WHERE id = 1`)).rows[0].payment_mode;
    await db.query(`UPDATE tenants SET payment_mode = 'free' WHERE id = 1`);
    const guardian = await sessionToken(PEOPLE.member.email);
    const json = { ...auth(guardian).headers, "content-type": "application/json" };
    const coach = await signedIn(PEOPLE.coach.email);
    const page = await coach.context.newPage();
    const coachId = (await db.query(`SELECT id FROM players WHERE lower(email) = lower($1)`, [PEOPLE.coach.email])).rows[0].id;
    try {
      assert.equal((await db.query(`SELECT role FROM club_roles WHERE player_id = $1`, [coachId])).rows[0]?.role, "coach");
      assert.equal((await fetch(`${api}/clubs/three-wolves/family`, { method: "POST", headers: json, body: JSON.stringify({ name: "Tama Testchild", birthYear: 2016, guardianConfirmed: true }) })).status, 200);
      const childId = (await db.query(`SELECT id FROM junior_profiles`)).rows[0].id;
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/care/medical-notes`, { method: "PUT", headers: json, body: JSON.stringify({ notes: "Asthma: blue inhaler." }) })).status, 200);
      const date = (await (await fetch(`${api}/clubs/three-wolves/family/bookings`, auth(guardian))).json()).days.find((d) => d.spotsLeft > 0).date;
      assert.equal((await fetch(`${api}/clubs/three-wolves/family/${childId}/bookings`, { method: "POST", headers: json, body: JSON.stringify({ date }) })).status, 200);

      await page.goto(`${APP}/settings`);
      await page.getByRole("button", { name: "Club admin" }).click();
      await page.waitForURL(/\/admin/);
      // No safety check: the page opens, the roster doesn't.
      await page.goto(`${env.base}/admin/juniors`);
      await page.locator("#roster").getByText("You need a current safety check").waitFor();
      assert.equal(await page.getByText("Tama Testchild").count(), 0);
      const noStaffTable = async () => {
        assert.equal(await page.locator("#safety-checks").count(), 0, "no safety-check table for a coach");
        assert.equal(await page.locator("#record").count(), 0, "no form to record a check");
        assert.equal(await page.getByText(PEOPLE.owner.first, { exact: false }).count(), 0, "no other staff member's name");
      };
      await noStaffTable();

      await db.query(`INSERT INTO junior_safety_checks (tenant_id, user_id, kind, checked_on, expires_on, recorded_by_user_id) VALUES (1, $1, 'police-vet', CURRENT_DATE - 30, CURRENT_DATE + 300, $1)`, [coachId]);
      await page.goto(`${env.base}/admin/juniors`);
      await page.locator("#roster").getByText("Tama Testchild (born 2016)").waitFor();
      await noStaffTable();
      // The note, for a coach with a valid check, logged.
      await page.locator("#roster").getByRole("link", { name: /^Read/ }).click();
      await page.waitForURL(`${env.base}/admin/juniors/child/${childId}/medical`);
      assert.equal(await page.locator("[data-medical-note]").textContent(), "Asthma: blue inhaler.");
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'juniors.medical_note.read' AND actor_player_id = $1`, [coachId])).rows[0].n, 1);
      // Marking who came is recorded as the coach's.
      await page.goto(`${env.base}/admin/juniors`);
      await page.locator("#roster").getByRole("button", { name: "Mark as here" }).click();
      await page.getByText("Marked as here.").first().waitFor();
      assert.deepEqual((await db.query(`SELECT source, recorded_by_user_id FROM junior_attendance WHERE junior_profile_id = $1`, [childId])).rows, [{ source: "coach", recorded_by_user_id: coachId }]);
      // Nothing else opened up: the members page is still not a coach's.
      await page.goto(`${env.base}/admin/members`);
      assert.ok(!new URL(page.url()).pathname.startsWith("/admin/members") || (await page.getByRole("heading", { name: "Members" }).count()) === 0, "a coach still can't open Members");
    } finally {
      await db.query(`DELETE FROM junior_attendance`);
      await db.query(`UPDATE tenants SET payment_mode = $1 WHERE id = 1`, [mode]);
      await juniorsOff();
      await coach.context.close();
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
      // A conversation (here one that isn't there, once it can be asked for).
      ["/inbox/999999", `${club}/messages/*`, "text=That conversation isn't here."],
      ["/settings", `${api}/account/profile`, "#details-title, [data-screen='nav_settings'] form"],
      // Cards on Me: the shop and My photos.
      ["/me", `${club}/shop`, ME_READY],
      ["/profile", `${club}/me/photos`, '[data-testid="my-photos"]'],
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
      await page.goto(`${APP}/profile`);
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
      await page.waitForSelector('[data-testid="my-photos"]');
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
      // The saved screens never hold the session token (audit H9), and say which build wrote them.
      const saved = await page.evaluate(() => localStorage.getItem("lp.cache"));
      assert.equal(saved.includes(token), false);
      assert.ok(JSON.parse(saved).build);

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
    for (const purpose of ["any", "maskable", "monochrome"]) assert.ok(manifest.icons.some((i) => i.purpose === purpose && i.sizes === "512x512"), purpose);
    assert.match(html, /<link rel="icon" href="\/favicon\.ico"/);
    assert.equal((await fetch(`${APP}/favicon.ico`)).status, 200);
    const sw = await (await fetch(`${APP}/sw.js`)).text();
    const assets = JSON.parse(sw.match(/const ASSETS = (\[.*?\]);/)[1]);
    assert.ok(assets.some((a) => /\/assets\/Home-.*\.js$/.test(a)) && assets.some((a) => /\/assets\/index-.*\.js$/.test(a)), "the screens are kept on the device");
    assert.equal(assets.some((a) => a.startsWith("/mediapipe/") || a.startsWith("/api/")), false);
    for (const icon of manifest.icons) assert.ok(assets.includes(icon.src), `${icon.src} is kept on the device`);

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
    // The stage's screens too: no entrances, no podium rising, no confetti drawn, nothing counting up.
    const { context: signedInCtx } = await signedIn(PEOPLE.member.email, { reducedMotion: "reduce" });
    const stage = await signedInCtx.newPage();
    for (const [route, ready] of [["/arena", '[data-screen="nav_arena"][data-state="ready"]'], ["/leaderboard", '[data-screen="nav_leaderboard"][data-state="ready"]'], ["/vision", '[data-screen="nav_vision"][data-state="ready"]']]) {
      await stage.goto(`${APP}${route}`);
      await stage.waitForSelector(ready);
      const still = await stage.evaluate(() => ({
        moving: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).animationName !== "none").map((el) => el.className).slice(0, 3),
        confetti: document.querySelectorAll(".confetti").length,
      }));
      assert.deepEqual(still, { moving: [], confetti: 0 }, route);
    }
    await signedInCtx.close();
  });
});

describe("APP · accessibility and the page's rules", () => {
  test("APP13 · axe: no violations on sign-in, an invite link, Me and Settings, light and dark", async () => {
    const problems = [];
    for (const colorScheme of ["light", "dark"]) {
      // axe is injected by the test, which the page's own CSP would (rightly) refuse.
      const { context } = await signedIn(PEOPLE.admin.email, { colorScheme, bypassCSP: true });
      const anon = await browser.newContext({ viewport: PHONE, serviceWorkers: "block", colorScheme, bypassCSP: true });
      for (const [ctx, route, ready] of [[anon, "/signin", "form"], [anon, "/c/three-wolves", "form"], [context, "/me", ME_READY], [context, "/inbox", ".inbox-list .button"], [context, "/inbox/new", "form textarea"], [context, "/settings", "text=Signed in as"], [context, "/welcome", "#welcome-title"], [context, "/vision", '[data-screen="nav_vision"][data-state="ready"]'], [context, "/vision/label", '[data-testid="label-file"]'], [context, "/membership", '[data-screen="membership"][data-state="ready"]'], [context, "/arena", '[data-screen="nav_arena"][data-state="ready"]'], [context, "/leaderboard", '[data-screen="nav_leaderboard"][data-state="ready"]']]) {
        const page = await ctx.newPage();
        await page.goto(`${APP}${route}`);
        await page.waitForSelector(ready);
        // The stage's entrances (cards rising in, the podium) settle before axe reads the colours.
        await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
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

  test("APP13b · axe with several clubs: Home, its filter narrowed, the inbox, a new message's club, a club's space with its picker open; light and dark", async () => {
    const problems = [];
    for (const colorScheme of ["light", "dark"]) {
      const { context } = await signedIn(PEOPLE.member.email, { colorScheme, bypassCSP: true });
      await withSecondClub(context);
      for (const [route, ready, act] of [
        ["/me", `${ME_READY}[data-home="clubs"]`, null],
        ["/me", `${ME_READY}[data-home="clubs"]`, (p) => p.getByRole("group", { name: "Show" }).getByRole("button", { name: "Harbour Smash" }).click()],
        ["/inbox", ".inbox-list .thread", null],
        ["/inbox/new", ".pick-club", null],
        ["/vision", '[data-screen="nav_vision"][data-state="ready"]', (p) => p.getByRole("button", { name: /Switch club/ }).click()],
      ]) {
        const page = await context.newPage();
        await page.goto(`${APP}${route}`);
        await page.waitForSelector(ready);
        if (act) await act(page);
        // Measure the settled page: a colour mid-transition (a chip turning to its pressed colour) isn't what anyone reads.
        await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
        await page.addScriptTag({ content: axeSource });
        const result = await page.evaluate(() => window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }));
        for (const v of result.violations) problems.push(`${route}${act ? "+" : ""} (${colorScheme}): ${v.id} [${v.impact}] ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
        await page.close();
      }
      await context.close();
    }
    assert.deepEqual(problems, []);
  });

  test("APP49 · Get the app: on a phone's browser every fifth open, in Luvallplay's look, the phone's own store; Not now closes it; never on a computer", async () => {
    const opensAt = (n) => (ctx) => ctx.addInitScript((v) => { if (!sessionStorage.getItem("e2e-opens")) { localStorage.setItem("lp.opens", v); sessionStorage.setItem("e2e-opens", "1"); } }, String(n));
    const sheet = (page) => page.getByRole("dialog", { name: "Luvallplay is better in the app" });

    // An iPhone, its fifth open: the App Store, in Luvallplay's green whatever the club's look.
    const iphone = await signedIn(PEOPLE.member.email, { ...devices["iPhone 13"], bypassCSP: true });
    await opensAt(4)(iphone.context);
    const page = await iphone.context.newPage();
    const problems = watch(page);
    await page.goto(`${APP}/home`);
    await page.waitForSelector(ME_READY);
    await sheet(page).waitFor();
    assert.equal((await look(page)).primary, NAVY, "the page stays the club's");
    assert.equal(await sheet(page).evaluate((d) => getComputedStyle(d).getPropertyValue("--primary").trim().toLowerCase()), COURT_GREEN);
    const get = sheet(page).getByRole("link", { name: "Get it on the App Store" });
    assert.equal(await get.getAttribute("href"), STORE.ios);
    await page.addScriptTag({ content: axeSource });
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
    const axe = await page.evaluate(() => window.axe.run(document.querySelector("dialog.get-app"), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }));
    assert.deepEqual(axe.violations.map((v) => v.id), []);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/app-get-the-app.png` });
    await sheet(page).getByRole("button", { name: "Not now" }).click();
    await sheet(page).waitFor({ state: "detached" });
    // The sixth open: nothing.
    await page.reload();
    await page.waitForSelector(ME_READY);
    await page.waitForTimeout(1800);
    assert.equal(await sheet(page).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("lp.opens")), "6");
    assert.deepEqual(problems, []);
    await iphone.context.close();

    // An Android phone: Google Play.
    const pixel = await signedIn(PEOPLE.member.email, { ...devices["Pixel 7"] });
    await opensAt(9)(pixel.context);
    const p2 = await pixel.context.newPage();
    await p2.goto(`${APP}/home`);
    await sheet(p2).getByRole("link", { name: "Get it on Google Play" }).waitFor();
    assert.equal(await sheet(p2).getByRole("link", { name: "Get it on Google Play" }).getAttribute("href"), STORE.android);
    await pixel.context.close();

    // A computer, its fifth open: never.
    const desk = await signedIn(PEOPLE.member.email, { viewport: { width: 1280, height: 900 } });
    await opensAt(4)(desk.context);
    const p3 = await desk.context.newPage();
    await p3.goto(`${APP}/home`);
    await p3.waitForSelector(ME_READY);
    await p3.waitForTimeout(1800);
    assert.equal(await sheet(p3).count(), 0);
    await desk.context.close();
  });

  test("APP50 · in no club yet: Home says so and points to the club finder, no club tabs, a club's space goes Home; My profile still opens; Skip to content first", async () => {
    const { context } = await signedIn(PEOPLE.member.email, { bypassCSP: true });
    await context.route(`${api}/clubs`, (route) => (route.request().method() === "OPTIONS" ? route.fallback() : route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ clubs: [] }) })));
    const page = await context.newPage();
    const problems = watch(page);
    await page.goto(`${APP}/home`);
    await page.waitForSelector('[data-screen="nav_home"][data-state="empty"]');
    await page.getByRole("heading", { name: "You're not in a club yet" }).waitFor();
    assert.equal(await page.getByRole("link", { name: /Find a club near you/ }).getAttribute("href"), "https://luvallplay.com/en/find-a-club");
    assert.equal(await page.locator(".shell-nav").count(), 0, "no club tabs");
    assert.equal(await page.locator(".skeleton").count(), 0, "no endless loading");
    await page.goto(`${APP}/player`);
    await page.waitForURL(`${APP}/home`);
    // The keyboard's first stop: Skip to content, which lands on the screen.
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
    await page.addScriptTag({ content: axeSource });
    const axe = await page.evaluate(() => window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }));
    assert.deepEqual(axe.violations.map((v) => v.id), []);
    await page.locator(".top-actions .head-avatar").click();
    await page.waitForSelector("text=Signed in as mia.member@e2e.test");
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("APP51 · a payment that didn't go through shows on Home, with the way to fix it; a healthy membership shows nothing there", async () => {
    const { context } = await signedIn(PEOPLE.member.email, { bypassCSP: true });
    const page = await context.newPage();
    await page.goto(`${APP}/home`);
    await page.waitForSelector(ME_READY);
    assert.equal(await page.locator(".alert").count(), 0, "an active membership that renews: nothing to do");
    await context.route(`${api}/clubs/three-wolves/me`, async (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback();
      const response = await route.fetch();
      const json = await response.json();
      return route.fulfill({ response, json: { ...json, membership: { ...json.membership, status: "past_due" } } });
    });
    await page.reload();
    await page.waitForSelector(ME_READY);
    const alert = page.getByRole("alert").filter({ hasText: "Your last payment didn't go through" });
    await alert.waitFor();
    assert.equal(await alert.getByRole("link", { name: "Fix payment" }).getAttribute("href"), "/membership");
    await page.addScriptTag({ content: axeSource });
    const axe = await page.evaluate(() => window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }));
    assert.deepEqual(axe.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), []);
    await context.close();
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
    assert.match(csp, new RegExp(`font-src 'self' https: ${env.base.replace(/[.:/]/g, "\\$&")} https://api\\.luvallplay\\.com(;|$)`));
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

  test("APP15 · screens are separate chunks: My profile's code arrives only when My profile is opened", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    const scripts = [];
    page.on("response", (r) => {
      if (r.url().endsWith(".js")) scripts.push(path.basename(new URL(r.url()).pathname));
    });
    await page.goto(`${APP}/me`);
    await page.waitForSelector(ME_READY);
    assert.ok(scripts.some((s) => s.startsWith("Home-")), `Home's chunk loaded (${scripts.join(", ")})`);
    assert.ok(!scripts.some((s) => s.startsWith("Profile-")), "My profile isn't loaded on Home");
    await page.getByRole("link", { name: "My profile" }).click();
    await page.waitForSelector("text=Signed in as");
    assert.ok(scripts.some((s) => s.startsWith("Profile-")));
    await context.close();
  });
});

// iPhone Duo (Apple's foldable): Apple's guidelines ask for one layout that
// resizes, the same controls in every pose, bars at the side on the short
// outer display, and nothing on the fold. Safari 27.1 offers the fold to web
// pages only behind feature flags (Device Posture and Viewport Segments), so
// the fold is emulated here in Chromium (DevTools' display features); the
// sizes are the displays' in points (outer about 466 × 678, inner 951 × 669
// opened like a book). A compact window keeps the bottom bar (a rail there
// squeezes the page); the inner display has the rail, as any window 600px+. A last check on a real device is still worth doing.
describe("APP · iPhone Duo", () => {
  const FOLD = 24;
  const POSES = [
    // The outer display and Split View are compact windows: the bottom bar, so the page keeps its width.
    { name: "outer display", viewport: { width: 466, height: 678 }, nav: "bar" },
    { name: "outer display, sideways", viewport: { width: 678, height: 466 }, nav: "rail" },
    { name: "inner display", viewport: { width: 951, height: 669 }, nav: "rail" },
    { name: "inner display, upright", viewport: { width: 669, height: 951 }, nav: "rail" },
    { name: "Split View, half the inner display", viewport: { width: 382, height: 669 }, screen: { width: 951, height: 669 }, nav: "bar" },
    { name: "folded like a book", viewport: { width: 951, height: 669 }, nav: "rail", fold: { orientation: "vertical", offset: 463, maskLength: FOLD } },
    { name: "set down like a laptop", viewport: { width: 669, height: 951 }, nav: "rail", fold: { orientation: "horizontal", offset: 463, maskLength: FOLD } },
  ];
  const ROUTES = [
    ["/arena", '[data-screen="nav_arena"][data-state="ready"]'],
    ["/leaderboard", '[data-screen="nav_leaderboard"][data-state="ready"]'],
    ["/vision", '[data-screen="nav_vision"][data-state="ready"]'],
    ["/vision/track?demo=1", '[data-screen="vision_track"] canvas'],
  ];

  /** Emulates the pose's fold (or none). Playwright's own screenshots would drop it, so this journey takes none. */
  async function pose(context, page, p) {
    if (!p.fold) return;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...p.viewport, deviceScaleFactor: 1, mobile: true, displayFeature: p.fold });
    await cdp.send("Emulation.setDisplayFeaturesOverride", { features: [p.fold] });
    await cdp.send("Emulation.setDevicePostureOverride", { posture: { type: "folded" } }).catch(() => {});
  }

  test("APP-DUO · each pose: no sideways scroll, the tabs where Apple puts bars, 44px targets, nothing on the fold, a dialog on one half, and axe", async () => {
    const problems = [];
    for (const p of POSES) {
      const { context } = await signedIn(PEOPLE.member.email, { viewport: p.viewport, screen: p.screen ?? p.viewport, bypassCSP: true });
      const page = await context.newPage();
      await pose(context, page, p);
      for (const [route, ready] of ROUTES) {
        await page.goto(`${APP}${route}`);
        await page.waitForSelector(ready);
        await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
        const where = `${route} (${p.name})`;
        const seen = await page.evaluate(() => ({
          book: matchMedia("(horizontal-viewport-segments: 2)").matches,
          laptop: matchMedia("(vertical-viewport-segments: 2)").matches,
          nav: document.querySelector(".shell")?.getAttribute("data-nav"),
          sideways: document.documentElement.scrollWidth - window.innerWidth,
        }));
        if (p.fold) assert.ok(p.fold.orientation === "vertical" ? seen.book : seen.laptop, `${where}: the emulated fold is seen`);
        if (seen.sideways > 1) problems.push(`${where}: scrolls sideways by ${seen.sideways}px`);
        if (!route.startsWith("/vision/track") && seen.nav !== p.nav) problems.push(`${where}: tabs as a ${seen.nav}, not a ${p.nav}`);
        const small = await page.evaluate(() =>
          [...document.querySelectorAll(".tab, .head-icon, .icon-button, .button, .choice, .field input, .slab")]
            .map((el) => ({ what: el.textContent?.trim().slice(0, 30), h: el.getBoundingClientRect().height }))
            .filter((x) => x.h > 0 && x.h < 44),
        );
        if (small.length) problems.push(`${where}: small targets ${JSON.stringify(small.slice(0, 3))}`);
        if (p.fold?.orientation === "vertical") {
          // Opened like a book: no control and no card sits across the fold.
          const across = await page.evaluate(({ from, to }) =>
            [...document.querySelectorAll(".shell-main a, .shell-main button, .shell-main input, .shell-main .card, .shell-main .board-row")]
              .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left < to && r.right > from; })
              .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${el.textContent?.trim().slice(0, 24)}"`)
              .slice(0, 5), { from: p.fold.offset, to: p.fold.offset + FOLD });
          if (across.length) problems.push(`${where}: across the fold: ${across.join(", ")}`);
        }
        if (p.fold?.orientation === "horizontal" && route.startsWith("/vision/track")) {
          // Set down like a laptop: the picture stays on the upper half.
          const pic = await page.locator('[data-screen="vision_track"] canvas').first().boundingBox();
          if (pic && pic.y + pic.height > p.fold.offset + 1) problems.push(`${where}: the picture reaches below the fold (${Math.round(pic.y + pic.height)}px)`);
        }
        if (!route.startsWith("/vision/track")) {
          await page.addScriptTag({ content: axeSource });
          const result = await page.evaluate(() => window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }));
          for (const v of result.violations) problems.push(`${where}: axe ${v.id} ${v.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(" | ")}`);
        }
      }
      if (p.fold?.orientation === "vertical") {
        // A player's card opens on one half, beside the list.
        await page.goto(`${APP}/leaderboard`);
        await page.waitForSelector('[data-screen="nav_leaderboard"][data-state="ready"]');
        const row = page.locator(".board-row .board-button").first();
        if (await row.count()) {
          await row.click();
          const card = await page.locator("dialog[open]").boundingBox();
          if (card && card.x < p.fold.offset + FOLD && card.x + card.width > p.fold.offset) problems.push(`player card (${p.name}): across the fold ${JSON.stringify(card)}`);
        }
      }
      await context.close();
    }
    assert.deepEqual(problems, []);
  });
});
