// Phase 1 rules without a database: the permission matrix (test plan §3.6)
// for the routes this phase touches, the redirects for every moved URL
// (test plan §4.5), i18n key parity (en ↔ vi) and the leaderboard teaser's
// first-names-only rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, type AdminContext } from "../lib/admin-access.ts";
import type { Access, ClubRole } from "../lib/admin-roles.ts";
import { REDIRECTS } from "../lib/redirects.ts";
import { firstNameOnly } from "../lib/first-name.ts";

// ---------------------------------------------------------------------------
// Permission matrix. One row per role, one column per route/action, with the
// expected answer. "sign-in" = sent to sign in; "step-up" = asked for a
// fresh code. Phase 3 adds "disabled member" and "other club's admin" once
// clubs exist.
// ---------------------------------------------------------------------------

type Expect = "allow" | "deny" | "sign-in" | "step-up";
type RoleName = "anonymous" | "player" | "member" | "coach" | "admin" | "owner" | "platform";

const ROUTES = {
  adminPlayDays: { path: "/admin/play-days", api: false },
  adminMembers: { path: "/admin/members", api: false },
  adminFinancials: { path: "/admin/financials", api: false },
  manageAdmins: { path: "/admin/people/admins", api: false },
  platformAdmins: { path: "/admin/platform/admins", api: false },
  refundFreeMonth: { path: "/api/admin/free-month", api: true },
  cancelMembership: { path: "/api/admin/cancel-membership", api: true },
} as const;
type RouteName = keyof typeof ROUTES;

export const MATRIX: Record<RoleName, Record<RouteName, Expect>> = {
  anonymous: { adminPlayDays: "sign-in", adminMembers: "sign-in", adminFinancials: "sign-in", manageAdmins: "sign-in", platformAdmins: "sign-in", refundFreeMonth: "sign-in", cancelMembership: "sign-in" },
  player: { adminPlayDays: "deny", adminMembers: "deny", adminFinancials: "deny", manageAdmins: "deny", platformAdmins: "deny", refundFreeMonth: "deny", cancelMembership: "deny" },
  member: { adminPlayDays: "deny", adminMembers: "deny", adminFinancials: "deny", manageAdmins: "deny", platformAdmins: "deny", refundFreeMonth: "deny", cancelMembership: "deny" },
  coach: { adminPlayDays: "allow", adminMembers: "deny", adminFinancials: "deny", manageAdmins: "deny", platformAdmins: "deny", refundFreeMonth: "deny", cancelMembership: "deny" },
  admin: { adminPlayDays: "allow", adminMembers: "allow", adminFinancials: "allow", manageAdmins: "deny", platformAdmins: "deny", refundFreeMonth: "allow", cancelMembership: "allow" },
  owner: { adminPlayDays: "allow", adminMembers: "allow", adminFinancials: "allow", manageAdmins: "allow", platformAdmins: "deny", refundFreeMonth: "allow", cancelMembership: "allow" },
  platform: { adminPlayDays: "allow", adminMembers: "allow", adminFinancials: "allow", manageAdmins: "allow", platformAdmins: "allow", refundFreeMonth: "allow", cancelMembership: "allow" },
};

const ROLE_ACCESS: Record<Exclude<RoleName, "anonymous">, Access> = {
  player: { role: null, platformAdmin: false },
  member: { role: null, platformAdmin: false },
  coach: { role: "coach" as ClubRole, platformAdmin: false },
  admin: { role: "admin" as ClubRole, platformAdmin: false },
  owner: { role: "owner" as ClubRole, platformAdmin: false },
  platform: { role: null, platformAdmin: true },
};

function ctxFor(role: RoleName, signedInHoursAgo = 1): AdminContext | null {
  if (role === "anonymous") return null;
  const signedInAt = new Date(Date.now() - signedInHoursAgo * 3_600_000);
  return {
    kind: "player",
    player: { id: 1, email: "x@example.test", firstName: "X", lastName: "Y" },
    access: ROLE_ACCESS[role],
    signedInAt,
    stepUpFresh: signedInHoursAgo <= 12,
  };
}

