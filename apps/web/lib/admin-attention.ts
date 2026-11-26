import { cache } from "react";
import { countUnreadForAdmin } from "./messages-db";
import { countPhotosNeedingReview } from "./photos-db";
import { countDisputes } from "./arena-db";
import { countBankToReconcile } from "./bank-db";
import { countShopOrdersToHandOver } from "./shop-db";
import { countFailedMemberPayments } from "./db";
import { listUnverifiedAttendance } from "./stats-db";
import { listDayRequests } from "./day-requests";
import { MODULES, adminAttention, type AdminAttention } from "@luvallplay/modules";

// What needs an admin's attention: the Today page lists these and the
// sidebar shows the same counts as badges. Each count runs at most once per
// request (React cache), however many places ask for it.
//
// WHAT can need attention (its page, wording and urgency) is declared by the
// module that owns it (packages/modules/src/registry.ts, `admin.attention`).
// This file only holds HOW each one is counted; tests/modules.test.ts checks
// the two lists name the same keys.

export type AttentionKey = "inbox" | "members" | "disputes" | "photos" | "checkins" | "dayRequests" | "shop" | "bank";

export type AttentionItem = Omit<AdminAttention, "key"> & {
  key: AttentionKey;
  /** The module that declared it: switched off for a club, it isn't counted or shown. */
  module: string;
};

/** Most urgent first: people waiting on a reply or a payment problem. */
export const ATTENTION: AttentionItem[] = adminAttention(MODULES) as AttentionItem[];

export const COUNTERS: Record<AttentionKey, () => Promise<number>> = {
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
