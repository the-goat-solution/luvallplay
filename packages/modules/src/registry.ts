// What Three Wolves runs today, as the core plus optional modules (build plan
// §6.2 catalogue and §6.2.3). The admin menu, its badges and Today's "Needs
// attention" list are generated from the `admin` entries here (Track A step
// A1); tests/modules.test.ts checks the rest against the real routes, crons
// (vercel.json) and webhook events (lib/webhooks.ts), so it can't drift.

import { defineModule, type AdminNavItem } from "./define.ts";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── Core: always on; exactly what a free, no-money club needs (§6.2.3) ────────
// Admin sidebar for a core-only club: Home · Play days · People · Messages · Website · Settings.

export const home = defineModule({
  id: "home",
  scope: "club",
  group: "core",
  core: true,
  payments: "none",
  plan: "free",
  name: { en: "Home", vi: "Trang chủ" },
  admin: { nav: [{ group: "", href: "/admin", label: "Today", order: 10, exact: true }] },
});

export const playDays = defineModule({
  id: "play-days",
  scope: "club",
  group: "core",
  core: true,
  // Free sign-ups on Free play; paid clubs see prices on the same play days.
  payments: "optional",
  plan: "free",
  name: { en: "Play days", vi: "Buổi chơi" },
  settingsStoredIn: ["club_settings: max_casual_spots, booking_lock_days", "day_signup_settings", "lib/constants.ts"],
  app: { meCards: ["next-up", "calendar"] },
  admin: { nav: [{ group: "Play", href: "/admin/play-days", label: "Play days", order: 10 }] },
  site: { sections: ["schedule"] },
  crons: [
    { id: "headcount-alerts", schedule: "0 18 * * *", path: "/api/cron/headcount-alerts" },
    { id: "send-roster", schedule: "0 3 * * *", path: "/api/cron/send-roster" },
  ],
  emails: ["headcount-alert", "play-day-roster"],
  webhooks: ["attendance.recorded"],
});

export const people = defineModule({
  id: "people",
  scope: "club",
  group: "core",
  core: true,
  payments: "none",
  plan: "free",
  name: { en: "People & roles", vi: "Thành viên & vai trò" },
  app: { tabs: ["me"], routes: ["/login", "/profile", "/profile/settings", "/profile/player"] },
  admin: {
    nav: [{ group: "People", href: "/admin/players", label: "Players", order: 20, badge: "checkins" }],
    attention: [
      {
        key: "checkins",
        href: "/admin/players",
        urgency: 70,
        sentence: (n) => `${count(n, "check-in", "check-ins")} from connected apps to confirm`,
        action: "Confirm",
      },
    ],
  },
  emails: ["welcome"],
});

export const messages = defineModule({
  id: "messages",
  scope: "club",
  group: "core",
  core: true,
  payments: "none",
  plan: "free",
  name: { en: "Messages & announcements", vi: "Tin nhắn & thông báo" },
  app: { meCards: ["inbox"] },
  admin: {
    nav: [{ group: "People", href: "/admin/inbox", label: "Inbox", order: 30, badge: "inbox" }],
    attention: [{ key: "inbox", href: "/admin/inbox", urgency: 10, sentence: (n) => count(n, "unread message", "unread messages"), action: "Open inbox" }],
  },
});

export const website = defineModule({
  id: "website",
  scope: "club",
  group: "core",
  core: true,
  payments: "none",
  plan: "free",
  name: { en: "Website", vi: "Trang web" },
  site: { sections: ["hero", "about", "app-features", "reviews"], routes: ["/"] },
  settingsStoredIn: ["Sanity: siteSettings, about, reviews"],
});

export const settings = defineModule({
  id: "settings",
  scope: "club",
  group: "core",
  core: true,
  payments: "none",
  plan: "free",
  name: { en: "Settings", vi: "Cài đặt" },
  admin: {
    nav: [
      // Today's "Pricing & settings" page; the plans part moves to Memberships with the theming/settings work.
      { group: "Money", href: "/admin/settings", label: "Pricing & settings", order: 50 },
      { group: "Club", href: "/admin/people/admins", label: "Admins", order: 20 },
    ],
  },
});

// ── Run your club ────────────────────────────────────────────────────────────

export const calendarSync = defineModule({
  id: "calendar-sync",
  scope: "club",
  group: "run",
  payments: "none",
  plan: "free",
  name: { en: "Calendar sync", vi: "Đồng bộ lịch" },
  crons: [{ id: "sync-calendar", schedule: "0 2 * * *", path: "/api/cron/sync-calendar" }],
});

export const casualPlay = defineModule({
  id: "casual-play",
  scope: "club",
  group: "run",
  payments: "optional",
  plan: "free",
  name: { en: "Casual play", vi: "Chơi vãng lai" },
  liveActivity: "upcoming casual bookings",
});

