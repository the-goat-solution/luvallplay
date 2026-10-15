import Stripe from "stripe";
import {
  addDays,
  type MembershipRow,
  expireLapsedOneTimeMemberships,
  getStaleRecurringMemberships,
  syncRecurringMembership,
} from "./db";
import { getClubToday } from "./dates";
import { getStripe } from "./stripe";

// A recurring membership's stored period_end can sit a day or two behind
// Stripe's own renewal date (access is anchored to play days, billing isn't),
// so only treat it as stale once it's this many days overdue.
const RECURRING_STALE_GRACE_DAYS = 3;

// Stripe statuses that mean the subscription is over for good.
const ENDED_STRIPE_STATUSES = new Set(["canceled", "incomplete_expired"]);

// Keeps membership statuses honest:
// - one-time memberships past their end date become 'expired';
// - recurring memberships whose access window ran out without a renewal or
//   cancellation webhook are re-checked against Stripe and synced.
// Safe to run repeatedly. Called daily by the reminders cron.
export type MembershipAuditResult = {
  expired: number;
  recurringChecked: number;
  recurringEnded: number;
  errors: number;
  /** Memberships this run moved out of a live status. */
  changed: { id: number; name: string; periodEnd: string | null; status: string }[];
};

export async function auditMembershipStatuses(): Promise<MembershipAuditResult> {
  const today = getClubToday().dateKey;
  const expired = await expireLapsedOneTimeMemberships(today);

  const stale = await getStaleRecurringMemberships(
    addDays(today, -RECURRING_STALE_GRACE_DAYS),
  );
  const changed: MembershipAuditResult["changed"] = expired.map((m: MembershipRow) => ({
    id: m.id,
    name: m.name,
    periodEnd: m.periodEnd,
    status: "expired",
  }));
  let recurringEnded = 0;
  let errors = 0;
  if (stale.length > 0) {
    const stripe = getStripe();
    for (const m of stale) {
      if (!m.stripeSubscriptionId) continue;
      try {
        let status: string;
        let cancelAtPeriodEnd = m.cancelAtPeriodEnd;
        try {
          const sub = await stripe.subscriptions.retrieve(m.stripeSubscriptionId);
          status = ENDED_STRIPE_STATUSES.has(sub.status)
            ? "canceled"
            : sub.status === "trialing"
              ? "active"
              : sub.status;
          cancelAtPeriodEnd = sub.cancel_at_period_end;
        } catch (e) {
          // Deleted in Stripe (or never existed there) — it can't renew.
          if (e instanceof Stripe.errors.StripeError && e.statusCode === 404) {
            status = "canceled";
          } else {
            throw e;
          }
        }
        if (status === "canceled") {
          recurringEnded++;
          changed.push({ id: m.id, name: m.name, periodEnd: m.periodEnd, status });
        }
        await syncRecurringMembership(m.id, status, cancelAtPeriodEnd, today);
      } catch (err) {
        errors++;
        console.error("Failed to reconcile membership with Stripe", m.id, err);
      }
    }
  }

  if (expired.length > 0 || recurringEnded > 0) {
    console.log(
      `Membership audit: ${expired.length} one-time expired, ${recurringEnded} recurring ended`,
    );
  }
  return {
    expired: expired.length,
    recurringChecked: stale.length,
    recurringEnded,
    errors,
    changed,
  };
}
