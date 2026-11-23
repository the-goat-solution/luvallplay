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
import { mkdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { createRequire } from "node:module";
import { startEnv, PEOPLE } from "../../scripts/e2e/env.mjs";

// Playwright is preinstalled globally (resolved through NODE_PATH, which only require() uses).
const { chromium } = createRequire(import.meta.url)("playwright");

const SHOTS = process.env.E2E_SHOTS ?? "docs/screenshots/phase-1";
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

async function playerId(email) {
  const { rows } = await db.query(`SELECT id FROM players WHERE email = $1`, [email]);
  return rows[0].id;
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
    await page.waitForURL(/\/admin\/play-days/);
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

  test("A · break-glass: /admin/login goes to sign-in; the password form still works and is audited", async () => {
    const context = await browser.newContext({ viewport: DESKTOP, baseURL: base() });
    const page = await context.newPage();
    await page.goto("/admin/login");
    assert.match(page.url(), /\/login\?next=%2Fadmin/);
    await page.goto("/admin/login?breakglass=1");
    await page.getByLabel("Admin password").fill("e2e-break-glass");
    await page.getByRole("button").first().click();
    await page.waitForURL(/\/admin\/play-days/);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'admin.break_glass_login'`);
    assert.ok(rows[0].n >= 1);
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
    await page.waitForURL(/\/admin\/play-days/);
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

  test("G2 · leaderboard in Arena: filters, player card, challenge from card, opt-out respected", async () => {
    const mia = await signedIn(PEOPLE.member.email);
    const page = await mia.context.newPage();
    await page.goto("/profile/arena?tab=leaderboard");
    await page.getByRole("heading", { name: /leaderboard/i }).first().waitFor();
    // Hidden players never appear.
    assert.equal(await page.getByText("Hana").count(), 0, "opted-out player is not listed");
    // Filters keep you in the Arena.
    await page.getByRole("link", { name: /challenges/i }).nth(1).click();
    await page.waitForURL(/tab=leaderboard.*source=challenges|source=challenges.*tab=leaderboard/);
    await page.goto("/profile/arena?tab=leaderboard");
    // Player card from a row.
    await page.locator("li[role=button]", { hasText: "Olivia" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText(/WP all time/).waitFor();
    await dialog.getByText(/Recent form/).waitFor();
    await dialog.getByRole("button", { name: /challenge/i }).click();
    await page.waitForURL(/tab=challenges/);
    await shot(page, "arena-challenges-from-card");
    await page.goto("/profile/arena?tab=leaderboard");
    await shot(page, "arena-leaderboard");
    await page.goto("/profile/arena?tab=ranks");
    await page.getByRole("heading", { name: "The ladder" }).waitFor();
    await shot(page, "arena-ranks");
    // The hidden player sees their own rank only.
    const hana = await signedIn(PEOPLE.hidden.email);
    const hp = await hana.context.newPage();
    await hp.goto("/profile/arena?tab=leaderboard");
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
      ["/leaderboard", "/profile/arena?tab=leaderboard", cookie],
      ["/leaderboard?source=challenges&period=year", "/profile/arena?tab=leaderboard&source=challenges&period=year", cookie],
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
