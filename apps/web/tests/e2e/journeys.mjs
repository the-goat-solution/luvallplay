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

async function shot(page, name) {
  // Fully loaded (no loading skeleton) and no sheet still animating in.
  await page.waitForLoadState("networkidle");
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
const SESSION_ENDPOINTS = [["GET", "/auth/session"], ["POST", "/auth/logout"], ["GET", "/clubs"]];
const POST_ENDPOINTS = ["/auth/email/start", "/auth/email/verify", "/auth/sms/start", "/auth/sms/verify"];

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
    assert.equal(Object.keys(c.theme.light).length, 14);
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
    for (const [method, path] of SESSION_ENDPOINTS) {
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
