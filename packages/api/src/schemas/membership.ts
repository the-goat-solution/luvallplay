// Membership self-service and casual booking (the website's Me).
import { z } from "zod";
import { dateKeySchema } from "./me.ts";

const tier = z.enum(["monthly", "quarterly"]);
/** The weekdays a membership can be for (as the club's payments are set up). */
const membershipDay = z.enum(["friday", "wednesday"]);
export const membershipStateResponse = z.object({
  membership: z.object({
    plan: tier,
    day: membershipDay,
    status: z.enum(["active", "ending", "upcoming", "past_due"]),
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable(),
    /** Renews by itself (a subscription), until turned off. */
    recurring: z.boolean(),
    cancelAtPeriodEnd: z.boolean(),
    /** How it was paid: "card", "cash", "bank_transfer". */
    method: z.string(),
    /** Plan and day changes and turning it off are possible (a card subscription). */
    manageable: z.boolean(),
    continuation: z.object({ plan: tier, periodStart: z.string().nullable(), periodEnd: z.string().nullable(), recurring: z.boolean() }).nullable(),
    daysLeft: z.number().int(),
  }).nullable(),
  /** Minor units of the club's currency. */
  prices: z.object({ monthly: z.number().int(), quarterly: z.number().int() }),
  days: z.array(membershipDay),
  /** Days the club has paused (no new memberships or changes to them). */
  pausedDays: z.array(z.string()),
  streak: z.number().int(),
  monthRank: z.number().int().nullable(),
});
export const billingResponse = z.object({
  card: z.object({ brand: z.string(), last4: z.string(), expMonth: z.number().int(), expYear: z.number().int() }).nullable(),
  nextCharge: z.object({ date: z.string(), amountCents: z.number().int() }).nullable(),
  pendingChange: z.object({ plan: tier, day: membershipDay, from: z.string() }).nullable(),
  receipts: z.array(z.object({ date: z.string(), amountCents: z.number().int(), description: z.string(), url: z.string().nullable(), refunded: z.boolean() })),
});
const reason = z.string().min(1).max(60);
/** One membership change, as the website's /api/profile/membership/action. */
export const membershipActionRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change"), plan: tier, day: membershipDay, reason: reason.optional(), comment: z.string().max(1000).optional() }),
  z.object({ action: z.literal("cancel_change") }),
  z.object({ action: z.literal("cancel"), reason, comment: z.string().max(1000).optional() }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("renew"), plan: tier }),
  z.object({ action: z.literal("autorenew_setup") }),
  z.object({ action: z.literal("autorenew_confirm"), plan: tier, setupIntentId: z.string().min(5).max(100) }),
]);
export const membershipActionResponse = z.object({
  ok: z.literal(true),
  /** change: when the new plan or day starts. */
  from: z.string().optional(),
  cleared: z.boolean().optional(),
  /** cancel: the last day. */
  endsOn: z.string().nullable().optional(),
  /** renew (a payment) and autorenew_setup (saving a card): confirm in the browser. */
  clientSecret: z.string().optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  /** renew: the price in major units, as the website shows it. */
  priceNzd: z.number().optional(),
});
export const portalResponse = z.object({ url: z.string().url() });
export const joinRequest = z.object({ plan: tier, day: membershipDay, recurring: z.boolean() });
export const paymentStartResponse = z.object({ clientSecret: z.string(), periodStart: z.string().nullable() });
export const bookRequest = z.object({ date: dateKeySchema });
