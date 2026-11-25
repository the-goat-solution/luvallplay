// End-to-end journeys (test plan §3.8) against a local production build:
// A1–A6 (sign-in, sessions, admin), M1–M5 (membership), G1–G2 (Arena),
// plus redirects for every moved URL and screenshots at the five widths.
//
//   npm run build && node --test tests/e2e/journeys.mjs
//
// Synthetic people and data only (scripts/e2e/env.mjs). Email is captured
// (lib/side-effects.ts), never sent. Screenshots go to E2E_SHOTS (default
// docs/screenshots/phase-1).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { createRequire } from "node:module";
import { ensureAppLogin, startEnv, startSecondServer, PEOPLE } from "../../scripts/e2e/env.mjs";

// Playwright is preinstalled globally (resolved through NODE_PATH, which only require() uses).
const { chromium } = createRequire(import.meta.url)("playwright");

const SHOTS = process.env.E2E_SHOTS ?? "../../docs/screenshots/phase-1";
const WIDTHS = [320, 375, 600, 840, 1200];
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1200, height: 900 };

let env;
let browser;
let db;
const base = () => env.base;

before(async () => {
  env = await startEnv({ log: () => {} });
  browser = await chromium.launch();
  db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();
  mkdirSync(SHOTS, { recursive: true });
});

after(async () => {
  await db?.end();
  await browser?.close();
  env?.stop();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function outboxCode(email) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${base()}/api/dev/outbox?to=${encodeURIComponent(email.trim().toLowerCase())}`);
    const { mail } = await r.json();
    const last = mail[mail.length - 1];
    const m = last && `${last.subject} ${last.text} ${last.html}`.match(/\b(\d{6})\b/);
    if (m) return m[1];
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`no code emailed to ${email}`);
}

async function clearOutbox() {
  await fetch(`${base()}/api/dev/outbox`, { method: "DELETE" });
}

/**
 * A signed-in browser context for `email`. Journeys about signing in (A1,
 * A5's step-up) use the real code flow; the rest get a session the way the
 * app stores one (random token, only its SHA-256 in player_sessions), so the
 * real sign-in rate limits (3 codes per email, 10 per IP per 15 minutes)
 * stay switched on.
 */
async function signedIn(email, viewport = PHONE) {
  const normalized = email.trim().toLowerCase();
  let { rows } = await db.query(`SELECT id FROM players WHERE email = $1 AND deleted_at IS NULL`, [normalized]);
  if (!rows[0]) ({ rows } = await db.query(`INSERT INTO players (email, claimed_at) VALUES ($1, NOW()) RETURNING id`, [normalized]));
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO player_sessions (player_id, token_hash, user_agent, expires_at) VALUES ($1, $2, 'e2e', NOW() + INTERVAL '90 days')`,
    [rows[0].id, createHash("sha256").update(token).digest("hex")],
  );
  const context = await browser.newContext({ viewport, baseURL: base() });
  await context.addCookies([{ name: "tw_player", value: token, url: base() }]);
  context.on("page", watchRequests);
  return { context, token };
}

async function api(token, body) {
  const r = await fetch(`${base()}/api/arena`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `tw_player=${token}` },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

/** Requests a page hasn't had an answer to yet, so a page that never settles can say what it is waiting for. */
const inFlight = new WeakMap();
function watchRequests(page) {
  if (inFlight.has(page)) return;
  const pending = new Set();
  inFlight.set(page, pending);
  page.on("request", (r) => pending.add(r));
  for (const done of ["requestfinished", "requestfailed"]) page.on(done, (r) => pending.delete(r));
}

async function shot(page, name) {
  // Fully loaded (no loading skeleton) and no sheet still animating in.
  watchRequests(page);
  await page.waitForLoadState("networkidle").catch((err) => {
    const waiting = [...inFlight.get(page)].map((r) => `${r.method()} ${r.url()}`);
    throw new Error(`${name}: the page never went quiet (${err.message.split("\n")[0]}). Still waiting for: ${waiting.join(", ") || "nothing started since this screenshot was asked for"}`);
  });
  await page.waitForTimeout(400);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w < 600 ? 812 : 900 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${name} at ${w}px has no sideways scroll (overflow ${overflow}px)`);
  }
}

// ---------------------------------------------------------------------------
// A: sign-in, sessions, admin
// ---------------------------------------------------------------------------

describe("A · accounts and admin", () => {
  test("A1 · email code sign-in: existing account, mixed-case email, lands on Me", async () => {
    await clearOutbox();
    const context = await browser.newContext({ viewport: PHONE, baseURL: base() });
    const page = await context.newPage();
    await page.goto("/profile");
    assert.match(page.url(), /\/login\?next=%2Fprofile/);
    await page.getByLabel(/email/i).first().fill("  MIA.Member@E2E.test ");
    await page.getByRole("button", { name: /email me a code|send/i }).first().click();
    const code = await outboxCode(PEOPLE.member.email);
    await page.locator('input[autocomplete="one-time-code"]').first().fill(code);
    await page.waitForURL(/\/profile$/);
    await page.getByRole("heading", { name: "Mia Member" }).waitFor();
    assert.ok(await page.getByText(/Active · renews/).isVisible(), "membership pill");
    await context.close();
  });

  test("A1 · a brand-new email gets an account and is asked for their name", async () => {
    await clearOutbox();
    const email = `new.${Date.now()}@e2e.test`;
    const context = await browser.newContext({ viewport: PHONE, baseURL: base() });
    const page = await context.newPage();
    await page.goto("/login?next=/profile");
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByRole("button", { name: /email me a code|send/i }).first().click();
    await page.locator('input[autocomplete="one-time-code"]').first().fill(await outboxCode(email));
    await page.waitForURL(/\/login\/details/);
    await context.close();
  });

  test("A2 · SMS is off outside production: email sign-in only, no text button", async () => {
    const context = await browser.newContext({ viewport: PHONE, baseURL: base() });
    const page = await context.newPage();
    await page.goto("/login");
    assert.equal(await page.getByRole("button", { name: /text me/i }).count(), 0);
    await context.close();
  });

  test("A3 · stays signed in across a restart and after 89 days (session slides)", async () => {
    const { context, token } = await signedIn(PEOPLE.player.email);
    // "Browser restart": a new context with the same cookie.
    const state = await context.storageState();
    await context.close();
    const again = await browser.newContext({ viewport: PHONE, baseURL: base(), storageState: state });
    const page = await again.newPage();
    await page.goto("/profile");
    await page.getByRole("heading", { name: "Pete Player" }).waitFor();
    // 89 days later (clock moved by editing the session): still in, and the expiry slides.
    await db.query(
      `UPDATE player_sessions SET created_at = NOW() - INTERVAL '89 days', last_seen_at = NOW() - INTERVAL '89 days', expires_at = NOW() + INTERVAL '1 day'
       WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
      [token],
    );
    await page.goto("/profile");
    await page.getByRole("heading", { name: "Pete Player" }).waitFor();
    const { rows } = await db.query(`SELECT expires_at > NOW() + INTERVAL '80 days' AS slid FROM player_sessions WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [token]);
    assert.equal(rows[0].slid, true);
    await again.close();
  });

  test("A4 · sign out this device, and sign out everywhere", async () => {
    const one = await signedIn(PEOPLE.hidden.email);
    const two = await signedIn(PEOPLE.hidden.email);
    const page = await one.context.newPage();
    await page.goto("/profile/settings");
    await page.getByRole("button", { name: /^sign out$/i }).first().click();
    await page.waitForURL(/\/login/);
    const p2 = await two.context.newPage();
    await p2.goto("/profile/settings");
    await p2.getByRole("heading", { name: /settings/i }).waitFor();
    await p2.getByRole("button", { name: /sign out everywhere|all devices/i }).first().click();
    await p2.waitForURL(/\/login/);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM player_sessions s JOIN players p ON p.id = s.player_id WHERE p.email = $1`, [PEOPLE.hidden.email]);
    assert.equal(rows[0].n, 0);
    await one.context.close();
    await two.context.close();
  });

  test("A5 · owner opens admin from the profile; non-admin can't; step-up after 12 hours", async () => {
    const owner = await signedIn(PEOPLE.owner.email, DESKTOP);
    const page = await owner.context.newPage();
    await page.goto("/profile");
    await page.getByRole("link", { name: /club admin/i }).first().click();
    // Admin opens on Today (the admin home).
    await page.waitForURL(/\/admin$/);
    await page.getByRole("heading", { name: "Today", level: 1 }).waitFor();
    await page.getByRole("link", { name: "Admins" }).waitFor();
    // Non-admin: no button, and admin answers 403.
    const pete = await signedIn(PEOPLE.player.email);
    const pp = await pete.context.newPage();
    await pp.goto("/profile");
    assert.equal(await pp.getByRole("link", { name: /club admin/i }).count(), 0);
    const res = await pp.goto("/admin/members");
    assert.equal(res.status(), 403);
    // Coach: play days yes, members no.
    const coach = await signedIn(PEOPLE.coach.email);
    const cp = await coach.context.newPage();
    assert.equal((await cp.goto("/admin/play-days")).status(), 200);
    assert.equal((await cp.goto("/admin/members")).status(), 403);
    // Step-up: a sign-in 13 hours old is asked for a fresh code.
    await db.query(`UPDATE player_sessions SET created_at = NOW() - INTERVAL '13 hours' WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [owner.token]);
    await clearOutbox();
    await page.goto("/admin/members");
    await page.waitForURL(/\/login\?.*stepup=1/);
    assert.ok(await page.getByText(/fresh sign-in/i).isVisible());
    assert.equal(await page.getByLabel(/email/i).first().inputValue(), PEOPLE.owner.email);
    await page.getByRole("button", { name: /email me a code|send/i }).first().click();
    await page.locator('input[autocomplete="one-time-code"]').first().fill(await outboxCode(PEOPLE.owner.email));
    await page.waitForURL(/\/admin\/members/);
    // The audit log recorded admin activity.
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM admin_audit_log`);
    assert.ok(rows[0].n > 0);
    await owner.context.close();
    await pete.context.close();
    await coach.context.close();
  });

  test("A6 · owner adds and removes an admin; invites; last-owner protection; emails", async () => {
    const owner = await signedIn(PEOPLE.owner.email, DESKTOP);
    const page = await owner.context.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto("/admin/people/admins");
    await clearOutbox();
    // Add Pete (existing account) as admin.
    await page.getByLabel("Email").fill(PEOPLE.player.email);
    await page.locator("#add select[name=role]").selectOption("admin");
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByText(/Pete Player is now admin/).waitFor();
    const mailToPete = await (await fetch(`${base()}/api/dev/outbox?to=${PEOPLE.player.email}`)).json();
    assert.ok(mailToPete.mail.some((m) => /admin at Three Wolves/.test(m.subject)), "the new admin is emailed");
    // Pete can now reach members.
    const pete = await signedIn(PEOPLE.player.email);
    const pp = await pete.context.newPage();
    assert.equal((await pp.goto("/admin/members")).status(), 200);
    // Invite someone without an account.
    await page.getByLabel("Email").fill("future.coach@e2e.test");
    await page.locator("#add select[name=role]").selectOption("coach");
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByText(/Invite sent/).waitFor();
    // Their first sign-in applies the role.
    const fc = await signedIn("future.coach@e2e.test");
    const fp = await fc.context.newPage();
    assert.equal((await fp.goto("/admin/play-days")).status(), 200);
    // Last owner: Olivia is the only owner, so she can't be removed or demoted.
    const ownerRow = page.locator("tr", { hasText: PEOPLE.owner.email });
    await ownerRow.getByText("Last owner").waitFor();
    assert.equal(await ownerRow.getByRole("button", { name: "Remove" }).count(), 0);
    // Remove Pete.
    const peteRow = page.locator("tr", { hasText: PEOPLE.player.email });
    await peteRow.getByRole("button", { name: "Remove" }).click();
    await page.getByText(/no longer has admin access/).waitFor();
    assert.equal((await pp.goto("/admin/members")).status(), 403);
    // Audit trail.
    const { rows } = await db.query(`SELECT action FROM admin_audit_log ORDER BY id`);
    const actions = rows.map((r) => r.action);
    for (const a of ["admin.granted", "admin.invited", "admin.invite_accepted", "admin.removed"]) assert.ok(actions.includes(a), a);
    await shot(page, "admin-admins");
    await owner.context.close();
    await pete.context.close();
    await fc.context.close();
  });

  test("A7 · Admin → Settings: the business config from the database; a price change reaches the home page; coaches can't open it", async () => {
    const owner = await signedIn(PEOPLE.owner.email, DESKTOP);
    const page = await owner.context.newPage();
    assert.equal((await page.goto("/admin/settings")).status(), 200);
    // The five plans came from the migration (copied from Sanity).
    for (const plan of ["Casual", "Monthly (Friday)", "Quarterly (Friday)", "Monthly (Wednesday)", "Quarterly (Wednesday)"]) {
      await page.getByRole("heading", { name: plan, exact: true }).waitFor();
    }
    const casual = page.locator("form", { has: page.locator("input[name=planId][value=casual]") });
    assert.equal(await casual.locator("input[name=price]").inputValue(), "10");
    assert.match(await casual.locator("input[name=stripePriceId]").inputValue(), /^price_/);
    await page.screenshot({ path: `${SHOTS}/admin-settings-1200.png`, fullPage: true });
    // Change the casual price; the home page shows it.
    await casual.locator("input[name=price]").fill("11");
    await casual.getByRole("button", { name: /Save Casual/ }).click();
    await page.getByText("Casual saved.").waitFor();
    const { rows } = await db.query(`SELECT price_nzd::text AS p, updated_by FROM pricing_plans WHERE plan_id = 'casual'`);
    assert.equal(rows[0].p, "11.00");
    assert.ok(rows[0].updated_by, "who changed it is recorded");
    const home = await (await fetch(`${base()}/`)).text();
    assert.match(home, /\$11\b/, "the new casual price is on the home page");
    // A bad Stripe price id is refused.
    await casual.locator("input[name=stripePriceId]").fill("not-a-price");
    await casual.getByRole("button", { name: /Save Casual/ }).click();
    await page.getByText(/Stripe price ids look like price_/).waitFor();
    // Put it back.
    await casual.locator("input[name=price]").fill("10");
    await casual.locator("input[name=stripePriceId]").fill(rows.length ? (await db.query(`SELECT stripe_price_id FROM pricing_plans WHERE plan_id = 'casual'`)).rows[0].stripe_price_id : "");
    await casual.getByRole("button", { name: /Save Casual/ }).click();
    await page.getByText("Casual saved.").waitFor();
    // A coach can't open it.
    const coach = await signedIn(PEOPLE.coach.email);
    const cp = await coach.context.newPage();
    const r = await cp.goto("/admin/settings");
    assert.ok(r.status() === 403 || !cp.url().includes("/admin/settings"), "coaches are kept out of Settings");
  });

  test("A6 · the last owner can't delete their account", async () => {
    const owner = await signedIn(PEOPLE.owner.email);
    const r = await fetch(`${base()}/api/profile/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `tw_player=${owner.token}` },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "last_owner");
    await owner.context.close();
  });

  test("A · no break-glass: /admin/login (with or without ?breakglass=1) goes to sign-in, and the password login is gone", async () => {
    const context = await browser.newContext({ viewport: DESKTOP, baseURL: base() });
    const page = await context.newPage();
    await page.goto("/admin/login");
    assert.match(page.url(), /\/login\?next=%2Fadmin/);
    await page.goto("/admin/login?breakglass=1");
    assert.match(page.url(), /\/login\?next=%2Fadmin/);
    const r = await fetch(`${base()}/api/admin-login`, { method: "POST", body: new URLSearchParams({ password: "e2e-break-glass" }), redirect: "manual" });
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("set-cookie"), null);
    await context.close();
  });

  test("A · handoff link: single use, opens admin signed in", async () => {
    const owner = await signedIn(PEOPLE.owner.email);
    const r = await fetch(`${base()}/api/admin/handoff`, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` } });
    assert.equal(r.status, 200);
    const { url } = await r.json();
    const fresh = await browser.newContext({ viewport: PHONE });
    const page = await fresh.newPage();
    await page.goto(url);
    await page.waitForURL(/\/admin$/);
    const replay = await browser.newContext({ viewport: PHONE });
    const p2 = await replay.newPage();
    await p2.goto(url);
    await p2.waitForURL(/\/login/);
    await fresh.close();
    await replay.close();
    await owner.context.close();
  });
});