function answer(ctx: AdminContext | null, route: RouteName): Expect {
  const v = decide(ctx, ROUTES[route].path, ROUTES[route].api);
  if (v.ok) return "allow";
  if (v.reason === "signed_out") return "sign-in";
  if (v.reason === "step_up") return "step-up";
  return "deny";
}

test("permission matrix: every role × every Phase 1 admin route", () => {
  const failures: string[] = [];
  for (const [role, row] of Object.entries(MATRIX) as [RoleName, Record<RouteName, Expect>][]) {
    for (const [route, expected] of Object.entries(row) as [RouteName, Expect][]) {
      const got = answer(ctxFor(role), route);
      if (got !== expected) failures.push(`${role} → ${route}: expected ${expected}, got ${got}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("permission matrix: step-up — a sign-in older than 12 hours asks for a fresh code, only where access would be allowed", () => {
  for (const [role, row] of Object.entries(MATRIX) as [RoleName, Record<RouteName, Expect>][]) {
    if (role === "anonymous") continue;
    for (const [route, expected] of Object.entries(row) as [RouteName, Expect][]) {
      const got = answer(ctxFor(role, 13), route);
      assert.equal(got, expected === "allow" ? "step-up" : expected, `${role} → ${route} with a 13-hour-old sign-in`);
    }
  }
});

test("permission matrix: every admin page in the nav has a column", async () => {
  // The menu is generated from the module registry (Track A step A1).
  const { NAV_GROUPS } = await import("../components/admin/nav-registry.ts");
  const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter((h) => h !== "/admin");
  assert.ok(hrefs.length >= 15, "the menu has its pages");
  // Every nav page answers like one of the matrix pages for each role.
  for (const href of hrefs) {
    for (const role of Object.keys(MATRIX) as RoleName[]) {
      const v = decide(ctxFor(role), href, false);
      if (role === "anonymous") assert.equal(v.ok, false);
      if (role === "player" || role === "member") assert.equal(v.ok, false, `${role} can't open ${href}`);
      if (role === "platform") assert.equal(v.ok, true, `${role} opens ${href}`);
    }
  }
});

test("break-glass is gone: the old admin_token cookie opens nothing, and the password routes are removed", async () => {
  const { existsSync } = await import("node:fs");
  const { adminContextFromCookies } = await import("../lib/admin-access.ts");
  // A cookie minted by the old password login, alone, is no admin session.
  const ctx = await adminContextFromCookies((name) => (name === "admin_token" ? "9999999999999.deadbeef" : undefined));
  assert.equal(ctx, null);
  for (const route of ["../app/api/admin-login/route.ts", "../app/api/admin-logout/route.ts", "../app/admin/login/page.tsx", "../lib/admin-session.ts"]) {
    assert.equal(existsSync(new URL(route, import.meta.url)), false, route);
  }
});

// ---------------------------------------------------------------------------
// Redirects: every old URL still lands somewhere sensible.
// ---------------------------------------------------------------------------

function resolve(path: string, signedIn: boolean): string | null {
  const [pathname] = path.split("?");
  for (const r of REDIRECTS) {
    if (r.source !== pathname) continue;
    if (r.has && !signedIn) continue;
    if (r.missing && signedIn) continue;
    return r.destination;
  }
  return null;
}

test("redirects: every moved URL is permanent and lands on the new page", () => {
  for (const r of REDIRECTS) assert.equal(r.permanent, true, r.source);
  assert.equal(resolve("/profile/account", true), "/profile");
  assert.equal(resolve("/profile/account?thread=12", true), "/profile", "message-email links (query kept by Next.js)");
  assert.equal(resolve("/profile/membership", true), "/profile");
  assert.equal(resolve("/profile/membership", false), "/profile", "signed out: /profile then asks to sign in");
  assert.equal(resolve("/profile/me", true), "/profile");
  assert.equal(resolve("/leaderboard", true), "/profile/leaderboard");
  assert.equal(resolve("/leaderboard?source=challenges&period=year", true), "/profile/leaderboard");
  assert.equal(resolve("/leaderboard", false), "/#leaderboard");
  assert.equal(resolve("/match-analyzer", false), "/profile/wolf-vision");
});

test("redirects: the manifest opens on the Me page and no shortcut points at a moved URL", async () => {
  const { default: manifest } = await import("../app/manifest.ts");
  const m = manifest();
  assert.match(String(m.start_url), /^\/profile(\?|$)/);
  const moved = new Set(REDIRECTS.map((r) => r.source));
  for (const s of m.shortcuts ?? []) assert.ok(!moved.has(s.url.split("?")[0]), `shortcut ${s.url} is not a moved URL`);
});

test("redirects: no code still links to a moved URL", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) {
        const src = readFileSync(full, "utf8");
        if (/["'`]\/(profile\/account|profile\/membership|leaderboard)(["'`?#/])/.test(src) && !full.endsWith("redirects.ts")) offenders.push(path.relative(root, full));
      }
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(path.join(root, dir));
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// i18n: every English key has a Vietnamese key, and vice versa (test plan §3.2).
// ---------------------------------------------------------------------------

// The dictionaries moved to @luvallplay/i18n in Phase 2 (one namespace per old
// file); load them directly instead of parsing the files' text.
const OLD_FILES = { "i18n.ts": "site", "profile-i18n.ts": "profile", "arena-i18n.ts": "arena", "jersey-i18n.ts": "jersey" } as const;

async function dictFor(file: keyof typeof OLD_FILES): Promise<{ en: Record<string, string>; vi: Record<string, string> }> {
  const { messages } = await import("@luvallplay/i18n");
  return messages[OLD_FILES[file]] as unknown as { en: Record<string, string>; vi: Record<string, string> };
}

for (const file of Object.keys(OLD_FILES) as (keyof typeof OLD_FILES)[]) {
  test(`i18n parity: ${file} (namespace ${OLD_FILES[file]}) has every key in English and Vietnamese`, async () => {
    const dict = await dictFor(file);
    const en = Object.keys(dict.en).sort();
    const vi = Object.keys(dict.vi).sort();
    assert.ok(en.length > 10, `${file}: found the English keys`);
    const missingVi = en.filter((k) => !vi.includes(k));
    const missingEn = vi.filter((k) => !en.includes(k));
    assert.deepEqual({ missingVi, missingEn }, { missingVi: [], missingEn: [] });
  });
}

test("i18n: the Phase 1 strings are translated (Vietnamese differs from English)", async () => {
  const check = async (file: keyof typeof OLD_FILES, keys: string[]) => {
    const dict = await dictFor(file);
    for (const k of keys) {
      const [en, vi] = [dict.en[k], dict.vi[k]];
      assert.ok(en && vi, `${file} ${k}: both languages present`);
      assert.notEqual(en, vi, `${file} ${k}: Vietnamese is not a copy of English`);
    }
  };
  await check("profile-i18n.ts", ["tab_me", "me_club_admin", "me_settings", "me_next_up", "settings_title", "login_stepup", "acc_delete_last_owner", "me_pill_none"]);
  await check("arena-i18n.ts", ["seg_challenges", "seg_leaderboard", "seg_ranks", "card_challenge", "card_form", "vs_hint"]);
  await check("i18n.ts", ["lb_teaser_title", "lb_teaser_cta", "lb_teaser_hidden"]);
});

// ---------------------------------------------------------------------------
// Leaderboard teaser: first names only, never more.
// ---------------------------------------------------------------------------

test("teaser: first names only", () => {
  assert.equal(firstNameOnly("Mai T."), "Mai");
  assert.equal(firstNameOnly("  Nguyen Van An "), "Nguyen");
  assert.equal(firstNameOnly("Kelcee"), "Kelcee");
  assert.equal(firstNameOnly(""), "");
});
