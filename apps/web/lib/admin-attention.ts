import { cache } from "react";
import { countUnreadForAdmin } from "./messages-db";
import { countPhotosNeedingReview } from "./photos-db";
import { countDisputes } from "./arena-db";
import { countBankToReconcile } from "./bank-db";
import { countShopOrdersToHandOver } from "./shop-db";
import { countFailedMemberPayments } from "./db";
import { listUnverifiedAttendance } from "./stats-db";
import { listDayRequests } from "./day-requests";

// What needs an admin's attention: the Today page lists these and the
// sidebar shows the same counts as badges. Each count runs at most once per
// request (React cache), however many places ask for it.

export type AttentionKey = "inbox" | "members" | "disputes" | "photos" | "checkins" | "dayRequests" | "shop" | "bank";

export type AttentionItem = {
  key: AttentionKey;
  /** The page where it gets done (also decides who sees it). */
  href: string;
  /** Plain sentence for the Today page, e.g. "3 unread messages". */
  sentence: (n: number) => string;
  action: string;
};

const s = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Most urgent first: people waiting on a reply or a payment problem.
export const ATTENTION: AttentionItem[] = [
  { key: "inbox", href: "/admin/inbox", sentence: (n) => s(n, "unread message", "unread messages"), action: "Open inbox" },
  { key: "members", href: "/admin/members", sentence: (n) => `${s(n, "member's payment", "members' payments")} failed`, action: "See members" },
  { key: "disputes", href: "/admin/challenges", sentence: (n) => `${s(n, "Arena score is", "Arena scores are")} disputed`, action: "Settle" },
  { key: "shop", href: "/admin/shop", sentence: (n) => `${s(n, "shop order", "shop orders")} to hand over`, action: "See orders" },
  { key: "photos", href: "/admin/photos", sentence: (n) => `${s(n, "photo", "photos")} waiting for review`, action: "Review" },
  {
    key: "dayRequests",
    href: "/admin/play-days/schedule",
    sentence: (n) => `${s(n, "person is", "people are")} waiting for a paused day to reopen`,
    action: "See schedule",
  },
  { key: "checkins", href: "/admin/players", sentence: (n) => `${s(n, "check-in", "check-ins")} from connected apps to confirm`, action: "Confirm" },
  { key: "bank", href: "/admin/financials/bank", sentence: (n) => `${s(n, "bank line", "bank lines")} to reconcile`, action: "Reconcile" },
];

const COUNTERS: Record<AttentionKey, () => Promise<number>> = {
  inbox: countUnreadForAdmin,
  members: countFailedMemberPayments,
  disputes: countDisputes,
  photos: countPhotosNeedingReview,
  checkins: async () => (await listUnverifiedAttendance()).length,
  dayRequests: async () => (await listDayRequests()).filter((r) => r.notifiedAt === null).length,
  shop: countShopOrdersToHandOver,
  bank: countBankToReconcile,
};

/** How many of `key` need attention. A failing count reads as 0 (it just hides). */
export const attentionCount = cache(async (key: AttentionKey): Promise<number> => {
  if (!process.env.POSTGRES_URL) return 0;
  return COUNTERS[key]().catch(() => 0);
});