// ---------------------------------------------------------------------------
// M: membership on the Me page
// ---------------------------------------------------------------------------

describe("M · membership", () => {
  test("M1 · non-member sees the Join panel with both plans on Me; member sees their card", async () => {
    const pete = await signedIn(PEOPLE.player.email);
    const page = await pete.context.newPage();
    await page.goto("/profile");
    await page.getByText(/Not a member yet/).waitFor();
    assert.ok(await page.getByText(/monthly/i).first().isVisible());
    await pete.context.close();
    const mia = await signedIn(PEOPLE.member.email);
    const mp = await mia.context.newPage();
    await mp.goto("/profile");
    await mp.getByText(/Active · renews/).waitFor();
    await mia.context.close();
  });

  test("M2 · the play calendar offers casual spots on bookable days", async () => {
    const pete = await signedIn(PEOPLE.player.email);
    const page = await pete.context.newPage();
    await page.goto("/profile");
    const calendar = page.locator("section", { has: page.getByRole("heading", { name: /play calendar|calendar|upcoming/i }) }).first();
    await calendar.waitFor();
    assert.ok((await page.getByRole("button", { name: /book/i }).count()) > 0, "a Book button for casual spots");
    await pete.context.close();
  });

  test("M3 · Next up shows the member's Friday; \"Can't make it\" toggles and is saved", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const page = await mia.context.newPage();
    await page.goto("/profile");
    const next = page.locator("section", { has: page.getByRole("heading", { name: "Next up" }) });
    await next.getByText("Included in your membership").waitFor();
    await next.getByRole("button", { name: "Can't make it" }).click();
    await next.getByRole("button", { name: "I can come after all" }).waitFor();
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM player_absences WHERE email = $1`, [PEOPLE.member.email]);
    assert.ok(rows[0].n >= 1, "absence saved");
    await next.getByRole("button", { name: "I can come after all" }).click();
    await next.getByRole("button", { name: "Can't make it" }).waitFor();
    await shot(page, "me-member");
    await mia.context.close();
  });

  test("M4 · the member card offers the leave / change flow", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const page = await mia.context.newPage();
    await page.goto("/profile");
    // Opens the leave / change flow (completing it calls Stripe: covered with test keys only).
    await page.getByRole("button", { name: "Turn off auto-renew" }).click();
    await page.getByRole("dialog").waitFor();
    await mia.context.close();
  });

  test("M5 · an offline membership recorded by the club shows on the member's Me page", async () => {
    await db.query(
      `INSERT INTO memberships (email, plan, first_name, last_name, period_start, period_end, status, day, recurring)
       VALUES ($1, 'quarterly', 'Otto', 'Second', CURRENT_DATE, CURRENT_DATE + 84, 'active', 'wednesday', FALSE)`,
      [PEOPLE.owner2.email],
    );
    const otto = await signedIn(PEOPLE.owner2.email);
    const page = await otto.context.newPage();
    await page.goto("/profile");
    await page.getByText(/Active · ends/).waitFor();
    await otto.context.close();
  });
});

// ---------------------------------------------------------------------------
// G: Arena
// ---------------------------------------------------------------------------

describe("G · Arena", () => {
  test("G1 · challenge: pair up → post → accept → check in → score → confirm", async () => {
    const a = await signedIn(PEOPLE.member.email);
    const b = await signedIn(PEOPLE.player.email);
    const c = await signedIn(PEOPLE.owner.email);
    const d = await signedIn(PEOPLE.coach.email);
    const pair = async (x, y) => {
      const code = await api(x.token, { action: "pair_code" });
      assert.equal(code.status, 200, JSON.stringify(code.json));
      assert.equal((await api(y.token, { action: "pair_enter", code: code.json.code.code })).status, 200);
      assert.equal((await api(x.token, { action: "pair_respond", accept: true })).status, 200);
    };
    await pair(a, b);
    await pair(c, d);
    const posted = await api(a.token, { action: "post", days: 3, note: "Friday?" });
    assert.equal(posted.status, 200, JSON.stringify(posted.json));
    const openId = posted.json.state.mine.find((x) => x.status === "open")?.id ?? posted.json.state.open[0]?.id;
    assert.ok(openId, "challenge posted");
    // The other pair sees it in the UI.
    const page = await c.context.newPage();
    await page.goto("/profile/arena");
    await page.locator(`#challenge-${openId}`).waitFor();
    await shot(page, "arena-challenges");
    assert.equal((await api(c.token, { action: "accept", id: openId })).status, 200);
    assert.equal((await api(a.token, { action: "checkin_now", id: openId })).status, 200);
    const scored = await api(a.token, { action: "score", id: openId, posting: 21, accepting: 17 });
    assert.equal(scored.status, 200, JSON.stringify(scored.json));
    const confirmed = await api(c.token, { action: "confirm", id: openId });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    for (const x of [a, b, c, d]) await x.context.close();
  });

  test("G2 · Leaderboard tab: filters, player card, challenge from card, opt-out respected", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const page = await mia.context.newPage();
    await page.goto("/profile/leaderboard");
    await page.getByRole("heading", { name: /leaderboard/i }).first().waitFor();
    // Hidden players never appear.
    assert.equal(await page.getByText("Hana").count(), 0, "opted-out player is not listed");
    // Filters keep you on the Leaderboard tab.
    await page.getByRole("link", { name: /challenges/i }).first().click();
    await page.waitForURL(/\/profile\/leaderboard\?.*source=challenges/);
    await page.goto("/profile/leaderboard");
    // Player card from a row.
    await page.locator("li[role=button]", { hasText: "Olivia" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText(/WP all time/).waitFor();
    await dialog.getByText(/Recent form/).waitFor();
    await dialog.getByRole("button", { name: /challenge/i }).click();
    await page.waitForURL(/\/profile\/arena/);
    await shot(page, "arena-challenges-from-card");
    await page.goto("/profile/leaderboard");
    await shot(page, "leaderboard");
    // The ladder lives on the Player tab; old Arena segment links still land.
    await page.goto("/profile/arena?tab=ranks");
    await page.waitForURL(/\/profile\/player$/);
    await page.getByRole("heading", { name: "The ladder" }).waitFor();
    await shot(page, "player-ranks");
    await page.goto("/profile/arena?tab=leaderboard&period=year");
    await page.waitForURL(/\/profile\/leaderboard\?period=year$/);
    // The hidden player sees their own rank only.
    const hana = await signedIn(PEOPLE.hidden.email);
    const hp = await hana.context.newPage();
    await hp.goto("/profile/leaderboard");
    assert.ok((await hp.getByText(/hidden/i).count()) > 0, "hidden player gets the 'you are hidden' note");
    await mia.context.close();
    await hana.context.close();
  });

  test("G2 · public teaser: top five, first names only, link into the app", async () => {
    const context = await browser.newContext({ viewport: PHONE, baseURL: base() });
    const page = await context.newPage();
    await page.goto("/#leaderboard");
    const teaser = page.locator("#leaderboard");
    await teaser.waitFor();
    const items = await teaser.locator("li").allInnerTexts();
    assert.ok(items.length <= 5);
    for (const t of items) {
      assert.doesNotMatch(t, /Member|Player|Owner|Coach|Hidden/, `last names never shown: ${t}`);
      assert.doesNotMatch(t, /Hana/, "opted-out player not in the teaser");
    }
    assert.ok(await teaser.getByRole("link", { name: /full board in the app/i }).isVisible());
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// T · tenant isolation at the routes (test plan §3.5; build plan §6.1)
//
// The same database, served a second time as a synthetic second club with
// every statement run through row-level security (TENANT_SCOPE=enforce).
// Every page and API route in the app is requested there, signed in as a
// platform admin (who may open any club's admin). Nothing that belongs to
// the first club may come back.
// ---------------------------------------------------------------------------

/** Every page and GET route in app/, as a URL path with made-up values for [params]. */
function allRoutes() {
  const out = [];
  const fill = { date: "2026-01-02", id: "1", token: "no-such-token", slug: "x", draw: "1", code: "000000", club: "three-wolves" };
  const walk = (dir, url) => {
    for (const name of readdirSync(dir)) {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) {
        if (name.startsWith("_") || name.startsWith("@")) continue;
        const seg = name.startsWith("(") ? "" : name.startsWith("[") ? `/${fill[name.replace(/[\[\].]/g, "")] ?? "1"}` : `/${name}`;
        walk(full, url + seg);
      } else if (name === "page.tsx" || name === "route.ts") {
        out.push({ path: url || "/", api: name === "route.ts" });
      }
    }
  };
  walk("app", "");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

describe("T · tenant isolation at the routes", () => {
  test("T1 · served as a second club, no page or API route returns the first club's data", async () => {
    // What marks the first club's data: its members, their messages, its play days' location.
    const MARKERS = [PEOPLE.member.email, PEOPLE.player.email, PEOPLE.hidden.email, PEOPLE.coach.email, PEOPLE.admin.email, "Mia Member", "Pete Player", "Welcome to Fridays", "See you at Pioneer"];
    // A synthetic second club, with every module on.
    const club2 = (
      await db.query(
        `INSERT INTO tenants (slug, name, status, country, region, timezone, currency, languages, sports, payment_mode, incorporated, stripe_status, bank_details, theme, terms)
         SELECT 'hanoi-smash', 'Hanoi Smash', status, 'VN', 'syd', 'Asia/Ho_Chi_Minh', 'VND', languages, sports, payment_mode, incorporated, 'none', '{}'::jsonb, theme, terms FROM tenants WHERE slug = 'three-wolves' RETURNING id`,
      )
    ).rows[0].id;
    await db.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled, settings) SELECT $1, module_id, TRUE, settings FROM tenant_modules WHERE tenant_id = 1`, [club2]);
    // The second club's server connects with the app's own login, which has no rights until it steps down
    // to the app's role; TENANT_SCOPE is deliberately "off": with that login every statement is scoped anyway.
    const second = await startSecondServer(env.serverEnv, { TENANT_SLUG: "hanoi-smash", TENANT_SCOPE: "off", APP_DATABASE_URL: await ensureAppLogin() });
    const owner = await signedIn(PEOPLE.owner.email, DESKTOP); // an owner here, and a platform admin everywhere
    const clubAdmin = await signedIn(PEOPLE.admin.email, DESKTOP); // an admin of the first club only
    const get = async (base, path, token) => {
      const r = await fetch(`${base}${path}`, { headers: token ? { Cookie: `tw_player=${token}` } : {}, redirect: "manual" });
      return { status: r.status, body: r.status >= 300 && r.status < 400 ? "" : await r.text() };
    };
    try {
      const routes = allRoutes();
      assert.ok(routes.length > 80, `only ${routes.length} routes found`);
      const leaks = [];
      const broken = [];
      let controlHits = 0;
      for (const route of routes) {
        for (const [who, token] of [["platform admin", owner.token], ["nobody", null]]) {
          const there = await get(second.base, route.path, token);
          if (there.status >= 500) broken.push(`${route.path} as ${who}: ${there.status}`);
          const found = MARKERS.filter((m) => there.body.includes(m));
          if (found.length) leaks.push(`${route.path} as ${who}: ${found.join(", ")}`);
        }
        // The control: the same request to the first club does show its data on many routes.
        const here = await get(base(), route.path, owner.token);
        if (MARKERS.some((m) => here.body.includes(m))) controlHits++;
      }
      assert.deepEqual(leaks, [], `the first club's data came back from the second club's site:\n${leaks.join("\n")}`);
      assert.deepEqual(broken, [], `routes that fail when run through row-level security:\n${broken.join("\n")}\n${second.serverLog.join("").slice(-3000)}`);
      assert.ok(controlHits >= 5, `the markers appear on only ${controlHits} routes of the first club: the check proves nothing`);
      // The players' app API: the first club doesn't exist on the second club's
      // deployment, and the second club's own config is its own (VND has no cents).
      assert.equal((await get(second.base, "/api/v1/app/clubs/three-wolves/config", owner.token)).status, 404);
      const cfg2 = JSON.parse((await get(second.base, "/api/v1/app/clubs/hanoi-smash/config", null)).body);
      assert.equal(cfg2.club.slug, "hanoi-smash");
      assert.equal(cfg2.club.currency, "VND");
      assert.equal(cfg2.club.currencyExponent, 0);
      const clubs2 = JSON.parse((await get(second.base, "/api/v1/app/clubs", clubAdmin.token)).body).clubs;
      assert.deepEqual(clubs2.map((c) => [c.slug, c.role, c.canOpenAdmin]), [["hanoi-smash", "member", false]], "the first club's admin is a plain member here, and sees no other club");
      // The first club's admin is nobody at the second club.
      assert.equal((await get(second.base, "/admin", clubAdmin.token)).status, 403);
      assert.equal((await get(second.base, "/api/admin/finance/export", clubAdmin.token)).status, 403);
      assert.equal((await get(base(), "/admin", clubAdmin.token)).status, 200);
    } finally {
      second.stop();
      await owner.context.close();
      await clubAdmin.context.close();
      // Whatever the second club's visitors left behind (each club has its own rows now), then the club.
      const owned = (await db.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name <> 'tenant_modules'`)).rows;
      for (let pass = 0; pass < 3; pass++) {
        for (const { table_name } of owned) await db.query(`DELETE FROM "${table_name}" WHERE tenant_id = $1`, [club2]).catch(() => {});
      }
      await db.query(`DELETE FROM tenant_modules WHERE tenant_id = $1`, [club2]);
      await db.query(`DELETE FROM tenants WHERE id = $1`, [club2]);
    }
  });
});

