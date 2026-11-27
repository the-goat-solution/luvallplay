// Gate R, end to end, against a local production build (`pnpm build` first):
//
//   SITE_DATABASE_URL=postgres://… pnpm build && pnpm e2e
//
// Crawls every page in both languages (links, anchors, hreflang, meta, alt
// text, one h1), runs axe in light and dark, checks the motion rules, the
// cookie rule and the JavaScript budget, and takes the forms through double
// opt-in. Email is captured, never sent.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import path from "node:path";
import pg from "pg";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const ROOT = path.join(import.meta.dirname, "..", "..");
const PORT = Number(process.env.E2E_PORT ?? 3199);
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const DB_URL = process.env.SITE_DATABASE_URL;
const SHOTS = process.env.E2E_SHOTS;
const LANGS = ["en", "vi"];
const WIDTHS = [320, 375, 600, 840, 1200];

let server;
let browser;
let db;
const pages = new Map(); // url path -> { status, html }

before(async () => {
  if (!process.env.E2E_BASE_URL) {
    server = spawn("node", [require.resolve("next/dist/bin/next"), "start", "-p", String(PORT)], {
      cwd: ROOT,
      env: { ...process.env, E2E_OUTBOX: "1", TEAM_NOTIFY_EMAIL: "team@example.test", VERCEL_ENV: "" },
      stdio: "ignore",
    });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/en`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  browser = await chromium.launch();
  if (DB_URL) {
    db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    await db.query("TRUNCATE site_submissions, site_rate_limits, site_captured_emails");
  }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

after(async () => {
  await db?.end();
  await browser?.close();
  server?.kill();
});

async function get(p) {
  if (!pages.has(p)) {
    const res = await fetch(BASE + p, { redirect: "manual" });
    pages.set(p, { status: res.status, html: res.status === 200 ? await res.text() : "", location: res.headers.get("location") });
  }
  return pages.get(p);
}

const attr = (html, re) => [...html.matchAll(re)].map((m) => m[1]);

test("every page, link and anchor resolves in both languages", async () => {
  const queue = LANGS.map((l) => `/${l}`);
  const seen = new Set(queue);
  const problems = [];
  const anchors = [];
  while (queue.length) {
    const p = queue.shift();
    const page = await get(p);
    if (page.status !== 200) {
      problems.push(`${p} → ${page.status}`);
      continue;
    }
    for (const raw of attr(page.html, /<a\b[^>]*\shref="([^"]+)"/g)) {
      const hrefValue = raw.replace(/&amp;/g, "&");
      if (/^(https?:|mailto:)/.test(hrefValue)) continue;
      const [pathPart, hash] = hrefValue.split("#");
      const target = pathPart || p;
      if (hash) anchors.push([p, target, hash]);
      if (!/^\/(en|vi)(\/|$)/.test(target)) problems.push(`${p}: link "${hrefValue}" has no language`);
      else if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  for (const [from, target, hash] of anchors) {
    const page = await get(target);
    if (!new RegExp(`\\sid="${hash}"`).test(page.html)) problems.push(`${from}: anchor ${target}#${hash} does not exist`);
  }
  assert.deepEqual(problems, []);
  // Every page reached in one language exists in the other.
  for (const p of seen) {
    const twin = p.replace(/^\/(en|vi)/, (m, l) => (l === "en" ? "/vi" : "/en"));
    assert.ok(seen.has(twin), `${p} has no twin ${twin}`);
  }
  assert.ok(seen.size >= 2 * 27, `expected at least 54 pages, crawled ${seen.size}`);
});

