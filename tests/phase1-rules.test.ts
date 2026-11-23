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
type RoleName = "anonymous" | "player" | "member" | "coach" | "admin" | "owner" | "platform" | "break-glass";

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
  // The ADMIN_PASSWORD cookie, kept two weeks as break-glass.
  "break-glass": { adminPlayDays: "allow", adminMembers: "allow", adminFinancials: "allow", manageAdmins: "allow", platformAdmins: "allow", refundFreeMonth: "allow", cancelMembership: "allow" },
};

const ROLE_ACCESS: Record<Exclude<RoleName, "anonymous" | "break-glass">, Access> = {
  player: { role: null, platformAdmin: false },
  member: { role: null, platformAdmin: false },
  coach: { role: "coach" as ClubRole, platformAdmin: false },
  admin: { role: "admin" as ClubRole, platformAdmin: false },
  owner: { role: "owner" as ClubRole, platformAdmin: false },
  platform: { role: null, platformAdmin: true },
};

function ctxFor(role: RoleName, signedInHoursAgo = 1): AdminContext | null {
  if (role === "anonymous") return null;
  if (role === "break-glass") return { kind: "break-glass" };
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
    if (role === "anonymous" || role === "break-glass") continue;
    for (const [route, expected] of Object.entries(row) as [RouteName, Expect][]) {
      const got = answer(ctxFor(role, 13), route);
      assert.equal(got, expected === "allow" ? "step-up" : expected, `${role} → ${route} with a 13-hour-old sign-in`);
    }
  }
});

test("permission matrix: every admin page in the nav has a column", async () => {
  const { readFileSync } = await import("node:fs");
  const nav = readFileSync(new URL("../components/admin/nav-config.ts", import.meta.url), "utf8");
  const hrefs = [...nav.matchAll(/href: "(\/admin\/[^"]+)"/g)].map((m) => m[1]);
  // Every nav page answers like one of the matrix pages for each role.
  for (const href of hrefs) {
    for (const role of Object.keys(MATRIX) as RoleName[]) {
      const v = decide(ctxFor(role), href, false);
      if (role === "anonymous") assert.equal(v.ok, false);
      if (role === "player" || role === "member") assert.equal(v.ok, false, `${role} can't open ${href}`);
      if (role === "platform" || role === "break-glass") assert.equal(v.ok, true, `${role} opens ${href}`);
    }
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
  assert.equal(resolve("/leaderboard", true), "/profile/arena?tab=leaderboard");
  assert.equal(resolve("/leaderboard?source=challenges&period=year", true), "/profile/arena?tab=leaderboard");
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

async function dictKeys(file: string): Promise<{ en: string[]; vi: string[] }> {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL(`../lib/${file}`, import.meta.url), "utf8");
  // Top-level keys of the EN / VI objects: "  key: ..." at two-space (or four-space for lib/i18n.ts) indent.
  const block = (start: RegExp, end: RegExp) => {
    const from = src.search(start);
    const rest = src.slice(from);
    const to = rest.search(end);
    return rest.slice(0, to);
  };
  const keysOf = (text: string, indent: number) =>
    [...text.matchAll(new RegExp(`^ {${indent}}([a-zA-Z_][a-zA-Z0-9_]*)\\s*:`, "gm"))].map((m) => m[1]).sort();
  if (file === "i18n.ts" || file === "jersey-i18n.ts") {
    return { en: keysOf(block(/^\s{2}en: \{/m, /^\s{2}\},\n\s{2}vi: \{/m), 4), vi: keysOf(block(/^\s{2}vi: \{/m, /^\s{2}\},\n\} as const/m), 4) };
  }
  return { en: keysOf(block(/^const EN = \{/m, /^\} as const;/m), 2), vi: keysOf(block(/^const VI(: Dict)? = \{/m, /^\};/m), 2) };
}

for (const file of ["i18n.ts", "profile-i18n.ts", "arena-i18n.ts", "jersey-i18n.ts"]) {
  test(`i18n parity: ${file} has every key in English and Vietnamese`, async () => {
    const { en, vi } = await dictKeys(file);
    assert.ok(en.length > 10, `${file}: found the English keys`);
    const missingVi = en.filter((k) => !vi.includes(k));
    const missingEn = vi.filter((k) => !en.includes(k));
    assert.deepEqual({ missingVi, missingEn }, { missingVi: [], missingEn: [] });
  });
}

test("i18n: the Phase 1 strings are translated (Vietnamese differs from English)", async () => {
  const { readFileSync } = await import("node:fs");
  // The dictionaries import React context, so read their text rather than load them.
  const valueIn = (file: string, key: string): string[] => {
    const src = readFileSync(new URL(`../lib/${file}`, import.meta.url), "utf8");
    return [...src.matchAll(new RegExp(`^\\s+${key}:\\s*"([^"]*)"`, "gm"))].map((m) => m[1]);
  };
  const check = (file: string, keys: string[]) => {
    for (const k of keys) {
      const [en, vi] = valueIn(file, k);
      assert.ok(en && vi, `${file} ${k}: both languages present`);
      assert.notEqual(en, vi, `${file} ${k}: Vietnamese is not a copy of English`);
    }
  };
  check("profile-i18n.ts", ["tab_me", "me_club_admin", "me_settings", "me_next_up", "settings_title", "login_stepup", "acc_delete_last_owner", "me_pill_none"]);
  check("arena-i18n.ts", ["seg_challenges", "seg_leaderboard", "seg_ranks", "card_challenge", "card_form", "vs_hint"]);
  check("i18n.ts", ["lb_teaser_title", "lb_teaser_cta", "lb_teaser_hidden"]);
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