// ---------------------------------------------------------------------------
// API · the players' app API (/api/v1/app, build plan §4.1; Phase 4 gate)
// ---------------------------------------------------------------------------

const APP_API = "/api/v1/app";
// Kept in step with packages/api/src/contract.ts by the last test of this group.
const SESSION_ENDPOINTS = [
  ["GET", "/auth/session"],
  ["POST", "/auth/logout"],
  ["GET", "/clubs"],
  ["GET", "/clubs/{club}/me"],
  ["POST", "/clubs/{club}/me/absence"],
  ["POST", "/account/welcome-dismissed"],
  ["GET", "/clubs/{club}/messages"],
  ["POST", "/clubs/{club}/messages"],
  ["GET", "/clubs/{club}/messages/{id}"],
  ["POST", "/clubs/{club}/messages/{id}"],
  ["GET", "/account/profile"],
  ["POST", "/account/details"],
  ["POST", "/account/language"],
  ["POST", "/account/privacy"],
  ["POST", "/account/photo"],
  ["DELETE", "/account/photo"],
  ["GET", "/account/export"],
  ["POST", "/account/admin-handoff"],
  ["POST", "/account/delete"],
  ["GET", "/account/integrations"],
  ["POST", "/account/integrations/tokens"],
  ["DELETE", "/account/integrations/tokens/{id}"],
  ["POST", "/account/integrations/webhooks"],
  ["DELETE", "/account/integrations/webhooks/{id}"],
  ["GET", "/clubs/{club}/arena"],
  ["POST", "/clubs/{club}/arena"],
  ["GET", "/clubs/{club}/leaderboard"],
  ["GET", "/clubs/{club}/players/{id}"],
  ["GET", "/clubs/{club}/me/stats"],
  ["GET", "/clubs/{club}/shop"],
  ["POST", "/clubs/{club}/shop/orders"],
  ["POST", "/clubs/{club}/shop/orders/{id}/confirm"],
  ["POST", "/clubs/{club}/shop/orders/{id}/cancel"],
  ["GET", "/clubs/{club}/membership"],
  ["GET", "/clubs/{club}/membership/billing"],
  ["POST", "/clubs/{club}/membership"],
  ["POST", "/clubs/{club}/membership/portal"],
  ["POST", "/clubs/{club}/membership/join"],
  ["POST", "/clubs/{club}/me/book"],
  ["GET", "/clubs/{club}/vision"],
  ["GET", "/clubs/{club}/vision/challenges/{id}"],
  ["GET", "/clubs/{club}/vision/players"],
  ["POST", "/clubs/{club}/vision/labels"],
  ["GET", "/clubs/{club}/vision/pass"],
  ["POST", "/clubs/{club}/vision/pass"],
  ["PATCH", "/clubs/{club}/vision/pass"],
  ["POST", "/clubs/{club}/vision/stats"],
  ["PUT", "/clubs/{club}/vision/stats"],
  ["GET", "/clubs/{club}/vision/model"],
  ["POST", "/clubs/{club}/vision/model"],
  ["POST", "/clubs/{club}/vision/share"],
  ["GET", "/clubs/{club}/arena/challenges/{id}/stats"],
  ["GET", "/clubs/{club}/me/photos"],
  ["POST", "/clubs/{club}/me/photos"],
  ["POST", "/clubs/{club}/me/photos/upload"],
  ["DELETE", "/clubs/{club}/me/photos/{id}"],
];
const POST_ENDPOINTS = ["/auth/email/start", "/auth/email/verify", "/auth/sms/start", "/auth/sms/verify"];
const CLUB = "three-wolves";
const filled = (path) => path.replace("{club}", CLUB).replace("{id}", "1");