test("meta: title, description, canonical, hreflang, Open Graph, lang, one h1, alt text", async () => {
  const problems = [];
  const titles = new Map();
  for (const [p, page] of pages) {
    if (page.status !== 200) continue;
    const lang = p.slice(1, 3);
    const h = page.html;
    const title = /<title>([^<]*)<\/title>/.exec(h)?.[1] ?? "";
    const desc = /<meta name="description" content="([^"]*)"/.exec(h)?.[1] ?? "";
    if (!new RegExp(`<html[^>]*\\slang="${lang}"`).test(h)) problems.push(`${p}: <html lang> is not ${lang}`);
    if (!title) problems.push(`${p}: no title`);
    if (p.includes("/thanks")) continue;
    if (!desc) problems.push(`${p}: no description`);
    if (titles.has(`${lang}:${title}`)) problems.push(`${p}: same title as ${titles.get(`${lang}:${title}`)}`);
    titles.set(`${lang}:${title}`, p);
    const rest = p.slice(3);
    if (!new RegExp(`<link rel="canonical" href="[^"]*/${lang}${rest}"`).test(h)) problems.push(`${p}: canonical`);
    for (const l of [...LANGS, "x-default"]) {
      const to = l === "x-default" ? "en" : l;
      if (!new RegExp(`<link rel="alternate" hrefLang="${l}" href="[^"]*/${to}${rest}"`, "i").test(h)) problems.push(`${p}: hreflang ${l}`);
    }
    if (!/<meta property="og:image" content="[^"]+opengraph-image/.test(h)) problems.push(`${p}: og:image`);
    if (!new RegExp(`<meta property="og:locale" content="${lang === "vi" ? "vi_VN" : "en_NZ"}"`).test(h)) problems.push(`${p}: og:locale`);
    if (!/<meta name="robots" content="noindex, nofollow"/.test(h)) problems.push(`${p}: must be noindex until go-live`);
    const h1 = (h.match(/<h1[\s>]/g) ?? []).length;
    if (h1 !== 1) problems.push(`${p}: ${h1} h1 elements`);
    for (const img of h.match(/<img\b[^>]*>/g) ?? []) if (!/\salt="/.test(img)) problems.push(`${p}: image without alt: ${img.slice(0, 80)}`);
  }
  assert.deepEqual(problems, []);
});

test("robots, sitemap, 404, language redirect, Open Graph images", async () => {
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/\s*$/m, "robots.txt disallows everything until go-live");
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  for (const l of LANGS) assert.match(sitemap, new RegExp(`/${l}/help/what-is-luvallplay</loc>`));
  for (const l of LANGS) assert.match(sitemap, new RegExp(`/${l}/safety/child-safety</loc>`));
  for (const l of LANGS) {
    const res = await fetch(`${BASE}/${l}/no-such-page`);
    assert.equal(res.status, 404);
    const og = await fetch(`${BASE}/${l}/opengraph-image`);
    assert.equal(og.status, 200);
    assert.equal(og.headers.get("content-type"), "image/png");
  }
  const cases = [
    [{ "accept-language": "vi-VN,vi;q=0.9" }, "/vi"],
    [{ "accept-language": "en-NZ" }, "/en"],
    [{ "accept-language": "en-NZ", cookie: "lang=vi" }, "/vi"],
  ];
  for (const [headers, to] of cases) {
    const res = await fetch(`${BASE}/`, { redirect: "manual", headers });
    assert.equal(res.status, 307);
    assert.equal(new URL(res.headers.get("location"), BASE).pathname, to, JSON.stringify(headers));
  }
  const deep = await fetch(`${BASE}/pricing`, { redirect: "manual", headers: { cookie: "lang=vi" } });
  assert.equal(new URL(deep.headers.get("location"), BASE).pathname, "/vi/pricing");
});

test("the language switch is remembered, and `lang` is the only cookie", async () => {
  const ctx = await browser.newContext({ locale: "en-NZ" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  assert.equal(new URL(page.url()).pathname, "/en");
  await page.locator(".nav-desktop .nav-lang").click();
  await page.waitForURL("**/vi");
  await page.goto(`${BASE}/`);
  assert.equal(new URL(page.url()).pathname, "/vi", "the choice is remembered");
  for (const p of ["/vi/help", "/vi/waitlist", "/vi/find-a-club"]) await page.goto(BASE + p);
  const cookies = await ctx.cookies();
  assert.deepEqual(cookies.map((c) => c.name), ["lang"]);
  await ctx.close();
});

test("axe: no violations, both languages, light and dark, phone and desktop", { timeout: 240000 }, async () => {
  const paths = ["", "/vision", "/for-clubs", "/find-a-club", "/pricing", "/about", "/help", "/help/what-is-luvallplay", "/contact", "/waitlist", "/privacy", "/safety/child-safety", "/no-such-page"];
  const problems = [];
  for (const scheme of ["light", "dark"]) {
    for (const lang of LANGS) {
      const ctx = await browser.newContext({ colorScheme: scheme, reducedMotion: "reduce", viewport: scheme === "light" ? { width: 1280, height: 900 } : { width: 375, height: 812 } });
      const page = await ctx.newPage();
      for (const p of paths) {
        await page.goto(`${BASE}/${lang}${p}`);
        await page.addScriptTag({ content: axeSource });
        const result = await page.evaluate(() => window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }));
        for (const v of result.violations) problems.push(`${scheme} /${lang}${p}: ${v.id} (${v.impact}) ${v.nodes.length}× e.g. ${v.nodes[0].target.join(" ")}`);
      }
      await ctx.close();
    }
  }
  assert.deepEqual(problems, []);
});

