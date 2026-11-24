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
    await page.waitForSelector("text=Hi Mia");
    // The club's own word for Vision is on the tab; the frame's mark stays.
    assert.deepEqual(await tabLabels(page), ["Me", "Arena", "Wolf Vision", "Player", "Settings"]);
    assert.match(await page.locator(".shell-foot").textContent(), /on Luvallplay/);
    const fonts = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-display"));
    assert.match(fonts, /Copperplate/);
    // One club: no switcher. A plain member: no Club admin button.
    assert.equal(await page.getByRole("button", { name: "Switch club" }).count(), 0);

    // The session is the real one, and it survives a reload.
    const token = await page.evaluate(() => localStorage.getItem("lp.token"));
    assert.equal((await fetch(`${api}/auth/session`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    await page.reload();
    await page.waitForSelector("text=Hi Mia");
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
    await page.waitForSelector("text=Hi Pete");
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
    assert.deepEqual(await tabLabels(page), ["Me", "Smash Cam", "Player", "Settings"]);
    await page.goto(`${APP}/arena`);
    await page.waitForURL(`${APP}/me`);
    assert.equal((await look(page)).primary, "#7a1f3d", "the choice of club survives a reload");
    assert.equal(await page.locator(".club-logo").count(), 0, "nothing of the last club's logo lingers");

    await page.getByRole("button", { name: "Switch club" }).click();
    const started = Date.now();
    await page.getByRole("button", { name: "Three Wolves Badminton Club" }).click();
    await page.waitForFunction((navy) => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase() === navy, NAVY);
    assert.ok(Date.now() - started < 1500, "the look changes at once");
    assert.deepEqual(await tabLabels(page), ["Me", "Arena", "Wolf Vision", "Player", "Settings"]);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("APP5 · a module the club has off: its tab and its screen are gone; the others stay", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const base = await realConfig();
    await serveJson(context, `${api}/clubs/three-wolves/config`, async () => ({ ...base, modules: base.modules.filter((m) => m !== "vision") }));
    const page = await context.newPage();
    await page.goto(`${APP}/me`);
    await page.waitForSelector("text=Hi Mia");
    assert.deepEqual(await tabLabels(page), ["Me", "Arena", "Player", "Settings"]);
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
    await page.waitForSelector("text=Hi Cora");
    await db.query(`DELETE FROM player_sessions WHERE token_hash = $1`, [createHash("sha256").update(token).digest("hex")]);
    await page.reload();
    await page.waitForURL(`${APP}/signin`);
    assert.equal(await page.evaluate(() => localStorage.getItem("lp.token")), null);
    assert.equal((await look(page)).primary, COURT_GREEN);
    await context.close();
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
    assert.deepEqual(await tabLabels(page), ["Tôi", "Đấu trường", "Wolf Vision", "Người chơi", "Cài đặt"]);
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

  test("APP9 · Club admin: shown to an owner (waiting for the handoff endpoint), never to a member; sign out everywhere", async () => {
    const owner = await signedIn(PEOPLE.owner.email);
    const page = await owner.context.newPage();
    await page.goto(`${APP}/settings`);
    const button = page.getByRole("button", { name: "Club admin" });
    await button.waitFor();
    assert.equal(await button.isDisabled(), true);
    await page.waitForSelector("text=Opening the club's admin from the app is coming soon.");

    // A second device of the same person, then "sign out everywhere" from the first.
    const other = await sessionToken(PEOPLE.owner.email);
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await page.waitForURL(`${APP}/signin`);
    assert.equal((await fetch(`${api}/auth/session`, { headers: { Authorization: `Bearer ${owner.token}` } })).status, 401);
    assert.equal((await fetch(`${api}/auth/session`, { headers: { Authorization: `Bearer ${other}` } })).status, 401);
    await owner.context.close();
  });
});

describe("APP · layout (build plan §4.4)", () => {
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  test("APP10 · five widths: no sideways scroll, and the right navigation for each window class", async () => {
    const { context } = await signedIn(PEOPLE.member.email);
    const page = await context.newPage();
    for (const route of ["/me", "/settings"]) {
      await page.goto(`${APP}${route}`);
      await page.waitForSelector(".shell-nav .tab");
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
          [...document.querySelectorAll(".tab, .button, .choice, .field input")]
            .map((el) => ({ what: el.textContent?.trim().slice(0, 30), h: el.getBoundingClientRect().height }))
            .filter((x) => x.h > 0 && x.h < 44),
        );
        assert.deepEqual(small, [], `${route} at ${width}px has small touch targets`);
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
    for (const route of ["/me", "/settings"]) {
      await page.goto(`${APP}${route}`);
      await page.waitForSelector(".shell-nav .tab");
      const before = await page.locator("h1").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      const afterSize = await page.locator("h1").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(Math.abs(afterSize - before * 2) < 0.5, "type follows the text size setting");
      for (const width of [320, 375]) {
        await page.setViewportSize({ width, height: 812 });
        assert.ok((await overflow(page)) <= 1, `${route} at ${width}px and 200% scrolls sideways`);
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
      for (const [ctx, route, ready] of [[anon, "/signin", "form"], [anon, "/c/three-wolves", "form"], [context, "/me", ".shell-nav .tab"], [context, "/settings", "text=Signed in as"], [context, "/arena", '[data-screen="nav_arena"]']]) {
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
    await page.waitForSelector("text=Hi Mia");
    assert.ok(scripts.some((s) => s.startsWith("Me-")), `Me's chunk loaded (${scripts.join(", ")})`);
    assert.ok(!scripts.some((s) => s.startsWith("Settings-")), "Settings isn't loaded on Me");
    await page.getByRole("link", { name: "Settings" }).click();
    await page.waitForSelector("text=Signed in as");
    assert.ok(scripts.some((s) => s.startsWith("Settings-")));
    await context.close();
  });
});
