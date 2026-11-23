// What Three Wolves runs today, as modules (build plan §6.2 catalogue).
// Descriptive only: the app doesn't read this yet. tests/modules.test.ts checks
// it against the real admin menu (components/admin/nav-config.ts), crons
// (vercel.json) and webhook events (lib/webhooks.ts), so it can't drift.

import { defineModule } from "./define.ts";

// ── Core (always on) ─────────────────────────────────────────────────────────

export const clubSite = defineModule({
  id: "club-site",
  scope: "club",
  group: "core",
  core: true,
  plan: "free",
  name: { en: "Club profile & website", vi: "Hồ sơ & trang web câu lạc bộ" },
  site: { sections: ["hero", "about", "app-features", "reviews"], routes: ["/"] },
  settingsStoredIn: ["Sanity: siteSettings, about, reviews"],
});

export const members = defineModule({
  id: "members",
  scope: "club",
  group: "core",
  core: true,
  plan: "free",
  name: { en: "Members & roles", vi: "Thành viên & vai trò" },
  app: { tabs: ["me"], routes: ["/login", "/profile", "/profile/settings", "/profile/player"] },
  admin: {
    nav: [
      { group: "People", href: "/admin/members" },
      { group: "People", href: "/admin/players" },
      { group: "Club", href: "/admin/people/admins" },
      { group: "Club", href: "/admin/platform/admins" },
    ],
  },
});

export const messages = defineModule({
  id: "messages",
  scope: "club",
  group: "core",
  core: true,
  requires: ["members"],
  plan: "free",
  name: { en: "Messages", vi: "Tin nhắn" },
  app: { meCards: ["inbox"] },
  admin: { nav: [{ group: "People", href: "/admin/inbox" }] },
});

export const admin = defineModule({
  id: "admin",
  scope: "club",
  group: "core",
  core: true,
  requires: ["members"],
  plan: "free",
  name: { en: "Admin", vi: "Quản trị" },
  admin: {
    nav: [
      { group: "", href: "/admin" },
      { group: "Club", href: "/admin/setup" },
    ],
  },
});

// ── Run your club ────────────────────────────────────────────────────────────

export const playDays = defineModule({
  id: "play-days",
  scope: "club",
  group: "run",
  requires: ["members"],
  recommends: ["memberships"],
  plan: "free",
  name: { en: "Play days & bookings", vi: "Buổi chơi & đặt chỗ" },
  settingsStoredIn: ["club_settings: max_casual_spots, booking_lock_days", "day_signup_settings", "lib/constants.ts"],
  app: { meCards: ["next-up", "calendar"] },
  admin: { nav: [{ group: "Play", href: "/admin/play-days" }] },
  site: { sections: ["schedule"] },
  crons: [
    { id: "sync-calendar", schedule: "0 2 * * *", path: "/api/cron/sync-calendar" },
    { id: "headcount-alerts", schedule: "0 18 * * *", path: "/api/cron/headcount-alerts" },
    { id: "send-roster", schedule: "0 3 * * *", path: "/api/cron/send-roster" },
  ],
  webhooks: ["attendance.recorded"],
});

export const dayRequests = defineModule({
  id: "day-requests",
  scope: "club",
  group: "run",
  requires: ["play-days"],
  plan: "free",
  name: { en: "Day requests", vi: "Yêu cầu ngày chơi" },
  admin: { nav: [{ group: "Play", href: "/admin/day-requests" }] },
});

export const casualPlay = defineModule({
  id: "casual-play",
  scope: "club",
  group: "run",
  requires: ["play-days"],
  plan: "free",
  name: { en: "Casual play", vi: "Chơi vãng lai" },
  site: { routes: ["/casual-play"] },
});

export const roundRobin = defineModule({
  id: "round-robin",
  scope: "club",
  group: "run",
  requires: ["play-days"],
  plan: "free",
  name: { en: "Round robin & mini games", vi: "Đấu vòng tròn & mini game" },
  app: { routes: ["/mini-game"] },
  webhooks: ["round_robin.result"],
});

// ── Money ────────────────────────────────────────────────────────────────────