test("layout: no sideways scroll at any width, in either language (and screenshots)", { timeout: 240000 }, async () => {
  const problems = [];
  for (const lang of LANGS) {
    for (const width of WIDTHS) {
      for (const scheme of SHOTS ? ["light", "dark"] : ["light"]) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", colorScheme: scheme });
        const page = await ctx.newPage();
        for (const p of ["", "/for-clubs", "/help", "/waitlist", "/privacy"]) {
          await page.goto(`${BASE}/${lang}${p}`);
          const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (over > 1) problems.push(`/${lang}${p} at ${width}px overflows by ${over}px`);
          if (SHOTS && (p === "" || p === "/waitlist")) await page.screenshot({ path: `${SHOTS}/${p ? p.slice(1) : "home"}-${lang}-${width}-${scheme}.png`, fullPage: true });
        }
        await ctx.close();
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("motion: still under reduced motion, nothing loops, complete without scroll animation", async () => {
  // Reduced motion: no running animations, and the score shows its final value.
  const reduced = await browser.newContext({ reducedMotion: "reduce" });
  let page = await reduced.newPage();
  await page.goto(`${BASE}/en`);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length), 0);
  assert.match(await page.locator(".score-num").innerText(), /21\s*–\s*19/);
  await reduced.close();

  const ctx = await browser.newContext();
  page = await ctx.newPage();
  await page.goto(`${BASE}/en`);
  await page.waitForTimeout(800);
  // Every animation has a finite number of iterations.
  const infinite = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity).map((a) => a.animationName ?? "?"));
  assert.deepEqual(infinite, []);
  // The demo game starts by itself, and the ticker pauses on hover.
  await page.waitForFunction(() => !/21\s*–\s*19/.test(document.querySelector(".score-num")?.textContent ?? ""), null, { timeout: 5000 });
  await page.hover(".marquee");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".track")).animationPlayState), "paused");
  // Everything is visible even where a scroll-driven animation would start hidden.
  const hidden = await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    return [...document.querySelectorAll(".rise")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < innerHeight * 0.4 && r.bottom > 0 && Number(getComputedStyle(el).opacity) < 0.99;
    }).length;
  });
  assert.equal(hidden, 0);
  await ctx.close();

  // Without JavaScript the page is complete: final score, all clubs, working forms.
  const nojs = await browser.newContext({ javaScriptEnabled: false });
  page = await nojs.newPage();
  await page.goto(`${BASE}/vi`);
  assert.match(await page.locator(".score-num").innerText(), /21\s*–\s*19/);
  assert.ok((await page.locator(".club").count()) >= 1);
  await nojs.close();
});