export const courtBoard = defineModule({
  id: "court-board",
  scope: "club",
  group: "run",
  payments: "none",
  plan: "free",
  name: { en: "Court board", vi: "Bảng sân" },
  site: { routes: ["/casual-play"] },
  api: ["/api/casual-play"],
});

export const roundRobin = defineModule({
  id: "round-robin",
  scope: "club",
  group: "run",
  payments: "none",
  plan: "free",
  name: { en: "Round robin & mini games", vi: "Đấu vòng tròn & mini game" },
  app: { routes: ["/mini-game"] },
  webhooks: ["round_robin.result"],
});

export const dayRequests = defineModule({
  id: "day-requests",
  scope: "club",
  group: "run",
  payments: "none",
  plan: "free",
  name: { en: "Day requests", vi: "Yêu cầu ngày chơi" },
  admin: {
    nav: [{ group: "Play", href: "/admin/play-days/schedule", label: "Schedule", order: 20, badge: "dayRequests", match: ["/admin/day-requests"] }],
    pages: ["/admin/day-requests"],
    attention: [
      {
        key: "dayRequests",
        href: "/admin/play-days/schedule",
        urgency: 60,
        sentence: (n) => `${count(n, "person is", "people are")} waiting for a paused day to reopen`,
        action: "See schedule",
      },
    ],
  },
});

// ── Money (all optional; a free-play club leaves the group off, §6.2.1) ──────

export const memberships = defineModule({
  id: "memberships",
  scope: "club",
  group: "money",
  payments: "required",
  plan: "free",
  name: { en: "Memberships", vi: "Hội viên" },
  liveActivity: "active membership subscriptions",
  settingsStoredIn: ["pricing_plans"],
  app: { tabs: ["membership"], routes: ["/renew-membership", "/cancel-membership/confirm"] },
  admin: {
    nav: [{ group: "People", href: "/admin/members", label: "Members", order: 10, badge: "members" }],
    attention: [
      {
        key: "members",
        href: "/admin/members",
        urgency: 20,
        sentence: (n) => `${count(n, "member's payment", "members' payments")} failed`,
        action: "See members",
      },
    ],
  },
  site: { sections: ["membership"] },
  crons: [{ id: "membership-reminders", schedule: "0 19 * * *", path: "/api/cron/membership-reminders" }],
  emails: ["membership-reminder"],
  // Declared for integrations; nothing emits it yet.
  webhooks: ["membership.changed"],
});

export const paymentsToCheck = defineModule({
  id: "payments-to-check",
  scope: "club",
  group: "money",
  payments: "required",
  plan: "free",
  name: { en: "Payments to check", vi: "Khoản thanh toán cần kiểm tra" },
  liveActivity: "unpaid items waiting to be marked as paid",
});

export const bankMatching = defineModule({
  id: "bank-matching",
  scope: "club",
  group: "money",
  requires: ["finance"],
  payments: "required",
  plan: "free",
  name: { en: "Bank matching (NZ, Akahu)", vi: "Đối soát ngân hàng (NZ, Akahu)" },
  admin: {
    nav: [{ group: "Money", href: "/admin/financials/bank", label: "Bank", order: 20, badge: "bank" }],
    attention: [{ key: "bank", href: "/admin/financials/bank", urgency: 80, sentence: (n) => `${count(n, "bank line", "bank lines")} to reconcile`, action: "Reconcile" }],
  },
});

export const cardPayments = defineModule({
  id: "card-payments",
  scope: "club",
  group: "money",
  payments: "required",
  paymentModes: ["online"],
  plan: "free",
  name: { en: "Card payments", vi: "Thanh toán bằng thẻ" },
  liveActivity: "card subscriptions and pending payouts",
});

export const finance = defineModule({
  id: "finance",
  scope: "club",
  group: "money",
  // Free clubs can track expenses too.
  payments: "none",
  plan: "free",
  name: { en: "Finance & reports", vi: "Tài chính & báo cáo" },
  admin: {
    nav: [
      { group: "Money", href: "/admin/financials", label: "Ledger", order: 10 },
      { group: "Money", href: "/admin/financials/report", label: "Annual report", order: 30 },
    ],
  },
  crons: [{ id: "sync-finance", schedule: "0 13 * * *", path: "/api/cron/sync-finance" }],
});

export const shop = defineModule({
  id: "shop",
  scope: "club",
  group: "money",
  payments: "required",
  plan: "free",
  name: { en: "Shop & merch", vi: "Cửa hàng & đồ câu lạc bộ" },
  liveActivity: "unpaid or undelivered orders",
  admin: {
    nav: [{ group: "Money", href: "/admin/shop", label: "Shop", order: 40, badge: "shop" }],
    pages: ["/admin/jersey"],
    attention: [{ key: "shop", href: "/admin/shop", urgency: 40, sentence: (n) => `${count(n, "shop order", "shop orders")} to hand over`, action: "See orders" }],
  },
  site: { routes: ["/jersey"] },
});