async function appApi(method, path, { token, body, headers = {}, raw } = {}) {
  const r = await fetch(`${base()}${APP_API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, headers: r.headers };
}

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

describe("API · the players' app API", () => {
  test("API1 · email code → bearer token → session, clubs and config; the web session is untouched; sign out ends only that token", async () => {
    const web = await signedIn(PEOPLE.member.email); // the same person, already signed in on the web
    await clearOutbox();
    const started = await appApi("POST", "/auth/email/start", { body: { email: "  Mia.Member@E2E.test ", lang: null, turnstileToken: null } });
    assert.deepEqual([started.status, started.json], [200, { ok: true }]);
    const code = await outboxCode(PEOPLE.member.email);

    const wrong = await appApi("POST", "/auth/email/verify", { body: { email: PEOPLE.member.email, code: code === "000000" ? "111111" : "000000" } });
    assert.equal(wrong.status, 400);
    assert.equal(typeof wrong.json.error, "string");

    const verified = await appApi("POST", "/auth/email/verify", { body: { email: PEOPLE.member.email, code, phoneProof: null } });
    assert.equal(verified.status, 200);
    assert.deepEqual(Object.keys(verified.json).sort(), ["expiresAt", "needsDetails", "ok", "phoneTaken", "token"]);
    assert.equal(verified.json.needsDetails, false);
    assert.equal(verified.headers.get("set-cookie"), null, "the app gets a token, not a cookie");
    const token = verified.json.token;
    const days = (new Date(verified.json.expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 89 && days < 91, `expires in ${days} days`);
    // Only the hash is stored, in the same table as the web's sessions.
    const hash = createHash("sha256").update(token).digest("hex");
    assert.equal((await db.query(`SELECT 1 FROM player_sessions WHERE token_hash = $1`, [hash])).rowCount, 1);
    assert.equal((await db.query(`SELECT 1 FROM player_sessions WHERE token_hash = $1`, [token])).rowCount, 0);

    const me = await appApi("GET", "/auth/session", { token });
    assert.equal(me.status, 200);
    assert.equal(me.json.player.email, PEOPLE.member.email);
    assert.equal(me.json.player.firstName, "Mia");
    assert.deepEqual(Object.keys(me.json.player).sort(), ["avatarUrl", "displayName", "email", "firstName", "id", "lang", "lastName", "phoneVerified"]);
    assert.equal(me.headers.get("cache-control"), "no-store");

    const clubs = await appApi("GET", "/clubs", { token });
    assert.equal(clubs.status, 200);
    assert.deepEqual(clubs.json.clubs.map((c) => [c.slug, c.role, c.status, c.canOpenAdmin]), [["three-wolves", "member", "active", false]]);
    assert.equal(clubs.json.clubs[0].apiBase, `${base()}${APP_API}`);

    // The same session answers on the web too (one player_sessions row, two ways to send it).
    const viaCookie = await fetch(`${base()}${APP_API}/auth/session`, { headers: { Cookie: `tw_player=${token}` } });
    assert.equal(viaCookie.status, 200);

    // Signing in on the app signed nobody out: the web session still works.
    const page = await web.context.newPage();
    await page.goto("/profile");
    await page.waitForSelector("text=Mia");
    await page.close();

    const out = await appApi("POST", "/auth/logout", { token, body: {} });
    assert.deepEqual([out.status, out.json], [200, { ok: true }]);
    assert.equal((await appApi("GET", "/auth/session", { token })).status, 401);
    assert.equal((await fetch(`${base()}${APP_API}/auth/session`, { headers: { Cookie: `tw_player=${web.token}` } })).status, 200, "the web session survives the app's sign-out");
    await web.context.close();
  });

  test("API2 · sign out everywhere ends every session of that person and nobody else's", async () => {
    const a = await signedIn(PEOPLE.player.email);
    const b = await signedIn(PEOPLE.player.email);
    const other = await signedIn(PEOPLE.coach.email);
    assert.equal((await appApi("POST", "/auth/logout", { token: a.token, body: { all: true } })).status, 200);
    assert.equal((await appApi("GET", "/auth/session", { token: a.token })).status, 401);
    assert.equal((await appApi("GET", "/auth/session", { token: b.token })).status, 401);
    assert.equal((await appApi("GET", "/auth/session", { token: other.token })).status, 200);
    for (const s of [a, b, other]) await s.context.close();
  });

  test("API3 · the club's config is public and carries the club's look, modules, terms and money", async () => {
    const r = await appApi("GET", "/clubs/three-wolves/config");
    assert.equal(r.status, 200);
    const c = r.json;
    assert.deepEqual(Object.keys(c).sort(), ["apiBase", "club", "modules", "settings", "terms", "theme"]);
    assert.equal(c.club.name, "Three Wolves Badminton Club");
    assert.deepEqual([c.club.currency, c.club.currencyExponent, c.club.country, c.club.region], ["NZD", 2, "NZ", "syd"]);
    // Three Wolves wears its own navy and bronze, as semantic tokens.
    assert.equal(c.theme.light.primary, "#184467");
    assert.equal(c.theme.light.accent, "#C4892A");
    assert.equal(c.theme.light.surface, "#fcfbf2");
    assert.match(c.theme.light["font-display"], /Copperplate/);
    assert.equal(c.theme.artSet, "three-wolves");
    assert.deepEqual(Object.keys(c.theme.light).sort(), Object.keys(c.theme.dark).sort());
    // Every token the contract names, the four optional ones included (Three Wolves sets its own).
    const { themeTokensSchema } = await import("../../../../packages/api/src/schemas.ts");
    assert.deepEqual(Object.keys(c.theme.light).sort(), Object.keys(themeTokensSchema.shape).sort());
    assert.equal(c.terms.pointsName, "Wolf Points");
    for (const m of ["arena", "vision", "memberships"]) assert.ok(c.modules.includes(m), m);
    // A club this deployment doesn't serve doesn't exist, whoever asks.
    for (const slug of ["hanoi-smash", "no-such-club"]) assert.deepEqual([(await appApi("GET", `/clubs/${slug}/config`)).status], [404], slug);
    for (const slug of ["Three-Wolves", "a%20b", "..%2F..", "x".repeat(80)]) assert.equal((await appApi("GET", `/clubs/${slug}/config`)).status, 404, slug);
  });

  test("API3 · a module switched off leaves the config's module list", async () => {
    await db.query(`UPDATE tenant_modules SET enabled = FALSE WHERE tenant_id = 1 AND module_id = 'gallery'`);
    try {
      await new Promise((r) => setTimeout(r, 1200)); // MODULES_CACHE_MS in the test environment
      let modules;
      for (let i = 0; i < 20; i++) {
        modules = (await appApi("GET", "/clubs/three-wolves/config")).json.modules;
        if (!modules.includes("gallery")) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.ok(!modules.includes("gallery"), "gallery is off");
      assert.ok(modules.includes("arena"));
    } finally {
      await db.query(`UPDATE tenant_modules SET enabled = TRUE WHERE tenant_id = 1 AND module_id = 'gallery'`);
      for (let i = 0; i < 20; i++) {
        if ((await appApi("GET", "/clubs/three-wolves/config")).json.modules.includes("gallery")) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  });

  test("API4 · permissions: who sees the Club admin button; a disabled or deleted account; no session, a dead one, an access key", async () => {
    const expectations = [["owner", "owner", true], ["admin", "admin", true], ["coach", "coach", true], ["member", "member", false], ["hidden", "member", false]];
    for (const [who, role, canOpenAdmin] of expectations) {
      const s = await signedIn(PEOPLE[who].email);
      const clubs = (await appApi("GET", "/clubs", { token: s.token })).json.clubs;
      assert.deepEqual([clubs.length, clubs[0].role, clubs[0].canOpenAdmin], [1, role, canOpenAdmin], who);
      await s.context.close();
    }
    for (const [method, template] of SESSION_ENDPOINTS) {
      const path = filled(template);
      for (const [what, headers] of [
        ["nobody", {}],
        ["a made-up token", { Authorization: `Bearer ${randomBytes(32).toString("base64url")}` }],
        ["an access key", { Authorization: "Bearer tw_0123456789abcdef0123456789abcdef" }],
        ["an oversized token", { Authorization: `Bearer ${"a".repeat(5000)}` }],
        ["a made-up cookie", { Cookie: "tw_player=nope" }],
      ]) {
        const r = await appApi(method, path, { headers, body: method === "POST" ? {} : undefined });
        assert.deepEqual([r.status, r.json], [401, { error: "unauthorized" }], `${method} ${path} as ${what}`);
      }
    }
    // An expired session is nobody.
    const expired = await signedIn(PEOPLE.member.email);
    await db.query(`UPDATE player_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1`, [createHash("sha256").update(expired.token).digest("hex")]);
    assert.equal((await appApi("GET", "/auth/session", { token: expired.token })).status, 401);
    await expired.context.close();
  });

  test("API5 · bad input is a 400 with a code, never a 500", async () => {
    const bodies = ["", "{", "null", "[]", '"x"', "12", '{"email":5}', '{"email":"not-an-email"}', '{"email":["a@b.co"],"code":{"$gt":""}}', '{"phone":"x","recaptchaToken":1}', `{"email":"${"a".repeat(5000)}@b.co"}`, '{"sessionInfo":"short","code":"1"}'];
    for (const path of POST_ENDPOINTS) {
      for (const raw of bodies) {
        const r = await appApi("POST", path, { raw, headers: { "x-forwarded-for": `10.9.${POST_ENDPOINTS.indexOf(path)}.${bodies.indexOf(raw)}` } });
        assert.equal(r.status, 400, `${path} with ${raw.slice(0, 40)} → ${r.status} ${JSON.stringify(r.json)}`);
        assert.equal(typeof r.json?.error, "string", path);
      }
    }
    const s = await signedIn(PEOPLE.member.email);
    for (const raw of ["{", "[]", '{"all":"yes"}', '"x"']) {
      const r = await appApi("POST", "/auth/logout", { token: s.token, raw });
      assert.deepEqual([r.status, r.json], [400, { error: "bad_request" }], raw);
    }
    assert.equal((await appApi("GET", "/auth/session", { token: s.token })).status, 200, "a refused sign-out leaves the session alone");
    await s.context.close();
  });

  test("API6 · CORS allow-list, preflight, and cookie requests from another site", async () => {
    for (const origin of ["https://app.luvallplay.com", "capacitor://localhost", "https://localhost"]) {
      const pre = await fetch(`${base()}${APP_API}/clubs`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
      assert.equal(pre.status, 204, origin);
      assert.equal(pre.headers.get("access-control-allow-origin"), origin);
      assert.match(pre.headers.get("access-control-allow-headers"), /Authorization/);
      const r = await appApi("GET", "/clubs/three-wolves/config", { headers: { Origin: origin } });
      assert.equal(r.headers.get("access-control-allow-origin"), origin);
      assert.match(r.headers.get("vary"), /Origin/);
    }
    for (const origin of ["https://evil.example", "https://app.luvallplay.com.evil.example", "null"]) {
      const pre = await fetch(`${base()}${APP_API}/clubs`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" } });
      assert.equal(pre.headers.get("access-control-allow-origin"), null, origin);
      const r = await appApi("GET", "/clubs/three-wolves/config", { headers: { Origin: origin } });
      assert.equal(r.headers.get("access-control-allow-origin"), null, origin);
    }
    // A cookie rides along on its own, so a write from another site is refused; a bearer token is fine from anywhere.
    const s = await signedIn(PEOPLE.member.email);
    const cross = await appApi("POST", "/auth/logout", { headers: { Cookie: `tw_player=${s.token}`, Origin: "https://evil.example" }, body: {} });
    assert.deepEqual([cross.status, cross.json], [403, { error: "bad_origin" }]);
    assert.equal((await appApi("GET", "/auth/session", { token: s.token })).status, 200, "still signed in");
    const fromApp = await appApi("POST", "/auth/logout", { headers: { Cookie: `tw_player=${s.token}`, Origin: "https://app.luvallplay.com" }, body: {} });
    assert.equal(fromApp.status, 200);
    await s.context.close();
  });

  test("API8 · Me: a member's home is the website's Me data; a non-member gets the way to join; Memberships off hides both", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const me = await appApi("GET", `/clubs/${CLUB}/me`, { token: mia.token });
    assert.equal(me.status, 200, JSON.stringify(me.json));
    assert.deepEqual(Object.keys(me.json).sort(), ["calendar", "casualPrice", "inbox", "join", "membership", "player", "stats", "welcome"]);
    assert.equal(me.headers.get("cache-control"), "no-store");
    assert.deepEqual([me.json.player.firstName, me.json.player.initials], ["Mia", "MM"]);
    const m = me.json.membership;
    assert.deepEqual([m.plan, m.day, m.status, m.autoRenews, m.method], ["monthly", "friday", "active", true, "card"]);
    assert.ok(m.daysLeft >= 1, `days left ${m.daysLeft}`);
    assert.equal(me.json.join, null);
    assert.equal(me.json.casualPrice, 1000);
    assert.ok(me.json.calendar.length >= 2, "the seeded play days");
    for (const d of me.json.calendar) {
      assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(d.location, "Pioneer Stadium");
    }
    // Her Fridays are included; the Wednesdays are not.
    const fridays = me.json.calendar.filter((d) => new Date(`${d.date}T12:00:00Z`).getUTCDay() === 5);
    assert.ok(fridays.length && fridays.every((d) => d.included), "Fridays are in her membership");
    assert.ok(me.json.calendar.filter((d) => new Date(`${d.date}T12:00:00Z`).getUTCDay() === 3).every((d) => !d.included));
    assert.ok(me.json.inbox.unread >= 1);
    assert.equal(me.json.inbox.latest[0].subject, "Welcome to Fridays");
    assert.ok(me.json.inbox.latest.length <= 3);
    assert.equal(me.json.welcome, false);

    const pete = await signedIn(PEOPLE.player.email);
    const his = (await appApi("GET", `/clubs/${CLUB}/me`, { token: pete.token })).json;
    assert.equal(his.membership, null);
    assert.deepEqual([his.join.monthly, his.join.quarterly], [3300, 8500]);
    assert.ok(his.join.days.includes("friday"));
    assert.equal(his.welcome, true);
    assert.equal(his.inbox.unread, 0);
    assert.ok(his.calendar.every((d) => !d.included));

    // A club with Memberships off: no card, no way to join; the play days stay.
    await db.query(`UPDATE tenant_modules SET enabled = FALSE WHERE tenant_id = 1 AND module_id = 'memberships'`);
    try {
      let off;
      for (let i = 0; i < 20; i++) {
        off = (await appApi("GET", `/clubs/${CLUB}/me`, { token: mia.token })).json;
        if (off.membership === null) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      assert.equal(off.membership, null);
      assert.equal((await appApi("GET", `/clubs/${CLUB}/me`, { token: pete.token })).json.join, null);
      assert.ok(off.calendar.length >= 2);
    } finally {
      await db.query(`UPDATE tenant_modules SET enabled = TRUE WHERE tenant_id = 1 AND module_id = 'memberships'`);
    }
    // Another club's Me doesn't exist on this deployment.
    assert.equal((await appApi("GET", "/clubs/hanoi-smash/me", { token: mia.token })).status, 404);
    await mia.context.close();
    await pete.context.close();
  });

  test("API9 · Can't make it: frees the spot, shows on Me, undoes; past days, non-members and impossible dates are refused", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const home = async () => (await appApi("GET", `/clubs/${CLUB}/me`, { token: mia.token })).json;
    const day = (await home()).calendar.find((d) => d.included && !d.paused && !d.absent);
    assert.ok(day, "an included Friday");
    const set = (absent, date = day.date) => appApi("POST", `/clubs/${CLUB}/me/absence`, { token: mia.token, body: { date, absent } });
    try {
      assert.deepEqual([(await set(true)).status], [200]);
      const after = (await home()).calendar.find((d) => d.date === day.date);
      assert.equal(after.absent, true);
      assert.equal(after.spots, day.spots + 1, "her spot is free for someone else");
      assert.equal((await db.query(`SELECT 1 FROM player_absences WHERE session_date = $1 AND email = $2`, [day.date, PEOPLE.member.email])).rowCount, 1);
      // The website sees the same thing (one table).
      assert.equal((await set(false)).status, 200);
      const back = (await home()).calendar.find((d) => d.date === day.date);
      assert.deepEqual([back.absent, back.spots], [false, day.spots]);
    } finally {
      await db.query(`DELETE FROM player_absences WHERE session_date = $1 AND email = $2`, [day.date, PEOPLE.member.email]);
    }
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
    assert.deepEqual([(await set(true, yesterday)).status, (await set(true, yesterday)).json], [400, { error: "past" }]);
    for (const bad of ["2026-02-30", "2026-13-01", "26-01-01", "tomorrow", ""]) {
      const r = await set(true, bad);
      assert.deepEqual([r.status, r.json], [400, { error: "bad_request" }], bad);
    }
    const pete = await signedIn(PEOPLE.player.email);
    const r = await appApi("POST", `/clubs/${CLUB}/me/absence`, { token: pete.token, body: { date: day.date, absent: true } });
    assert.deepEqual([r.status, r.json], [404, { error: "no_membership" }]);
    await mia.context.close();
    await pete.context.close();
  });

  test("API10 · the welcome card's Done is kept on the account", async () => {
    const pete = await signedIn(PEOPLE.player.email);
    const { rows } = await db.query(`SELECT id, welcome_card_dismissed_at FROM players WHERE email = $1`, [PEOPLE.player.email]);
    try {
      assert.equal((await appApi("GET", `/clubs/${CLUB}/me`, { token: pete.token })).json.welcome, true);
      const done = await appApi("POST", "/account/welcome-dismissed", { token: pete.token, body: {} });
      assert.deepEqual([done.status, done.json], [200, { ok: true }]);
      assert.equal((await appApi("GET", `/clubs/${CLUB}/me`, { token: pete.token })).json.welcome, false);
      assert.ok((await db.query(`SELECT welcome_card_dismissed_at FROM players WHERE id = $1`, [rows[0].id])).rows[0].welcome_card_dismissed_at);
      assert.equal((await db.query(`SELECT 1 FROM player_events WHERE player_id = $1 AND event = 'welcome_dismissed'`, [rows[0].id])).rowCount >= 1, true);
    } finally {
      // Other journeys meet Pete's welcome card.
      await db.query(`UPDATE players SET welcome_card_dismissed_at = $2 WHERE id = $1`, [rows[0].id, rows[0].welcome_card_dismissed_at]);
      await pete.context.close();
    }
  });

  test("API11 · messages: list, read (marks read), start and reply (the club hears), only your own, bad input refused", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const pete = await signedIn(PEOPLE.player.email);
    const peteId = (await db.query(`SELECT id FROM players WHERE email = $1`, [PEOPLE.player.email])).rows[0].id;
    const path = (p) => `/clubs/${CLUB}/messages${p}`;
    const list = (s) => appApi("GET", path(""), { token: s.token });
    try {
      // Mia's list: the club's message, unread, written by the club.
      const mine = (await list(mia)).json.threads;
      const welcome = mine.find((t) => t.subject === "Welcome to Fridays");
      assert.ok(welcome, JSON.stringify(mine));
      assert.deepEqual([welcome.unread, welcome.status, welcome.lastSender], [true, "open", "admin"]);
      assert.deepEqual(Object.keys(welcome).sort(), ["id", "lastMessageAt", "lastSender", "preview", "status", "subject", "unread"]);
      // Reading it marks it read.
      const read = await appApi("GET", path(`/${welcome.id}`), { token: mia.token });
      assert.equal(read.status, 200);
      assert.equal(read.json.thread.subject, "Welcome to Fridays");
      assert.deepEqual(read.json.thread.messages.map((m) => [m.sender, m.body]), [["admin", "See you at Pioneer on Friday!"]]);
      assert.equal((await list(mia)).json.threads.find((t) => t.id === welcome.id).unread, false);
      // Somebody else's conversation doesn't exist for Pete, to read or to answer.
      assert.deepEqual([(await appApi("GET", path(`/${welcome.id}`), { token: pete.token })).status], [404]);
      const intrude = await appApi("POST", path(`/${welcome.id}`), { token: pete.token, body: { body: "hello" } });
      assert.deepEqual([intrude.status, intrude.json], [404, { error: "not_found" }]);
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM messages WHERE thread_id = $1`, [welcome.id])).rows[0].n, 1);

      // Pete starts a conversation; the club's admins are emailed.
      await clearOutbox();
      const started = await appApi("POST", path(""), { token: pete.token, body: { subject: "  Jersey size  ", body: "Do you have XL?" } });
      assert.equal(started.status, 200, JSON.stringify(started.json));
      const id = started.json.id;
      const row = (await db.query(`SELECT player_id, subject, unread_for_admin, started_by FROM message_threads WHERE id = $1`, [id])).rows[0];
      assert.deepEqual([row.player_id, row.subject, row.unread_for_admin, row.started_by], [peteId, "Jersey size", true, "player"]);
      const mail = (await (await fetch(`${base()}/api/dev/outbox`)).json()).mail;
      assert.ok(mail.some((m) => /Message from Pete Player: Jersey size/.test(m.subject)), "the admins hear about it");
      // A closed conversation reopens when he replies.
      await db.query(`UPDATE message_threads SET status = 'closed' WHERE id = $1`, [id]);
      const reply = await appApi("POST", path(`/${id}`), { token: pete.token, body: { body: "Or L is fine" } });
      assert.equal(reply.status, 200);
      assert.deepEqual([reply.json.message.sender, reply.json.message.body], ["player", "Or L is fine"]);
      const thread = (await appApi("GET", path(`/${id}`), { token: pete.token })).json.thread;
      assert.deepEqual([thread.status, thread.messages.map((m) => m.body)], ["open", ["Do you have XL?", "Or L is fine"]]);

      // Bad input: 400 for a body that doesn't fit, 404 for a conversation id that can't exist.
      for (const body of [{}, { subject: "", body: "x" }, { subject: "x", body: "" }, { subject: "x".repeat(121), body: "x" }, { subject: "x", body: "x".repeat(4001) }, { subject: ["x"], body: "x" }]) {
        const r = await appApi("POST", path(""), { token: pete.token, body });
        assert.deepEqual([r.status, r.json], [400, { error: "bad_request" }], JSON.stringify(body).slice(0, 60));
      }
      for (const bad of ["abc", "0", "-1", "1.5", "99999999999"]) {
        assert.equal((await appApi("GET", path(`/${bad}`), { token: pete.token })).status, 404, bad);
      }
      assert.deepEqual([(await appApi("POST", path(`/${id}`), { token: pete.token, body: { body: "   " } })).status], [400]);
    } finally {
      await db.query(`UPDATE message_threads SET unread_for_player = TRUE WHERE player_id = (SELECT id FROM players WHERE email = $1) AND subject = 'Welcome to Fridays'`, [PEOPLE.member.email]);
      await db.query(`DELETE FROM messages WHERE thread_id IN (SELECT id FROM message_threads WHERE player_id = $1)`, [peteId]);
      await db.query(`DELETE FROM message_threads WHERE player_id = $1`, [peteId]);
      await mia.context.close();
      await pete.context.close();
    }
  });

  test("API12 · the account: profile, details (the phone keeps its confirmation), language, privacy, photo rules, data export", async () => {
    const pete = await signedIn(PEOPLE.player.email);
    const { rows } = await db.query(`SELECT id, first_name, last_name, display_name, lang, leaderboard_visible, phone, phone_e164, phone_verified_at FROM players WHERE email = $1`, [PEOPLE.player.email]);
    const before = rows[0];
    const call = (method, path, body) => appApi(method, path, { token: pete.token, body });
    try {
      await db.query(`UPDATE players SET phone = '021 555 0100', phone_e164 = '+64215550100', phone_verified_at = NOW() WHERE id = $1`, [before.id]);
      const profile = (await call("GET", "/account/profile")).json;
      assert.deepEqual(Object.keys(profile).sort(), ["avatarUrl", "customDisplayName", "defaultDisplayName", "displayName", "email", "firstName", "lang", "lastName", "leaderboardVisible", "phone", "phoneVerified"]);
      assert.deepEqual([profile.email, profile.firstName, profile.defaultDisplayName, profile.customDisplayName, profile.phoneVerified], [PEOPLE.player.email, "Pete", "Pete P.", false, true]);

      // Details: a chosen display name, then back to the default; the phone keeps its confirmation.
      assert.deepEqual((await call("POST", "/account/details", { firstName: " Peter ", lastName: "Player", displayName: "Pistol Pete" })).json, { ok: true });
      let p = (await call("GET", "/account/profile")).json;
      assert.deepEqual([p.firstName, p.displayName, p.customDisplayName, p.phoneVerified, p.phone], ["Peter", "Pistol Pete", true, true, "021 555 0100"]);
      await call("POST", "/account/details", { firstName: "Peter", lastName: "Player", displayName: "" });
      p = (await call("GET", "/account/profile")).json;
      assert.deepEqual([p.displayName, p.customDisplayName], ["Peter P.", false]);
      for (const bad of [{}, { firstName: "", lastName: "x" }, { firstName: "x".repeat(61), lastName: "" }, { firstName: "x", lastName: "y", displayName: "z".repeat(41) }]) {
        assert.equal((await call("POST", "/account/details", bad)).status, 400, JSON.stringify(bad).slice(0, 50));
      }

      // Language, kept on the account.
      assert.equal((await call("POST", "/account/language", { lang: "vi" })).status, 200);
      assert.equal((await db.query(`SELECT lang FROM players WHERE id = $1`, [before.id])).rows[0].lang, "vi");
      assert.equal((await call("POST", "/account/language", { lang: "fr" })).status, 400);

      // Privacy: off the leaderboard and back, mirrored to the club's members list.
      assert.equal((await call("POST", "/account/privacy", { leaderboardVisible: false })).status, 200);
      assert.equal((await db.query(`SELECT leaderboard_visible FROM players WHERE id = $1`, [before.id])).rows[0].leaderboard_visible, false);
      assert.equal((await db.query(`SELECT leaderboard_visible FROM club_members WHERE user_id = $1`, [before.id])).rows[0]?.leaderboard_visible, false);
      await call("POST", "/account/privacy", { leaderboardVisible: true });
      assert.equal((await call("POST", "/account/privacy", { leaderboardVisible: "no" })).status, 400);

      // Photo: a real picture reaches storage (not configured in this environment); anything else is refused.
      const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      assert.deepEqual([(await call("POST", "/account/photo", { image: png })).json], [{ error: "not_configured" }]);
      for (const image of ["data:image/gif;base64,R0lGOD", "data:text/html;base64,PHNjcmlwdD4=", "https://evil.example/x.png", "data:image/png;base64,<script>", "x".repeat(10)]) {
        assert.deepEqual([(await call("POST", "/account/photo", { image })).status], [400], image.slice(0, 30));
      }
      assert.deepEqual((await call("DELETE", "/account/photo")).json, { ok: true, url: null });

      // Data export: the account's own records.
      const data = await call("GET", "/account/export");
      assert.equal(data.status, 200);
      assert.match(JSON.stringify(data.json), new RegExp(PEOPLE.player.email.replace(".", "\\.")));
      assert.doesNotMatch(JSON.stringify(data.json), new RegExp(PEOPLE.member.email.replace(".", "\\.")), "nobody else's data");
    } finally {
      await db.query(
        `UPDATE players SET first_name = $2, last_name = $3, display_name = $4, lang = $5, leaderboard_visible = $6, phone = $7, phone_e164 = $8, phone_verified_at = $9 WHERE id = $1`,
        [before.id, before.first_name, before.last_name, before.display_name, before.lang, before.leaderboard_visible, before.phone, before.phone_e164, before.phone_verified_at],
      );
      await db.query(`UPDATE club_members SET leaderboard_visible = $2 WHERE user_id = $1`, [before.id, before.leaderboard_visible]);
      await pete.context.close();
    }
  });

  test("API13 · Club admin: a fresh owner gets a one-use link that opens admin signed in; an old sign-in must confirm (403, not 401); a member can't", async () => {
    const owner = await signedIn(PEOPLE.owner.email);
    const member = await signedIn(PEOPLE.member.email);
    try {
      const made = await appApi("POST", "/account/admin-handoff", { token: owner.token, body: {} });
      assert.equal(made.status, 200);
      assert.deepEqual(Object.keys(made.json).sort(), ["expiresInSeconds", "url"]);
      assert.ok(made.json.expiresInSeconds > 0 && made.json.expiresInSeconds <= 120);
      const link = new URL(made.json.url);
      assert.equal(link.origin, base());
      assert.equal(link.pathname, "/admin/handoff");
      assert.equal(made.headers.get("cache-control"), "no-store");
      const audited = await db.query(`SELECT 1 FROM admin_audit_log WHERE action = 'admin.handoff_created' AND target = (SELECT 'player:' || id FROM players WHERE email = $1)`, [PEOPLE.owner.email]);
      assert.ok(audited.rowCount >= 1, "audited like the web's handoff");

      // The link opens admin in a fresh browser, once.
      const fresh = await browser.newContext({ viewport: PHONE, baseURL: base() });
      const page = await fresh.newPage();
      await page.goto(made.json.url);
      await page.waitForURL(/\/admin(\/|$|\?)/);
      assert.doesNotMatch(new URL(page.url()).pathname, /handoff|signin|login/);
      await fresh.close();
      const again = await browser.newContext({ viewport: PHONE, baseURL: base() });
      const page2 = await again.newPage();
      await page2.goto(made.json.url);
      assert.doesNotMatch(new URL(page2.url()).pathname, /^\/admin\/?$/, "a used link doesn't open admin again");
      await again.close();

      // Signed in 13 hours ago: confirm first. 403, so the app doesn't think it was signed out.
      await db.query(`UPDATE player_sessions SET created_at = NOW() - INTERVAL '13 hours' WHERE token_hash = $1`, [createHash("sha256").update(owner.token).digest("hex")]);
      const stale = await appApi("POST", "/account/admin-handoff", { token: owner.token, body: {} });
      assert.deepEqual([stale.status, stale.json.error], [403, "step_up"]);
      assert.equal((await appApi("GET", "/auth/session", { token: owner.token })).status, 200, "still signed in");

      const refused = await appApi("POST", "/account/admin-handoff", { token: member.token, body: {} });
      assert.deepEqual([refused.status, refused.json.error], [403, "forbidden"]);
      assert.equal((await appApi("POST", "/account/admin-handoff", { body: {} })).status, 401);
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });

  test("API14 · deleting the account: typed DELETE, the club keeps its only owner, every session ends, the admins hear", async () => {
    const email = `delete.me.${Date.now()}@e2e.test`;
    const id = (await db.query(`INSERT INTO players (email, first_name, last_name, claimed_at) VALUES ($1, 'Dee', 'Leted', NOW()) RETURNING id`, [email])).rows[0].id;
    const one = await signedIn(email);
    const two = await signedIn(email);
    const owner = await signedIn(PEOPLE.owner.email);
    try {
      for (const bad of [{}, { confirm: "delete" }, { confirm: "yes" }]) {
        const r = await appApi("POST", "/account/delete", { token: one.token, body: bad });
        assert.deepEqual([r.status, r.json.error], [400, "confirm"], JSON.stringify(bad));
      }
      const last = await appApi("POST", "/account/delete", { token: owner.token, body: { confirm: "DELETE" } });
      assert.deepEqual([last.status, last.json.error], [409, "last_owner"]);
      assert.equal((await appApi("GET", "/auth/session", { token: owner.token })).status, 200, "the owner is untouched");

      await clearOutbox();
      const done = await appApi("POST", "/account/delete", { token: one.token, body: { confirm: "DELETE" } });
      assert.deepEqual([done.status, done.json], [200, { ok: true }]);
      for (const t of [one.token, two.token]) assert.equal((await appApi("GET", "/auth/session", { token: t })).status, 401, "every session ended");
      const row = (await db.query(`SELECT deleted_at, email, first_name FROM players WHERE id = $1`, [id])).rows[0];
      assert.ok(row.deleted_at, "the account is marked deleted");
      assert.deepEqual([row.email, row.first_name], [`deleted-${id}@deleted.invalid`, ""], "and its details cleared");
      const mail = (await (await fetch(`${base()}/api/dev/outbox`)).json()).mail;
      assert.ok(mail.some((m) => m.subject === `Account deleted: ${email}`), "the admins are told");
    } finally {
      await one.context.close();
      await two.context.close();
      await owner.context.close();
    }
  });

  test("API15 · connected apps: a key shown once that works on the older API until disconnected; webhooks public https only; nobody else's", async () => {
    const pete = await signedIn(PEOPLE.player.email);
    const mia = await signedIn(PEOPLE.member.email);
    const call = (method, path, body, token = pete.token) => appApi(method, path, { token, body });
    try {
      const empty = (await call("GET", "/account/integrations")).json;
      assert.deepEqual(Object.keys(empty).sort(), ["tokens", "webhooks"]);
      const before = empty.tokens.length;

      assert.equal((await call("POST", "/account/integrations/tokens", { name: "Tracker", scopes: ["read:everything"] })).status, 400);
      assert.equal((await call("POST", "/account/integrations/tokens", { name: "Tracker", scopes: [] })).status, 400);
      const made = await call("POST", "/account/integrations/tokens", { name: "Tracker", scopes: ["read:stats"] });
      assert.equal(made.status, 200);
      assert.match(made.json.token, /^tw_/);
      assert.equal(made.json.record.prefix, made.json.token.slice(0, 9));
      const listed = (await call("GET", "/account/integrations")).json.tokens;
      assert.equal(listed.length, before + 1);
      assert.ok(!JSON.stringify(listed).includes(made.json.token), "the key itself is never listed");

      // The key works on the older API, as one made on the website does.
      const older = await fetch(`${base()}/api/v1/me`, { headers: { Authorization: `Bearer ${made.json.token}` } });
      assert.equal(older.status, 200);
      // Somebody else can't disconnect it.
      await call("DELETE", `/account/integrations/tokens/${made.json.record.id}`, undefined, mia.token);
      assert.equal((await fetch(`${base()}/api/v1/me`, { headers: { Authorization: `Bearer ${made.json.token}` } })).status, 200);
      assert.deepEqual((await call("DELETE", `/account/integrations/tokens/${made.json.record.id}`)).json, { ok: true });
      assert.equal((await fetch(`${base()}/api/v1/me`, { headers: { Authorization: `Bearer ${made.json.token}` } })).status, 401);
      assert.equal((await call("GET", "/account/integrations")).json.tokens.length, before);
      assert.equal((await call("DELETE", "/account/integrations/tokens/abc")).status, 404);

      for (const url of ["http://example.com/hook", "https://localhost/hook", "https://10.0.0.1/hook", "not a url"]) {
        const r = await call("POST", "/account/integrations/webhooks", { url });
        assert.deepEqual([r.status, r.json.error], [400, "invalid_url"], url);
      }
      const hook = await call("POST", "/account/integrations/webhooks", { url: "https://hooks.example.com/tw" });
      assert.equal(hook.status, 200);
      assert.ok(hook.json.secret.length >= 16);
      assert.deepEqual(hook.json.endpoint.events, ["attendance.recorded", "round_robin.result", "membership.changed", "photo.approved"]);
      assert.ok(!JSON.stringify((await call("GET", "/account/integrations")).json).includes(hook.json.secret), "the secret is never listed");
      await call("DELETE", `/account/integrations/webhooks/${hook.json.endpoint.id}`);
      assert.equal((await call("GET", "/account/integrations")).json.webhooks.some((w) => w.id === hook.json.endpoint.id), false);
    } finally {
      await pete.context.close();
      await mia.context.close();
    }
  });

  test("API16 · the Arena: the same board as the website's, pairing by code, a challenge posted and taken down, refusals as codes, off with its module", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const pete = await signedIn(PEOPLE.player.email);
    const act = (who, body) => appApi("POST", `/clubs/${CLUB}/arena`, { token: who.token, body });
    const board = (who) => appApi("GET", `/clubs/${CLUB}/arena`, { token: who.token });
    try {
      // The same snapshot the website's Arena polls, for the same person.
      const app = await board(mia);
      assert.equal(app.status, 200);
      const web = await (await fetch(`${base()}/api/arena`, { headers: { Cookie: `tw_player=${mia.token}` } })).json();
      assert.deepEqual(Object.keys(app.json).sort(), Object.keys(web).sort());
      assert.equal(app.json.me.id, web.me.id);
      assert.deepEqual(app.json.open.map((c) => c.id), web.open.map((c) => c.id));

      // Pair by code: Mia shows a code, Pete enters it, Mia accepts.
      const shown = await act(mia, { action: "pair_code" });
      assert.equal(shown.status, 200);
      assert.match(shown.json.code.code, /^[A-Z0-9-]{5,7}$/i);
      const wrong = await act(pete, { action: "pair_enter", code: "ZZZZZ" });
      assert.deepEqual([wrong.status, wrong.json.error], [409, "bad_code"]);
      assert.equal((await act(pete, { action: "pair_enter", code: shown.json.code.code })).status, 200);
      assert.equal((await board(mia)).json.me.incomingRequest?.id, (await board(pete)).json.me.id);
      const paired = await act(mia, { action: "pair_respond", accept: true });
      assert.equal(paired.status, 200);
      assert.ok(paired.json.state.me.pair, "now a pair");

      // A challenge up for two days, then taken down.
      const posted = await act(mia, { action: "post", days: 2, note: "Anyone for Friday?" });
      assert.equal(posted.status, 200);
      const mine = posted.json.state.mine.find((c) => c.status === "open");
      assert.equal(mine.note, "Anyone for Friday?");
      assert.equal((await act(pete, { action: "accept", id: mine.id })).status, 409, "a pair can't take its own challenge");
      assert.equal((await act(mia, { action: "cancel", id: mine.id })).status, 200);
      assert.ok(!(await board(mia)).json.mine.some((c) => c.id === mine.id && c.status === "open"));

      for (const bad of [{ action: "fly" }, { action: "post", days: 9 }, { action: "score", id: 1, posting: 31, accepting: 0 }]) {
        assert.equal((await act(mia, bad)).status, 400, JSON.stringify(bad));
      }

      await db.query(`UPDATE tenant_modules SET enabled = FALSE WHERE tenant_id = 1 AND module_id = 'arena'`);
      try {
        const off = await board(mia);
        assert.deepEqual([off.status, off.json.error], [404, "module_off"]);
      } finally {
        await db.query(`UPDATE tenant_modules SET enabled = TRUE WHERE tenant_id = 1 AND module_id = 'arena'`);
      }
    } finally {
      await act(mia, { action: "pair_leave" }).catch(() => {});
      await mia.context.close();
      await pete.context.close();
    }
  });

  test("API17 · the Leaderboard: the board by source and period, steps back in time, someone who hides is left out (but sees their own rank), player cards", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const hana = await signedIn(PEOPLE.hidden.email);
    const get = (who, q = "") => appApi("GET", `/clubs/${CLUB}/leaderboard${q}`, { token: who.token });
    try {
      const all = await get(mia);
      assert.equal(all.status, 200);
      assert.deepEqual([all.json.source, all.json.period, all.json.isCurrent, all.json.prevKey, all.json.nextKey], ["all", "lifetime", true, null, null]);
      const hanaId = (await db.query(`SELECT id FROM players WHERE email = $1`, [PEOPLE.hidden.email])).rows[0].id;
      assert.ok(!all.json.rows.some((r) => r.playerId === hanaId), "someone who hides isn't on the board");
      for (let i = 1; i < all.json.rows.length; i++) assert.ok(all.json.rows[i - 1].value >= all.json.rows[i].value, "highest first");
      assert.equal(all.json.me.visible, true);

      const month = await get(mia, "?period=month&source=play");
      assert.deepEqual([month.json.period, month.json.source, month.json.isCurrent, month.json.nextKey], ["month", "play", true, null]);
      assert.match(month.json.prevKey, /^\d{4}-\d{2}$/);
      const before = await get(mia, `?period=month&source=play&key=${month.json.prevKey}`);
      assert.deepEqual([before.json.range.key, before.json.isCurrent], [month.json.prevKey, false]);
      assert.ok(before.json.nextKey, "a past month can step forward");

      // Hana hides: she's not on it, but sees her own rank when she has one.
      const hers = await get(hana);
      assert.equal(hers.json.me.visible, false);
      assert.ok(!hers.json.rows.some((r) => r.playerId === hanaId));

      for (const q of ["?source=bogus", "?period=week", `?key=${"x".repeat(21)}`]) assert.equal((await get(mia, q)).status, 400, q);

      // Cards: anyone on the board; someone hidden only to themselves.
      const someone = all.json.rows.find((r) => r.playerId !== all.json.me.id);
      if (someone) {
        const card = await appApi("GET", `/clubs/${CLUB}/players/${someone.playerId}`, { token: mia.token });
        assert.equal(card.status, 200);
        assert.deepEqual(Object.keys(card.json.card).sort(), ["avatarUrl", "form", "id", "initials", "isMe", "name", "openChallengeId", "partner", "rankIndex", "seat", "tarnishing", "wp90", "wpTotal"]);
      }
      assert.equal((await appApi("GET", `/clubs/${CLUB}/players/${hanaId}`, { token: mia.token })).status, 404);
      const own = await appApi("GET", `/clubs/${CLUB}/players/${hanaId}`, { token: hana.token });
      assert.deepEqual([own.status, own.json.card?.isMe], [200, true]);
      assert.equal((await appApi("GET", `/clubs/${CLUB}/players/0`, { token: mia.token })).status, 404);
    } finally {
      await mia.context.close();
      await hana.context.close();
    }
  });

  test("API18 · the Player tab's stats: play days by period from the person's attendance, streaks, board places, the club's days", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    try {
      const r = await appApi("GET", `/clubs/${CLUB}/me/stats`, { token: mia.token });
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.json).sort(), ["attended", "attendedDates", "clubDates", "ranks", "rr", "rrHistory", "streak"]);
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM attendance WHERE email = $1 AND verified AND NOT removed`, [PEOPLE.member.email]);
      assert.equal(r.json.attended.lifetime, rows[0].n, "all-time play days are the person's own attendance");
      assert.equal(r.json.attendedDates.length, rows[0].n);
      assert.ok(r.json.attended.month <= r.json.attended.quarter && r.json.attended.quarter <= r.json.attended.lifetime);
      for (let i = 1; i < r.json.attendedDates.length; i++) assert.ok(r.json.attendedDates[i - 1] >= r.json.attendedDates[i], "newest first");
      assert.equal((await appApi("GET", `/clubs/${CLUB}/me/stats`)).status, 401);
    } finally {
      await mia.context.close();
    }
  });

  test("API19 · the shop: products and orders, a cash reservation held and cancelled, cash only when the club checks it, card without a provider leaves nothing held, sold out, other people's orders", async () => {
    const shop = await seedShop(db);
    const pete = await signedIn(PEOPLE.player.email);
    const mia = await signedIn(PEOPLE.member.email);
    const call = (method, path, body, who = pete) => appApi(method, `/clubs/${CLUB}${path}`, { token: who.token, body });
    const stock = async () => (await db.query(`SELECT reserved, sold FROM shop_variants WHERE id = $1`, [shop.men])).rows[0];
    try {
      const list = await call("GET", "/shop");
      assert.equal(list.status, 200);
      const tee = list.json.products.find((p) => p.id === shop.product);
      assert.deepEqual([tee.nameEn, tee.priceCents, tee.hasFit, tee.available], ["E2E Tee", 4500, true, 2]);
      assert.deepEqual(tee.variants.map((v) => [v.fit, v.size, v.available]).sort(), [["men", "M", 2], ["women", "S", 0]]);
      assert.equal(list.json.cash, true);

      const cash = await call("POST", "/shop/orders", { variantId: shop.men, method: "cash" });
      assert.equal(cash.status, 200);
      assert.deepEqual([cash.json.order.status, cash.json.order.method, cash.json.order.totalCents, cash.json.clientSecret], ["reserved_cash", "cash", 4500, null]);
      assert.ok(cash.json.order.holdExpiresAt);
      assert.equal(JSON.stringify(cash.json).includes("@e2e.test"), false, "no email in the answer");
      assert.equal((await stock()).reserved, 1);
      assert.ok((await call("GET", "/shop")).json.orders.some((o) => o.id === cash.json.order.id));
      assert.equal((await call("POST", `/shop/orders/${cash.json.order.id}/cancel`, {}, mia)).status, 404, "not hers");
      assert.equal((await call("POST", `/shop/orders/${cash.json.order.id}/confirm`, {})).status, 404, "a cash order has no card payment");
      assert.deepEqual((await call("POST", `/shop/orders/${cash.json.order.id}/cancel`, {})).json, { ok: true });
      assert.equal((await stock()).reserved, 0, "back on the shelf");

      const soldOut = await call("POST", "/shop/orders", { variantId: shop.women, method: "cash" });
      assert.deepEqual([soldOut.status, soldOut.json.error], [409, "sold_out"]);

      // Card: no card provider here, so it fails, and nothing stays held.
      const card = await call("POST", "/shop/orders", { variantId: shop.men, method: "card" });
      if (card.status === 200) {
        assert.ok(card.json.clientSecret);
        await call("POST", `/shop/orders/${card.json.order.id}/cancel`, {});
      } else assert.equal(card.status, 500);
      assert.equal((await stock()).reserved, 0);

      await shop.set("payments-to-check", false);
      const noCash = await call("POST", "/shop/orders", { variantId: shop.men, method: "cash" });
      assert.deepEqual([noCash.status, noCash.json.error], [409, "cash_unavailable"]);
      assert.equal((await call("GET", "/shop")).json.cash, false);

      await shop.set("shop", false);
      assert.deepEqual([(await call("GET", "/shop")).status, (await call("GET", "/shop")).json.error], [404, "module_off"]);
    } finally {
      await shop.undo();
      await pete.context.close();
      await mia.context.close();
    }
  });

  test("API20 · membership: a member's membership with prices and days, refusals as codes, a paused day can't be joined, casual booking checks the day, off with its module", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const pete = await signedIn(PEOPLE.player.email);
    const call = (method, path, body, who = mia) => appApi(method, `/clubs/${CLUB}${path}`, { token: who.token, body });
    try {
      const state = await call("GET", "/membership");
      assert.equal(state.status, 200);
      assert.deepEqual(Object.keys(state.json).sort(), ["days", "membership", "monthRank", "pausedDays", "prices", "streak"]);
      const m = state.json.membership;
      assert.ok(m, "Mia is a member");
      assert.deepEqual(Object.keys(m).sort(), ["cancelAtPeriodEnd", "continuation", "day", "daysLeft", "manageable", "method", "periodEnd", "periodStart", "plan", "recurring", "status"]);
      assert.ok(state.json.prices.monthly > 0 && state.json.prices.quarterly > state.json.prices.monthly);
      const me = (await call("GET", "/me")).json;
      assert.deepEqual([m.plan, m.day, m.daysLeft], [me.membership.plan, me.membership.day, me.membership.daysLeft], "the same membership Me shows");

      const peteState = (await call("GET", "/membership", undefined, pete)).json;
      assert.equal(peteState.membership, null);
      assert.deepEqual((await call("POST", "/membership", { action: "resume" }, pete)).json, { error: "no_membership" });
      for (const bad of [{ action: "fly" }, { action: "cancel" }, { action: "cancel", reason: "" }, { action: "change", plan: "yearly", day: "friday" }]) {
        assert.equal((await call("POST", "/membership", bad)).status, 400, JSON.stringify(bad));
      }

      // A paused day can't be joined (before anything is reserved or charged).
      const pausedBefore = (await db.query(`SELECT paused FROM day_signup_settings WHERE tenant_id = 1 AND day = 'wednesday'`)).rows[0]?.paused;
      await db.query(`INSERT INTO day_signup_settings (tenant_id, day, paused, updated_at) VALUES (1, 'wednesday', TRUE, NOW()) ON CONFLICT (tenant_id, day) DO UPDATE SET paused = TRUE`);
      try {
        const paused = await call("POST", "/membership/join", { plan: "monthly", day: "wednesday", recurring: true }, pete);
        assert.deepEqual([paused.status, paused.json.error], [409, "day_paused"]);
        assert.ok((await call("GET", "/membership", undefined, pete)).json.pausedDays.includes("wednesday"));
      } finally {
        if (pausedBefore === undefined) await db.query(`DELETE FROM day_signup_settings WHERE tenant_id = 1 AND day = 'wednesday'`);
        else await db.query(`UPDATE day_signup_settings SET paused = $1 WHERE tenant_id = 1 AND day = 'wednesday'`, [pausedBefore]);
      }
      assert.equal((await call("POST", "/membership/join", { plan: "yearly", day: "friday", recurring: true }, pete)).status, 400);

      // Casual booking: a day that isn't open for booking is refused as such.
      const far = await call("POST", "/me/book", { date: "2099-01-02" }, pete);
      assert.deepEqual([far.status, far.json.error], [409, "not_bookable"]);
      assert.equal((await call("POST", "/me/book", { date: "2026-02-30" }, pete)).status, 400);

      await db.query(`UPDATE tenant_modules SET enabled = FALSE WHERE tenant_id = 1 AND module_id = 'memberships'`);
      try {
        assert.deepEqual([(await call("GET", "/membership")).status, (await call("GET", "/membership")).json.error], [404, "module_off"]);
      } finally {
        await db.query(`UPDATE tenant_modules SET enabled = TRUE WHERE tenant_id = 1 AND module_id = 'memberships'`);
      }
    } finally {
      await mia.context.close();
      await pete.context.close();
    }
  });

  test("API21 · Vision: the free trial and prices, a challenge to track, the players (no emails), the labelling set, off with its module", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const call = (method, path, body) => appApi(method, `/clubs/${CLUB}${path}`, { token: mia.token, body });
    const miaId = (await db.query(`SELECT id FROM players WHERE email = $1`, [PEOPLE.member.email])).rows[0].id;
    try {
      const status = await call("GET", "/vision?kind=live");
      assert.equal(status.status, 200);
      assert.equal(status.json.trial, Date.now() < Date.parse(status.json.trialEnds));
      assert.ok(status.json.prices.live > status.json.prices.upload && status.json.prices.upload > 0);
      assert.equal((await call("GET", "/vision?kind=forever")).status, 400);

      const missing = await call("GET", "/vision/challenges/999999");
      assert.deepEqual([missing.status, missing.json.error], [404, "not_found"]);

      const players = (await call("GET", "/vision/players")).json.players;
      assert.ok(players.some((p) => p.id === miaId && p.me === true));
      assert.equal(JSON.stringify(players).includes("@"), false, "no emails");

      const saved = await call("POST", "/vision/labels", { videoName: "match.mp4", duration: 120, hits: [{ t: 1.5, player: 0, rally: 0 }, { t: 2.25, player: 3, rally: 0 }] });
      assert.equal(saved.status, 200);
      const row = (await db.query(`SELECT player_id, video_name, hits FROM wv_labels WHERE id = $1`, [saved.json.id])).rows[0];
      assert.deepEqual([row.player_id, row.video_name, row.hits.length], [miaId, "match.mp4", 2]);
      await db.query(`DELETE FROM wv_labels WHERE id = $1`, [saved.json.id]);
      assert.equal((await call("POST", "/vision/labels", { videoName: "x", duration: 1, hits: [{ t: 1, player: 4, rally: 0 }] })).status, 400);

      await db.query(`UPDATE tenant_modules SET enabled = FALSE WHERE tenant_id = 1 AND module_id = 'vision'`);
      try {
        assert.deepEqual([(await call("GET", "/vision")).status, (await call("GET", "/vision")).json.error], [404, "module_off"]);
      } finally {
        await db.query(`UPDATE tenant_modules SET enabled = TRUE WHERE tenant_id = 1 AND module_id = 'vision'`);
      }
    } finally {
      await mia.context.close();
    }
  });

  test("API22 · Vision tracker calls answer as the website's: passes in the trial, stats and heartbeats, the shared model, stats by email", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const app = (method, path, body) => appApi(method, `/clubs/${CLUB}/vision${path}`, { token: mia.token, body });
    const web = async (method, path, body) => {
      const r = await fetch(`${base()}${path}`, {
        method,
        headers: { Cookie: `tw_player=${mia.token}`, Origin: base(), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    };
    const same = async (what, a, w, pick = (j) => j.error ?? null) => {
      const [x, y] = [await a, await w];
      assert.deepEqual([x.status, pick(x.json)], [y.status, pick(y.json)], what);
      return x;
    };
    try {
      const trial = (await app("GET", "/pass?kind=live")).json.trial === true;
      if (trial) {
        await same("pass in the trial", app("GET", "/pass?kind=upload"), web("GET", "/api/wolf-vision/pass?kind=upload"), (j) => [j.trial, j.pass]);
        await same("no buying in the trial", app("POST", "/pass", { kind: "live" }), web("POST", "/api/wolf-vision/pass", { kind: "live" }));
        await same("starting a session in the trial", app("PATCH", "/pass", { passId: 1 }), web("PATCH", "/api/wolf-vision/pass", { passId: 1 }), (j) => j.trial);
      } else {
        const bought = await app("POST", "/pass", { kind: "upload" });
        assert.deepEqual([bought.status, bought.json.testMode, bought.json.pass.status], [200, true, "paid"]);
        assert.equal((await app("PATCH", "/pass", { passId: bought.json.pass.id })).json.pass.status, "used");
        assert.deepEqual([(await app("PATCH", "/pass", { passId: 999999 })).status], [402]);
      }
      assert.equal((await app("GET", "/pass?kind=forever")).status, 400);

      const stats = { challengeId: 999999, mode: "live", duration: 60, rallies: 3, longestRally: 5, avgRallyShots: 3, fastestShotKmh: null, players: [1, 2, 3, 4].map((id) => ({ playerId: id, hits: 1, distance: 2, topSpeed: 3 })) };
      await same("stats for a missing game", app("POST", "/stats", stats), web("POST", "/api/arena/match-stats", stats));
      await same("stats with three players", app("POST", "/stats", { ...stats, players: stats.players.slice(1) }), web("POST", "/api/arena/match-stats", { ...stats, players: stats.players.slice(1) }), (j) => j.error !== undefined);
      const beat = { challengeId: 999999, kind: "start", rallies: 0, hits: 0, quality: 0.5 };
      await same("a heartbeat for a missing game", app("PUT", "/stats", beat), web("PUT", "/api/arena/match-stats", beat));

      const model = await same("the shared model", app("GET", "/model"), web("GET", "/api/wolf-vision/model"), (j) => j.model);
      assert.equal(model.json.model, null);
      const weights = { v: 1, w1: [0.1], b1: Array(16).fill(0), w2: Array(16).fill(0), b2: 0, n: 0 };
      const update = { kind: "checker", weights, trained: 10, meta: { mode: "live", quality: 0.5, pos: 1, neg: 1 } };
      await same("weights of the wrong size", app("POST", "/model", update), web("POST", "/api/wolf-vision/model", update), (j) => j.error !== undefined);

      const players = ["Ann", "Bea", "Cat", "Dee"].map((name, i) => ({ name, team: i < 2 ? 0 : 1, hits: i, distance: 10, topSpeed: 4 }));
      const session = { teams: ["Ann & Bea", "Cat & Dee"], duration: 300, rallies: 9, longestRally: 7, avgRallyShots: 4, fastestShotKmh: 120, players };
      await same("nobody to email", app("POST", "/share", session), web("POST", "/api/wolf-vision/share", session), (j) => [j.ok, j.sent]);
      const many = { ...session, players: players.map((p, i) => ({ ...p, email: `guest${i}@e2e.test` })) };
      await same("at most three people", app("POST", "/share", many), web("POST", "/api/wolf-vision/share", many));
      const one = { ...session, players: players.map((p, i) => (i === 3 ? { ...p, email: "dee.guest@e2e.test" } : p)) };
      const sent = await app("POST", "/share", one);
      assert.deepEqual([sent.status, sent.json.ok, sent.json.sent, sent.json.failed], [200, true, ["dee.guest@e2e.test"], []]);
    } finally {
      await mia.context.close();
    }
  });

  test("API23 · My photos: your own photos only, sharing not set up without a photo store, only files in your own folder, delete only yours, off with the Gallery", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const call = (method, path, body) => appApi(method, `/clubs/${CLUB}/me/photos${path}`, { token: mia.token, body });
    const ids = Object.fromEntries((await db.query(`SELECT email, id FROM players WHERE email = ANY($1)`, [[PEOPLE.member.email, PEOPLE.player.email]])).rows.map((r) => [r.email, r.id]));
    const insert = async (playerId, status) =>
      (await db.query(
        `INSERT INTO player_photos (player_id, original_url, display_url, thumb_url, width, height, bytes, caption, consent_at, status)
         VALUES ($1, $2, $2, $2, 10, 10, 100, 'net play', NOW(), $3) RETURNING id`,
        [playerId, `https://store.public.blob.vercel-storage.com/photos/${playerId}/x.jpg`, status],
      )).rows[0].id;
    const mine = await insert(ids[PEOPLE.member.email], "approved");
    const theirs = await insert(ids[PEOPLE.player.email], "approved");
    try {
      const list = await call("GET", "");
      assert.equal(list.status, 200);
      assert.deepEqual([list.json.uploadMode, list.json.perDay], [null, 20]);
      assert.deepEqual(list.json.photos.map((p) => [p.id, p.status, p.caption]), [[mine, "approved", "net play"]]);
      assert.equal(JSON.stringify(list.json).includes("original"), false, "the original's address isn't sent");

      const upload = await call("POST", "/upload", { type: "blob.generate-client-token", payload: { pathname: `photos/${ids[PEOPLE.member.email]}/a.jpg`, callbackUrl: "", clientPayload: null, multipart: false } });
      assert.deepEqual([upload.status, upload.json.error], [503, "not_configured"]);
      const own = `https://store.public.blob.vercel-storage.com/photos/${ids[PEOPLE.member.email]}/b.jpg`;
      const foreign = `https://store.public.blob.vercel-storage.com/photos/${ids[PEOPLE.player.email]}/b.jpg`;
      const add = (url) => call("POST", "", { originalUrl: url, displayUrl: url, thumbUrl: url, width: 10, height: 10, bytes: 100, caption: null, consent: true });
      assert.deepEqual([(await add(foreign)).status, (await add(foreign)).json.error], [400, "invalid"]);
      assert.equal((await call("POST", "", { originalUrl: own, displayUrl: own, thumbUrl: own, width: 10, height: 10, bytes: 100, consent: false })).status, 400);

      assert.deepEqual([(await call("DELETE", `/${theirs}`)).status], [404]);
      assert.equal((await call("DELETE", `/${mine}`)).status, 200);
      assert.equal((await db.query(`SELECT deleted_at IS NOT NULL AS gone FROM player_photos WHERE id = $1`, [mine])).rows[0].gone, true);
      assert.equal((await db.query(`SELECT deleted_at IS NULL AS kept FROM player_photos WHERE id = $1`, [theirs])).rows[0].kept, true);

      await db.query(`UPDATE tenant_modules SET enabled = FALSE WHERE tenant_id = 1 AND module_id = 'gallery'`);
      try {
        assert.deepEqual([(await call("GET", "")).status, (await call("GET", "")).json.error], [404, "module_off"]);
      } finally {
        await db.query(`UPDATE tenant_modules SET enabled = TRUE WHERE tenant_id = 1 AND module_id = 'gallery'`);
      }
    } finally {
      await db.query(`DELETE FROM player_photos WHERE id = ANY($1)`, [[mine, theirs]]);
      await mia.context.close();
    }
  });

  test("API7 · the older access-key API and its shapes are untouched by the app API", async () => {
    const lb = await fetch(`${base()}/api/v1/leaderboard`);
    assert.equal(lb.status, 200);
    assert.equal(lb.headers.get("access-control-allow-origin"), "*");
    const me = await fetch(`${base()}/api/v1/me`);
    assert.equal(me.status, 401);
    assert.equal((await me.json()).error, "unauthorized");
    // A session token is not an access key.
    const s = await signedIn(PEOPLE.member.email);
    assert.equal((await fetch(`${base()}/api/v1/me`, { headers: { Authorization: `Bearer ${s.token}` } })).status, 401);
    await s.context.close();
  });

  test("API · this group's endpoint lists match the contract", async () => {
    const { ENDPOINTS } = await import("../../../../packages/api/src/contract.ts");
    const all = Object.values(ENDPOINTS);
    assert.deepEqual(all.filter((e) => e.auth === "session").map((e) => `${e.method} ${e.path}`).sort(), SESSION_ENDPOINTS.map(([m, p]) => `${m} ${p}`).sort(), "add the new signed-in endpoint to SESSION_ENDPOINTS (API4)");
    assert.deepEqual(all.filter((e) => e.auth === "public" && e.method === "POST").map((e) => e.path).sort(), [...POST_ENDPOINTS].sort(), "add the new public POST endpoint to POST_ENDPOINTS (API5)");
  });
});