test("club finder: sport chips, accent-aware search, the empty state, keyboard", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/vi/find-a-club`);
  assert.equal(await page.locator(".club").count(), 1);
  assert.match(await page.locator(".club a").getAttribute("href"), /^https:\/\/threewolvesbadminton\.org/);
  await page.getByRole("button", { name: /Pickleball/ }).click();
  await page.getByText("Chưa có câu lạc bộ nào cho môn này").waitFor();
  assert.equal(await page.locator(".empty a").getAttribute("href"), "/vi/invite-a-club");
  // Keyboard: the chips are buttons, reachable and operable.
  await page.getByRole("button", { name: /Cầu lông/ }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".club").count(), 1);
  await page.getByRole("searchbox").fill("CHRISTCHÚRCH");
  assert.equal(await page.locator(".club").count(), 1, "search ignores accents and case");
  await page.getByRole("searchbox").fill("Hà Nội");
  await page.getByText("Chưa có câu lạc bộ nào ở đó").waitFor();
  await ctx.close();
});

test("home page budgets: JavaScript and total weight", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const sizes = { js: 0, total: 0 };
  page.on("response", async (res) => {
    try {
      const body = await res.body();
      const wire = gzipSync(body).length;
      const type = res.headers()["content-type"] ?? "";
      sizes.total += /font|image\/(png|jpe?g|webp|avif)/.test(type) ? body.length : wire;
      if (type.includes("javascript")) sizes.js += wire;
    } catch {}
  });
  await page.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  await ctx.close();
  console.log(`home page: JavaScript ${(sizes.js / 1024).toFixed(1)} KB gzipped, whole page ${(sizes.total / 1024).toFixed(1)} KB`);
  assert.ok(sizes.total < 1024 * 1024, "page under 1 MB");
  // Budget for our own code on top of the framework runtime: see the Phase 6 delivery log.
  assert.ok(sizes.js < Number(process.env.E2E_JS_BUDGET_KB ?? 190) * 1024, `JavaScript ${(sizes.js / 1024).toFixed(1)} KB`);
});

test("forms: honeypot, consent, double opt-in, duplicates, removal, rate limit", { skip: !DB_URL && "SITE_DATABASE_URL not set", timeout: 120000 }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const rows = async (email) => (await db.query("SELECT * FROM site_submissions WHERE email = $1 ORDER BY kind", [email])).rows;
  const outbox = async (to) => (await (await fetch(`${BASE}/api/dev/outbox`)).json()).filter((m) => m.to_email === to);

  // Waitlist in Vietnamese, by keyboard and pointer.
  await page.goto(`${BASE}/vi/waitlist`);
  assert.equal(await page.locator('input[name="consent"]').isChecked(), false, "consent is never pre-ticked");
  await page.getByLabel("Người tổ chức câu lạc bộ").check();
  await page.getByLabel("Tên của bạn").fill("Nguyễn Thị Thử");
  await page.getByLabel("Email", { exact: true }).fill("Thu@Example.test");
  await page.getByLabel(/Tên câu lạc bộ/).fill("CLB Thử Nghiệm");
  await page.getByLabel("Môn").selectOption("badminton");
  await page.getByLabel("Thành phố hoặc thị trấn").fill("Đà Nẵng");
  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: "Vào danh sách chờ" }).click();
  await page.waitForURL("**/vi/thanks?status=pending-preview");
  await page.getByRole("heading", { name: "Hãy kiểm tra email" }).waitFor();

  let [row] = await rows("thu@example.test");
  assert.equal(row.status, "pending");
  assert.equal(row.locale, "vi");
  assert.equal(row.city, "Đà Nẵng");
  assert.match(row.consent_text, /xoá thông tin/);
  assert.ok(row.consent_at);
  let mail = await outbox("thu@example.test");
  assert.equal(mail.length, 1, "one confirmation email, captured (not sent)");
  assert.match(mail[0].subject, /Xác nhận email/);
  assert.equal((await outbox("team@example.test")).length, 0, "the team hears nothing until the address is confirmed");

  // Sending again: still one row, a fresh link, and the old link stops working.
  const oldLink = /https?:\/\/\S+\/api\/forms\/confirm\?t=\S+/.exec(mail[0].body)[0];
  const again = new URLSearchParams({ kind: "waitlist", locale: "vi", email: "thu@example.test", name: "Nguyễn Thị Thử", role: "organiser", consent: "yes" });
  const res = await fetch(`${BASE}/api/forms/submit`, { method: "POST", body: again, redirect: "manual" });
  assert.equal(res.status, 303);
  assert.equal((await rows("thu@example.test")).length, 1, "duplicates update the same row");
  mail = await outbox("thu@example.test");
  const link = /https?:\/\/\S+\/api\/forms\/confirm\?t=\S+/.exec(mail[0].body)[0];
  assert.notEqual(link, oldLink);

  // Opening the link changes nothing by itself (mail scanners); the button confirms.
  const local = (u) => BASE + new URL(u).pathname + new URL(u).search;
  await page.goto(local(oldLink));
  await page.locator("main form button").click();
  await page.waitForURL("**/thanks?status=invalid");
  await page.goto(local(link));
  [row] = await rows("thu@example.test");
  assert.equal(row.status, "pending");
  await page.locator("main form button").click();
  await page.waitForURL("**/vi/thanks?status=confirmed");
  [row] = await rows("thu@example.test");
  assert.equal(row.status, "confirmed");
  assert.ok(row.confirmed_at);
  const team = await outbox("team@example.test");
  assert.equal(team.length, 1);
  assert.match(team[0].body, /CLB Thử Nghiệm/);

  // The honeypot: looks like success, stores nothing.
  const bot = new URLSearchParams({ kind: "contact", locale: "en", email: "bot@example.test", name: "Bot", message: "buy", consent: "yes", website: "http://spam.example" });
  const botRes = await fetch(`${BASE}/api/forms/submit`, { method: "POST", body: bot, redirect: "manual" });
  assert.match(botRes.headers.get("location"), /status=pending/);
  assert.equal((await rows("bot@example.test")).length, 0);

  // No consent, or a bad email: refused, nothing stored.
  for (const bad of [{ consent: "" }, { email: "not-an-email" }]) {
    const body = new URLSearchParams({ kind: "app", locale: "en", email: "x@example.test", consent: "yes", ...bad });
    const r = await fetch(`${BASE}/api/forms/submit`, { method: "POST", body, redirect: "manual" });
    assert.match(r.headers.get("location"), /status=error/);
  }
  assert.equal((await rows("x@example.test")).length, 0);

  // The other four forms, in English.
  const others = [
    ["/en/contact", "contact", async () => { await page.getByLabel("Your name").fill("Sam Tester"); await page.getByLabel("Message").fill("Hello there"); }],
    ["/en/walkthrough", "walkthrough", async () => { await page.getByLabel("Your name").fill("Sam Tester"); await page.getByLabel("Club name").fill("Test Club"); }],
    ["/en/invite-a-club", "invite", async () => { await page.getByLabel("Club name").fill("Another Club"); await page.getByLabel(/You may tell the club/).check(); }],
    ["/en/get-the-app", "app", async () => {}],
  ];
  for (const [p, kind, fill] of others) {
    await page.goto(BASE + p);
    await fill();
    await page.getByLabel("Email", { exact: true }).fill("sam@example.test");
    await page.locator('input[name="consent"]').check();
    await page.locator("form.form button[type=submit]").click();
    await page.waitForURL("**/en/thanks?status=pending-preview");
    assert.ok((await rows("sam@example.test")).some((r) => r.kind === kind), `${kind} stored`);
  }
  assert.equal((await rows("sam@example.test")).find((r) => r.kind === "invite").extra.mentionMe, true);

  // "Remove my details" deletes the row.
  const removeLink = /https?:\/\/\S+\/api\/forms\/remove\?t=\S+/.exec((await outbox("sam@example.test"))[0].body)[0];
  const before = (await rows("sam@example.test")).length;
  await page.goto(local(removeLink));
  await page.locator("main form button").click();
  await page.waitForURL("**/en/thanks?status=removed");
  assert.equal((await rows("sam@example.test")).length, before - 1);

  // Rate limit: the ninth try in an hour is turned away.
  await db.query("TRUNCATE site_rate_limits");
  let last = "";
  for (let i = 0; i < 9; i++) {
    const body = new URLSearchParams({ kind: "app", locale: "en", email: `r${i}@example.test`, consent: "yes" });
    const r = await fetch(`${BASE}/api/forms/submit`, { method: "POST", body, redirect: "manual", headers: { "x-forwarded-for": "198.51.100.7" } });
    last = r.headers.get("location");
  }
  assert.match(last, /status=rate/);
  const buckets = (await db.query("SELECT DISTINCT bucket FROM site_rate_limits")).rows;
  assert.ok(buckets.every((b) => /^[0-9a-f]{64}$/.test(b.bucket)), "only hashes are stored");
  await ctx.close();
});
