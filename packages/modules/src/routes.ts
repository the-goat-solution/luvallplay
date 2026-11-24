// Which module owns which route (build plan §6.2.3: "Turning a module off
// hides it … its admin areas, app screens, website sections, API routes,
// crons and emails stop").
//
// One table, read by the request proxy, the admin menu and the tests. A
// route belongs to the longest prefix that matches it. Owners are:
//
//   a module id   the route stops when the module is off for the club
//   "core"        always on: what a free, no-money club needs (§6.2.3)
//   "account"     sign-in and the player's own account: always on
//   "platform"    Luvallplay's own (health checks, setup, platform admins)
//
// apps/web/tests/module-routes.test.ts lists every page and API route in the
// app and fails on one that no rule covers, so a new endpoint can't ship
// without an owner.
import type { ModuleId } from "./registry.ts";

export type RouteOwner = ModuleId | "core" | "account" | "platform";

/** Prefix → owner. A prefix matches itself and anything under it ("/api/arena" covers "/api/arena/player/7"). */
export const ROUTE_OWNERS: readonly (readonly [prefix: string, owner: RouteOwner])[] = [
  // ── Pages ───────────────────────────────────────────────────────────────
  ["/", "core"],
  ["/login", "account"],
  ["/profile", "account"],
  ["/profile/arena", "arena"],
  ["/profile/wolf-vision", "vision"],
  ["/challenges", "arena"],
  ["/casual-play", "court-board"],
  ["/mini-game", "round-robin"],
  ["/gallery", "gallery"],
  ["/jersey", "shop"],
  ["/renew-membership", "memberships"],
  ["/cancel-membership", "memberships"],
  // ── Admin ───────────────────────────────────────────────────────────────
  ["/admin", "core"],
  ["/admin/setup", "platform"],
  ["/admin/platform", "platform"],
  ["/admin/challenges", "arena"],
  ["/admin/day-requests", "day-requests"],
  ["/admin/play-days/schedule", "day-requests"],
  ["/admin/device-check", "vision"],
  ["/admin/financials", "finance"],
  ["/admin/financials/bank", "bank-matching"],
  ["/admin/shop", "shop"],
  ["/admin/jersey", "shop"],
  ["/admin/members", "memberships"],
  ["/admin/photos", "gallery"],
  // ── API: account and core ───────────────────────────────────────────────
  ["/api/auth", "account"],
  ["/api/profile", "account"],
  ["/api/admin/handoff", "account"],
  // The players' app API (packages/api). Each endpoint names its own module
  // in the contract; the wrapper (lib/app-api.ts) answers 404 when it is off.
  ["/api/v1/app", "core"],
  ["/api/v1/app/auth", "account"],
  ["/api/sessions", "core"],
  ["/api/spots", "core"],
  ["/api/waitlist", "core"],
  ["/api/cron/headcount-alerts", "core"],
  ["/api/cron/send-roster", "core"],
  // One endpoint for every kind of payment; each handler checks its own module.
  ["/api/stripe-webhook", "core"],
  // ── API: platform ───────────────────────────────────────────────────────
  ["/api/health", "platform"],
  ["/api/dev", "platform"],
  ["/api/revalidate", "platform"],
  // ── API: modules ────────────────────────────────────────────────────────
  ["/api/arena", "arena"],
  ["/api/wolf-vision", "vision"],
  ["/api/casual-play", "court-board"],
  ["/api/create-payment-intent", "casual-play"],
  ["/api/mini-game", "round-robin"],
  ["/api/day-requests", "day-requests"],
  ["/api/cron/sync-calendar", "calendar-sync"],
  ["/api/create-subscription", "memberships"],
  ["/api/renew-membership", "memberships"],
  ["/api/profile/membership", "memberships"],
  ["/api/admin/cancel-membership", "memberships"],
  ["/api/admin/free-month", "memberships"],
  ["/api/admin/retry-payment", "card-payments"],
  ["/api/admin/stripe-sync", "card-payments"],
  ["/api/cron/membership-reminders", "memberships"],
  ["/api/admin/finance", "finance"],
  ["/api/cron/sync-finance", "finance"],
  ["/api/bank", "bank-matching"],
  ["/api/jersey", "shop"],
  ["/api/admin/jersey", "shop"],
  ["/api/admin/shop", "shop"],
  ["/api/profile/shop", "shop"],
  ["/api/create-donation-intent", "donations"],
  ["/api/create-donation-subscription", "donations"],
  ["/api/profile/photos", "gallery"],
  ["/api/profile/integrations", "integrations"],
  ["/api/v1", "integrations"],
  ["/api/mcp", "integrations"],
];

const matches = (prefix: string, path: string) => prefix === "/" ? path === "/" : path === prefix || path.startsWith(`${prefix}/`);

/** The owner of a path (its longest matching prefix), or null when no rule covers it. */
export function routeOwner(pathname: string): RouteOwner | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let best: readonly [string, RouteOwner] | null = null;
  for (const rule of ROUTE_OWNERS) {
    if (matches(rule[0], path) && (!best || rule[0].length > best[0].length)) best = rule;
  }
  return best ? best[1] : null;
}

const ALWAYS_ON: ReadonlySet<string> = new Set(["core", "account", "platform"]);

/**
 * The module that stops this path for a club, or null when the path is
 * served. `enabled` is the ids of the modules switched on for the club.
 * A path no rule covers is served: an unknown page is the app's own 404.
 */
export function blockedByModule(pathname: string, enabled: ReadonlySet<string>): ModuleId | null {
  const owner = routeOwner(pathname);
  if (!owner || ALWAYS_ON.has(owner) || enabled.has(owner)) return null;
  return owner as ModuleId;
}

/** Every prefix owned by a module that can be switched off: what the proxy has to look at. */
export function moduleOwnedPrefixes(): string[] {
  return ROUTE_OWNERS.filter(([, owner]) => !ALWAYS_ON.has(owner)).map(([prefix]) => prefix);
}