export const donations = defineModule({
  id: "donations",
  scope: "club",
  group: "money",
  payments: "required",
  plan: "free",
  name: { en: "Donations", vi: "Ủng hộ" },
  site: { sections: ["donate"] },
});

// ── Engage players ───────────────────────────────────────────────────────────

export const arena = defineModule({
  id: "arena",
  scope: "club",
  group: "engage",
  payments: "none",
  plan: "free",
  name: { en: "Arena", vi: "Đấu Trường" },
  liveActivity: "challenges in progress",
  app: { tabs: ["arena", "leaderboard"], routes: ["/profile/arena", "/profile/leaderboard", "/challenges"] },
  admin: {
    nav: [{ group: "Play", href: "/admin/challenges", label: "Arena", order: 30, badge: "disputes" }],
    attention: [{ key: "disputes", href: "/admin/challenges", urgency: 30, sentence: (n) => `${count(n, "Arena score is", "Arena scores are")} disputed`, action: "Settle" }],
  },
  site: { sections: ["leaderboard-teaser"] },
});

export const vision = defineModule({
  id: "vision",
  scope: "club",
  group: "engage",
  recommends: ["arena"],
  payments: "none",
  plan: "free",
  name: { en: "Vision (match analysis)", vi: "Vision (phân tích trận đấu)" },
  app: { tabs: ["wolf-vision"], routes: ["/profile/wolf-vision"] },
  admin: { pages: ["/admin/device-check"] },
});

export const gallery = defineModule({
  id: "gallery",
  scope: "club",
  group: "engage",
  payments: "none",
  plan: "free",
  name: { en: "Gallery & photos", vi: "Hình ảnh" },
  admin: {
    nav: [{ group: "Club", href: "/admin/photos", label: "Photos", order: 10, badge: "photos" }],
    attention: [{ key: "photos", href: "/admin/photos", urgency: 50, sentence: (n) => `${count(n, "photo", "photos")} waiting for review`, action: "Review" }],
  },
  site: { sections: ["gallery"], routes: ["/gallery"] },
  webhooks: ["photo.approved"],
});

export const integrations = defineModule({
  id: "integrations",
  scope: "club",
  group: "engage",
  payments: "none",
  plan: "free",
  name: { en: "Integrations (API, webhooks, MCP)", vi: "Tích hợp (API, webhook, MCP)" },
  api: ["/api/v1/me", "/api/v1/sessions/upcoming", "/api/v1/leaderboard", "/api/mcp"],
});

// ── Juniors (Phase 3b, build plan §6.8) ──────────────────────────────────────
// Both are HIDDEN platform-wide while Phase 3b ships dark: no club is offered
// them, the ordinary switch refuses them, and they are never counted as on
// when the switches can't be read. Juniors is switched on only through its
// own guard (apps/web/lib/juniors/module.ts): an owner, a fresh sign-in code
// and the safeguarding policy acknowledged.

export const formsWaivers = defineModule({
  id: "forms-waivers",
  scope: "club",
  group: "run",
  payments: "none",
  plan: "free",
  availability: "hidden",
  name: { en: "Forms & waivers", vi: "Biểu mẫu & giấy cam kết" },
  liveActivity: "signed forms and waivers",
});

export const juniors = defineModule({
  id: "juniors",
  scope: "club",
  group: "run",
  // A guardian signs the club's consent forms and waivers for each child.
  requires: ["forms-waivers"],
  // Free on Free play; a paid club charges the guardian for a child's session.
  payments: "optional",
  plan: "free",
  availability: "hidden",
  name: { en: "Juniors", vi: "Thiếu niên" },
  liveActivity: "children's profiles and their upcoming bookings",
});

/** The core first, then every optional module in catalogue order. Global modules (§8) arrive in a later phase. */
export const MODULES = [
  home,
  playDays,
  people,
  messages,
  website,
  settings,
  calendarSync,
  casualPlay,
  courtBoard,
  roundRobin,
  dayRequests,
  memberships,
  paymentsToCheck,
  bankMatching,
  cardPayments,
  finance,
  shop,
  donations,
  arena,
  vision,
  gallery,
  integrations,
  formsWaivers,
  juniors,
] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

/**
 * Admin pages that aren't club features: they move to the Luvallplay platform
 * console, which only platform admins see (§6.2.3).
 */
export const PLATFORM_CONSOLE_PAGES: readonly AdminNavItem[] = [
  { group: "Club", href: "/admin/platform/admins", label: "Platform staff", order: 30 },
  { group: "Club", href: "/admin/setup", label: "System check", order: 40, match: ["/admin/device-check"] },
];

/** Three Wolves: online payments, and every module it uses today switched on (not the hidden ones: Juniors stays off). */
export const THREE_WOLVES = {
  paymentMode: "online",
  modules: MODULES.filter((m) => !m.core && m.availability !== "hidden").map((m) => m.id),
} as const;