// ---------------------------------------------------------------------------
// S · modules (build plan §6.2.3; test plan S2)
// ---------------------------------------------------------------------------

describe("S · modules", () => {
  test("S2 · an owner switches a module off: its pages and API are gone, its data is kept; back on, everything returns; an admin can't switch", async () => {
    const owner = await signedIn(PEOPLE.owner.email, DESKTOP);
    const page = await owner.context.newPage();
    const row = () => page.locator("li", { has: page.locator("input[name=moduleId][value=gallery]") });
    const status = async (path) => (await fetch(`${base()}${path}`, { redirect: "manual" })).status;
    const photosBefore = (await db.query(`SELECT count(*)::int AS n FROM player_photos`)).rows[0].n;
    try {
      assert.equal(await status("/gallery"), 200);
      assert.equal((await page.goto("/admin/settings/modules")).status(), 200);
      await row().getByRole("button", { name: "Switch off" }).click();
      await page.getByText(/is now off\. Its data is kept\./).waitFor();
      // Off: the page and the module's API answer like something that doesn't exist.
      assert.equal(await status("/gallery"), 404);
      assert.equal(await status("/api/profile/photos"), 404);
      assert.equal((await page.goto("/admin/photos")).status(), 404);
      // Its section of the site and the link to it are gone too.
      const homeOff = await (await fetch(`${base()}/`)).text();
      assert.ok(!homeOff.includes('id="gallery"'), "the gallery section is still on the home page");
      assert.ok(!homeOff.includes('href="/#gallery"'), "the navigation still links to the gallery");
      assert.ok(homeOff.includes('id="schedule"'), "the rest of the home page is there");
      // The rest of the club carries on.
      assert.equal(await status("/"), 200);
      assert.equal(await status("/casual-play"), 200);
      // The data is kept, the switch is on record, and the admin menu no longer offers the page.
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM player_photos`)).rows[0].n, photosBefore);
      assert.equal((await db.query(`SELECT enabled FROM tenant_modules WHERE module_id = 'gallery'`)).rows[0].enabled, false);
      await page.goto("/admin");
      assert.equal(await page.locator('a[href="/admin/photos"]').count(), 0);
      // An admin who isn't an owner sees the list and has no switch.
      const admin = await signedIn(PEOPLE.admin.email, DESKTOP);
      const adminPage = await admin.context.newPage();
      assert.equal((await adminPage.goto("/admin/settings/modules")).status(), 200);
      await adminPage.getByText("Only owners (and platform admins) can switch modules.").waitFor();
      assert.equal(await adminPage.getByRole("button", { name: /Switch (on|off)/ }).count(), 0);
      await admin.context.close();
      // Back on: everything returns.
      await page.goto("/admin/settings/modules");
      await row().getByRole("button", { name: "Switch on" }).click();
      await page.getByText(/is now on\./).waitFor();
      assert.equal(await status("/gallery"), 200);
      assert.equal((await page.goto("/admin/photos")).status(), 200);
      const homeOn = await (await fetch(`${base()}/`)).text();
      assert.ok(homeOn.includes('id="gallery"') && homeOn.includes('href="/#gallery"'), "the gallery section is back");
    } finally {
      // Whatever happened above, leave the module on for the journeys that follow.
      await db.query(`UPDATE tenant_modules SET enabled = TRUE WHERE module_id = 'gallery'`);
      await owner.context.close();
    }
  });

  // The same promise for EVERY optional module, generated from the registry
  // (packages/modules), the route table (ROUTE_OWNERS) and the API contract,
  // so a new module, page or endpoint is covered the day it is added. The
  // switch itself (the owner's button, the rules) is the test above; here
  // the switches are set in the table, as the club's choice is stored.
  test("S2 · every optional module, generated: switched off, each page, API route, app endpoint, menu entry and config line it owns is gone; back on, each returns", async () => {
    const { MODULES, ROUTE_OWNERS } = await import("../../../../packages/modules/src/index.ts");
    const { ENDPOINTS } = await import("../../../../packages/api/src/contract.ts");
    const optional = MODULES.filter((m) => !m.core);
    assert.ok(optional.length >= 16, `the registry has ${optional.length} optional modules`);
    const owner = await signedIn(PEOPLE.owner.email, DESKTOP);
    const cookie = `tw_player=${owner.token}`;
    const NO_ID = "2147483000"; // a valid id that names nothing

    const original = (await db.query(`SELECT module_id, enabled FROM tenant_modules WHERE tenant_id = 1`)).rows;
    const set = (id, on) => db.query(`INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES (1, $1, $2) ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = $2`, [id, on]);
    /** Everything `id` needs, and everything that needs `id` (a module can't be off under one that needs it). */
    const needs = (id) => (MODULES.find((m) => m.id === id).requires ?? []).flatMap((r) => [...needs(r), r]);
    const neededBy = (id) => MODULES.filter((m) => m.requires?.includes(id)).flatMap((m) => [m.id, ...neededBy(m.id)]);

    /** The paths the proxy guards for the module: [path, status, body]. */
    const routes = async (id) => {
      const out = [];
      for (const [prefix, who] of ROUTE_OWNERS) {
        if (who !== id) continue;
        const r = await fetch(`${base()}${prefix}`, { redirect: "manual", headers: { Cookie: cookie } });
        out.push([prefix, r.status, await r.text()]);
      }
      return out;
    };
    /** The module's endpoints in the players' app API: [id, status, error code]. A body that can't be valid, so nothing is changed when the module is on. */
    const endpoints = async (id) => {
      const out = [];
      for (const [eid, e] of Object.entries(ENDPOINTS)) {
        if (e.module !== id) continue;
        const path = e.path.replace("{club}", "three-wolves").replace(/\{\w+\}/g, NO_ID);
        const r = await appApi(e.method, path, { token: owner.token, ...(e.method === "GET" || !e.body ? {} : { raw: '"not a body"' }) });
        out.push([eid, r.status, r.json?.error ?? null]);
      }
      return out;
    };
    /** The admin's side menu, as served (the Today page's own quick links are lane A's: audit, "Today is filtered by role, not module"). */
    const adminMenu = async () => {
      const html = await (await fetch(`${base()}/admin`, { headers: { Cookie: cookie } })).text();
      const menu = html.match(/<aside id="admin-sidebar"[\s\S]*?<\/aside>/)?.[0];
      assert.ok(menu, "the admin page has its side menu");
      return menu;
    };
    const configModules = async () => (await appApi("GET", "/clubs/three-wolves/config")).json.modules;

    const covered = { routes: 0, endpoints: 0, menu: 0 };
    try {
      for (const m of optional) {
        const id = m.id;
        const nav = (m.admin?.nav ?? []).map((n) => n.href);
        // On (with what it needs).
        for (const dep of [...needs(id), id]) await set(dep, true);
        const routesOn = await routes(id);
        const endpointsOn = await endpoints(id);
        for (const [eid, status, code] of endpointsOn) {
          assert.notEqual(code, "module_off", `${id} on: ${eid}`);
          assert.ok(status < 500, `${id} on: ${eid} answers ${status}`);
        }
        if (routesOn.length) assert.ok(routesOn.some(([, status]) => status !== 404), `${id} on: at least one of its routes is there (${routesOn.map(([p, st]) => `${p} ${st}`).join(", ")})`);
        const menuOn = await adminMenu();
        for (const href of nav) assert.ok(menuOn.includes(`href="${href}"`), `${id} on: the admin menu offers ${href}`);
        assert.ok((await configModules()).includes(id), `${id} on: the club's config lists it`);

        // Off (and what needs it).
        for (const dep of [...neededBy(id), id]) await set(dep, false);
        for (const [prefix, status, body] of await routes(id)) {
          assert.equal(status, 404, `${id} off: ${prefix} is still served`);
          assert.ok(prefix.startsWith("/api/") ? body === '{"error":"not_found"}' : body.includes("This page isn't available."), `${id} off: ${prefix} isn't stopped by the switch (${body.slice(0, 80)})`);
        }
        for (const [eid, status, code] of await endpoints(id)) assert.deepEqual([status, code], [404, "module_off"], `${id} off: ${eid}`);
        const menuOff = await adminMenu();
        for (const href of nav) assert.ok(!menuOff.includes(`href="${href}"`), `${id} off: the admin menu still offers ${href}`);
        assert.ok(!(await configModules()).includes(id), `${id} off: the club's config still lists it`);
        // The rest of the club carries on.
        assert.equal((await fetch(`${base()}/`)).status, 200, `${id} off: the home page`);
        assert.equal((await appApi("GET", "/clubs/three-wolves/me", { token: owner.token })).status, 200, `${id} off: Me`);

        // Back on: everything answers as it did.
        for (const dep of [...needs(id), id]) await set(dep, true);
        assert.deepEqual((await routes(id)).map(([p, st]) => [p, st]), routesOn.map(([p, st]) => [p, st]), `${id} back on: its routes`);
        assert.deepEqual(await endpoints(id), endpointsOn, `${id} back on: its endpoints`);

        covered.routes += routesOn.length;
        covered.endpoints += endpointsOn.length;
        covered.menu += nav.length;
        // As it was, before the next module.
        for (const dep of new Set([...needs(id), ...neededBy(id), id])) {
          const was = original.find((r) => r.module_id === dep);
          if (was) await set(dep, was.enabled);
          else await db.query(`DELETE FROM tenant_modules WHERE tenant_id = 1 AND module_id = $1`, [dep]);
        }
      }
      // Nothing was left out: every guarded route and every endpoint with a module belongs to a module that was switched.
      const ids = new Set(optional.map((m) => m.id));
      const always = new Set(["core", "account", "platform"]);
      for (const [prefix, who] of ROUTE_OWNERS) assert.ok(always.has(who) || ids.has(who), `${prefix} belongs to "${who}", which isn't a module`);
      for (const [eid, e] of Object.entries(ENDPOINTS)) assert.ok(!e.module || ids.has(e.module), `${eid} names the module "${e.module}", which isn't one`);
      assert.equal(covered.routes, ROUTE_OWNERS.filter(([, who]) => !always.has(who)).length);
      assert.equal(covered.endpoints, Object.values(ENDPOINTS).filter((e) => e.module).length);
    } finally {
      // Whatever happened above, leave the switches as they were for the journeys that follow.
      await db.query(`DELETE FROM tenant_modules WHERE tenant_id = 1 AND NOT (module_id = ANY($1))`, [original.map((r) => r.module_id)]);
      for (const r of original) await set(r.module_id, r.enabled);
      await owner.context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Redirects and screenshots
// ---------------------------------------------------------------------------

describe("Old URLs and layouts", () => {
  test("every moved URL redirects permanently", async () => {
    const get = (path, cookie) => fetch(`${base()}${path}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
    const mia = await signedIn(PEOPLE.member.email);
    const cookie = `tw_player=${mia.token}`;
    const cases = [
      ["/profile/account", "/profile", cookie],
      ["/profile/account?thread=3", "/profile?thread=3", cookie],
      ["/profile/membership", "/profile", cookie],
      ["/profile/me", "/profile", cookie],
      ["/leaderboard", "/profile/leaderboard", cookie],
      ["/leaderboard?source=challenges&period=year", "/profile/leaderboard?source=challenges&period=year", cookie],
      ["/leaderboard", "/#leaderboard", null],
    ];
    for (const [from, to, c] of cases) {
      const r = await get(from, c);
      assert.equal(r.status, 308, `${from} is permanent`);
      // Same path and hash, same query parameters (Next.js may order them differently).
      const loc = new URL(r.headers.get("location"), base());
      const want = new URL(to, base());
      const sorted = (u) => [...u.searchParams.entries()].sort().join("&");
      assert.equal(loc.pathname + loc.hash, want.pathname + want.hash, `${from} → ${to}`);
      assert.equal(sorted(loc), sorted(want), `${from} keeps its query`);
    }
    // The manifest opens the Me page.
    const manifest = await (await fetch(`${base()}/manifest.webmanifest`)).json();
    assert.match(manifest.start_url, /^\/profile/);
    await mia.context.close();
  });

  test("message email links open the inbox at that thread", async () => {
    const mia = await signedIn(PEOPLE.member.email, DESKTOP);
    const page = await mia.context.newPage();
    await page.goto(`/profile/account?thread=${env.seeded.threadId}`);
    await page.waitForURL(/\/profile\?thread=/);
    // Opened at that thread: the message body is shown (not just the list preview).
    await page.getByRole("dialog").locator("[class*=body]", { hasText: "See you at Pioneer on Friday!" }).waitFor();
    await mia.context.close();
  });

  test("screenshots: Me, Settings, inbox at five widths (no sideways scroll)", async () => {
    const owner = await signedIn(PEOPLE.owner.email);
    const page = await owner.context.newPage();
    await page.goto("/profile");
    await shot(page, "me-owner");
    await page.goto("/profile/settings");
    await shot(page, "settings");
    const mia = await signedIn(PEOPLE.member.email);
    const mp = await mia.context.newPage();
    await mp.goto("/profile?inbox=1");
    await mp.getByRole("dialog").waitFor();
    await shot(mp, "inbox");
    await owner.context.close();
    await mia.context.close();
  });
});