export const memberships = defineModule({
  id: "memberships",
  scope: "club",
  group: "money",
  requires: ["members"],
  plan: "free",
  name: { en: "Memberships", vi: "Hội viên" },
  settingsStoredIn: ["pricing_plans"],
  app: { tabs: ["membership"], routes: ["/renew-membership", "/cancel-membership/confirm"] },
  admin: { nav: [{ group: "Money", href: "/admin/settings" }] },
  site: { sections: ["membership"] },
  crons: [{ id: "membership-reminders", schedule: "0 19 * * *", path: "/api/cron/membership-reminders" }],
  // Declared for integrations; nothing emits it yet.
  webhooks: ["membership.changed"],
});

export const shop = defineModule({
  id: "shop",
  scope: "club",
  group: "money",
  requires: ["members"],
  plan: "free",
  name: { en: "Shop & merch", vi: "Cửa hàng & đồ câu lạc bộ" },
  admin: { nav: [{ group: "Money", href: "/admin/shop" }] },
  site: { routes: ["/jersey"] },
});

export const donations = defineModule({
  id: "donations",
  scope: "club",
  group: "money",
  plan: "free",
  name: { en: "Donations", vi: "Ủng hộ" },
  site: { sections: ["donate"] },
});

export const finance = defineModule({
  id: "finance",
  scope: "club",
  group: "money",
  plan: "free",
  name: { en: "Finance & reports", vi: "Tài chính & báo cáo" },
  admin: {
    nav: [
      { group: "Money", href: "/admin/financials" },
      { group: "Money", href: "/admin/financials/report" },
    ],
  },
  crons: [{ id: "sync-finance", schedule: "0 13 * * *", path: "/api/cron/sync-finance" }],
});

export const bankNz = defineModule({
  id: "bank-nz",
  scope: "club",
  group: "money",
  requires: ["finance"],
  plan: "free",
  name: { en: "Bank reconciliation (NZ, Akahu)", vi: "Đối soát ngân hàng (NZ, Akahu)" },
  admin: { nav: [{ group: "Money", href: "/admin/financials/bank" }] },
});

// ── Engage players ───────────────────────────────────────────────────────────

export const arena = defineModule({
  id: "arena",
  scope: "club",
  group: "engage",
  requires: ["members"],
  recommends: ["play-days"],
  plan: "free",
  name: { en: "Arena", vi: "Đấu Trường" },
  app: { tabs: ["arena"], routes: ["/profile/arena", "/challenges"] },
  admin: { nav: [{ group: "Play", href: "/admin/challenges" }] },
  site: { sections: ["leaderboard-teaser"] },
});

export const vision = defineModule({
  id: "vision",
  scope: "club",
  group: "engage",
  requires: ["members"],
  recommends: ["arena"],
  plan: "free",
  name: { en: "Vision (match analysis)", vi: "Vision (phân tích trận đấu)" },
  app: { tabs: ["wolf-vision"], routes: ["/profile/wolf-vision"] },
});

export const gallery = defineModule({
  id: "gallery",
  scope: "club",
  group: "engage",
  requires: ["members"],
  plan: "free",
  name: { en: "Gallery & photos", vi: "Hình ảnh" },
  admin: { nav: [{ group: "Club", href: "/admin/photos" }] },
  site: { sections: ["gallery"], routes: ["/gallery"] },
  webhooks: ["photo.approved"],
});

export const integrations = defineModule({
  id: "integrations",
  scope: "club",
  group: "engage",
  requires: ["members"],
  plan: "free",
  name: { en: "Integrations (API, webhooks, MCP)", vi: "Tích hợp (API, webhook, MCP)" },
  api: ["/api/v1/me", "/api/v1/sessions/upcoming", "/api/v1/leaderboard", "/api/mcp"],
});

/** Every module, in catalogue order. Global modules (§8) arrive in a later phase. */
export const MODULES = [
  clubSite,
  members,
  messages,
  admin,
  playDays,
  dayRequests,
  casualPlay,
  roundRobin,
  memberships,
  shop,
  donations,
  finance,
  bankNz,
  arena,
  vision,
  gallery,
  integrations,
] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

/** What Three Wolves has switched on: every module (it's the club the catalogue was drawn from). */
export const THREE_WOLVES_MODULES: readonly ModuleId[] = MODULES.map((m) => m.id);
