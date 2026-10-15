import Stripe from "stripe";
import { MEMBERSHIP_DAYS, type MembershipDay, type MembershipTier } from "./constants";
import {
  addDays,
  attachStripeIdToMembership,
  firstMembershipDayOnOrAfter,
  insertMembershipFromStripe,
  listMembershipsForStripeSync,
  updateMembershipFromStripe,
  type MembershipRow,
} from "./db";
import { getClubToday } from "./dates";
import { getStripe } from "./stripe";

// Brings every membership row in line with Stripe, which is the record of
// what each member actually paid for:
//
// - Recurring: status, cancel-at-period-end and the end date come straight
//   from the subscription (its current period end, or the end of a free-month
//   deferral).
// - One-time card: plan comes from the payment; the window must start on or
//   after the day it was paid, and ends a whole plan length later (plus any
//   free weeks given). A paid membership stuck at 'pending' because its
//   webhook never arrived is activated.
// - One-time cash: the out-of-band invoice must be paid; same window rule.
// - A membership paid in Stripe with no row here at all is recreated.
//
// Safe to run repeatedly — a second run finds nothing to change. Run daily by
// the reminders cron and from "Sync with Stripe now" on /admin/members.

export type StripeSyncChange = {
  membershipId: number;
  name: string;
  email: string;
  changes: string[];
};

export type StripeSyncReport = {
  checked: number;
  changed: StripeSyncChange[];
  /** Things the sync can't safely fix on its own — for an admin to look at. */
  issues: string[];
  errors: number;
};

const LIVE = new Set(["active", "trialing", "past_due"]);
const ENDED_SUBSCRIPTION = new Set(["canceled", "incomplete_expired"]);

function clubDate(unixSeconds: number): { dateKey: string; cutoffPassed: boolean } {
  return getClubToday(new Date(unixSeconds * 1000));
}

function planFromPayment(metadata: Stripe.Metadata, amount: number): MembershipTier {
  if (metadata.plan === "quarterly" || metadata.plan === "monthly") return metadata.plan;
  return amount >= 8500 ? "quarterly" : "monthly";
}

function dayFrom(metadata: Stripe.Metadata): MembershipDay | null {
  return metadata.day === "wednesday" || metadata.day === "friday" ? metadata.day : null;
}

// The first day a membership paid at `paidAt` could start — the same rule
// signup uses: today, or tomorrow once the 5pm cutoff has passed.
async function earliestStart(paidAt: number, day: MembershipDay): Promise<string> {
  const { dateKey, cutoffPassed } = clubDate(paidAt);
  return firstMembershipDayOnOrAfter(cutoffPassed ? addDays(dateKey, 1) : dateKey, day);
}

async function listAll<T>(
  iterable: AsyncIterable<T>,
): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

export async function syncMembershipsWithStripe(): Promise<StripeSyncReport> {
  const stripe = getStripe();
  const today = getClubToday().dateKey;
  const report: StripeSyncReport = { checked: 0, changed: [], issues: [], errors: 0 };

  const [rows, paidIntents, subscriptions] = await Promise.all([
    listMembershipsForStripeSync(),
    listAll(
      stripe.paymentIntents.search({
        query: "metadata['type']:'membership' AND status:'succeeded'",
        limit: 100,
      }),
    ),
    listAll(stripe.subscriptions.list({ status: "all", limit: 100 })),
  ]);
  const intentById = new Map(paidIntents.map((pi) => [pi.id, pi]));
  const subById = new Map(subscriptions.map((sub) => [sub.id, sub]));

  // Older rows may never have stored their payment's id. Link each to the
  // paid one-time membership payment made by the same email within 15
  // minutes of the row being created, so it can be checked like the rest.
  const linkedIds = new Set(rows.map((m) => m.stripePaymentIntentId).filter(Boolean));
  for (const m of rows) {
    if (m.recurring || m.stripePaymentIntentId || !m.createdAt) continue;
    const created = Date.parse(m.createdAt) / 1000;
    const match = paidIntents
      .filter(
        (pi) =>
          !linkedIds.has(pi.id) &&
          pi.metadata.recurring !== "true" &&
          (pi.metadata.email || pi.receipt_email || "").toLowerCase() === m.email.toLowerCase() &&
          Math.abs(pi.created - created) < 15 * 60,
      )
      .sort((a, b) => Math.abs(a.created - created) - Math.abs(b.created - created))[0];
    if (!match) continue;
    await attachStripeIdToMembership(m.id, { stripePaymentIntentId: match.id });
    m.stripePaymentIntentId = match.id;
    linkedIds.add(match.id);
    report.changed.push({
      membershipId: m.id,
      name: m.name,
      email: m.email,
      changes: [`linked to Stripe payment ${match.id}`],
    });
  }

  const record = (m: MembershipRow, changes: string[]) => {
    if (changes.length === 0) return;
    const existing = report.changed.find((c) => c.membershipId === m.id);
    if (existing) existing.changes.push(...changes);
    else report.changed.push({ membershipId: m.id, name: m.name, email: m.email, changes });
  };

  for (const m of rows) {
    try {
      if (m.recurring && m.stripeSubscriptionId) {
        if (m.status === "pending" && !subById.has(m.stripeSubscriptionId)) continue;
        report.checked++;
        let sub = subById.get(m.stripeSubscriptionId);
        if (!sub) {
          try {
            sub = await stripe.subscriptions.retrieve(m.stripeSubscriptionId);
          } catch (e) {
            if (e instanceof Stripe.errors.StripeError && e.statusCode === 404) {
              if (m.status !== "canceled") {
                await updateMembershipFromStripe(m.id, { status: "canceled" });
                record(m, [`status ${m.status} → canceled (subscription no longer exists in Stripe)`]);
              }
              continue;
            }
            throw e;
          }
        }
        // An abandoned checkout: Stripe never took the first payment.
        if (m.status === "pending" && (sub.status === "incomplete" || sub.status === "incomplete_expired")) {
          continue;
        }

        const status = ENDED_SUBSCRIPTION.has(sub.status)
          ? "canceled"
          : sub.status === "trialing"
            ? "active"
            : sub.status;
        const stripeEnd =
          sub.status === "trialing" && sub.trial_end
            ? sub.trial_end
            : (sub.ended_at ?? sub.items.data[0]?.current_period_end ?? null);
        const periodEnd = stripeEnd ? clubDate(stripeEnd).dateKey : null;

        const changes: string[] = [];
        const patch: Parameters<typeof updateMembershipFromStripe>[1] = {};
        if (status !== m.status) {
          patch.status = status;
          changes.push(`status ${m.status} → ${status}`);
        }
        if (sub.cancel_at_period_end !== m.cancelAtPeriodEnd) {
          patch.cancelAtPeriodEnd = sub.cancel_at_period_end;
          changes.push(sub.cancel_at_period_end ? "now set to cancel at period end" : "no longer cancelling");
        }
        if (periodEnd && periodEnd !== m.periodEnd) {
          patch.periodEnd = periodEnd;
          changes.push(`end date ${m.periodEnd ?? "none"} → ${periodEnd}`);
        }
        if (changes.length > 0) await updateMembershipFromStripe(m.id, patch);
        record(m, changes);
        continue;
      }

      const ref = m.stripePaymentIntentId;
      if (m.recurring) continue;
      if (!ref) {
        if (LIVE.has(m.status)) {
          report.issues.push(
            `${m.name} (${m.email}): membership #${m.id} has no Stripe payment linked, so it can't be checked.`,
          );
        }
        continue;
      }

      // One-time membership: find what was paid, and when.
      let paidAt: number | null = null;
      let plan: MembershipTier = m.plan;
      let day: MembershipDay = m.day;
      if (ref.startsWith("cash-invoice-")) {
        if (m.status === "pending") continue;
        report.checked++;
        const invoice = await stripe.invoices.retrieve(ref.slice("cash-invoice-".length));
        if (invoice.status !== "paid") {
          report.issues.push(
            `${m.name} (${m.email}): cash membership #${m.id} is ${m.status} but its Stripe invoice is ${invoice.status}.`,
          );
          continue;
        }
        paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
        plan = planFromPayment(invoice.metadata ?? {}, invoice.amount_paid);
        day = dayFrom(invoice.metadata ?? {}) ?? m.day;
      } else {
        const pi = intentById.get(ref);
        if (!pi) {
          // Unpaid: an abandoned checkout if still pending, which is fine.
          if (LIVE.has(m.status)) {
            report.issues.push(
              `${m.name} (${m.email}): membership #${m.id} is ${m.status} but its card payment (${ref}) never succeeded in Stripe.`,
            );
          }
          continue;
        }
        report.checked++;
        paidAt = pi.created;
        plan = planFromPayment(pi.metadata, pi.amount);
        day = dayFrom(pi.metadata) ?? m.day;
      }

      const changes: string[] = [];
      const patch: Parameters<typeof updateMembershipFromStripe>[1] = {};
      if (plan !== m.plan) {
        patch.plan = plan;
        changes.push(`plan ${m.plan} → ${plan}`);
      }
      // Access can't begin before the day it was paid for.
      const earliest = await earliestStart(paidAt, day);
      let start = m.periodStart;
      if (!start || start < earliest) {
        start = earliest;
        patch.periodStart = start;
        changes.push(`start date ${m.periodStart ?? "none"} → ${start}`);
      }
      const end = addDays(start, MEMBERSHIP_DAYS[plan] + (m.freeDaysGranted ?? 0));
      if (end !== m.periodEnd) {
        patch.periodEnd = end;
        changes.push(`end date ${m.periodEnd ?? "none"} → ${end}`);
      }
      // Paid, but the webhook that activates it never landed.
      if (m.status === "pending") {
        const status = end < today ? "expired" : "active";
        patch.status = status;
        changes.push(`status pending → ${status} (payment had succeeded)`);
      } else if (m.status === "expired" && end >= today) {
        patch.status = "active";
        changes.push("status expired → active (paid window still running)");
      } else if (LIVE.has(m.status) && end < today) {
        patch.status = "expired";
        changes.push(`status ${m.status} → expired`);
      }
      if (changes.length > 0) await updateMembershipFromStripe(m.id, patch);
      record(m, changes);
    } catch (err) {
      report.errors++;
      console.error("Stripe sync failed for membership", m.id, err);
    }
  }

  // Paid in Stripe, but no row here at all.
  const knownIntents = new Set(rows.map((m) => m.stripePaymentIntentId).filter(Boolean));
  for (const pi of paidIntents) {
    if (knownIntents.has(pi.id) || pi.metadata.recurring === "true") continue;
    try {
      const plan = planFromPayment(pi.metadata, pi.amount);
      const day = dayFrom(pi.metadata) ?? "friday";
      const start = await earliestStart(pi.created, day);
      const end = addDays(start, MEMBERSHIP_DAYS[plan]);
      const email = pi.metadata.email || pi.receipt_email || "";
      if (end < today || !email) continue; // long over — nothing to restore
      // An older row may cover this payment without having stored its id —
      // flag it rather than risk a duplicate membership.
      const overlapping = rows.find(
        (m) =>
          m.status !== "pending" &&
          m.email.toLowerCase() === email.toLowerCase() &&
          m.day === day &&
          (m.periodEnd ?? "") >= start &&
          (m.periodStart ?? "") <= end,
      );
      if (overlapping) {
        report.issues.push(
          `${overlapping.name} (${email}): Stripe payment ${pi.id} isn't linked to a membership; membership #${overlapping.id} (${overlapping.periodStart} → ${overlapping.periodEnd}) may be it — check it matches.`,
        );
        continue;
      }
      const id = await insertMembershipFromStripe({
        email,
        firstName: pi.metadata.firstName ?? "",
        lastName: pi.metadata.lastName ?? "",
        phone: pi.metadata.phone || null,
        plan,
        day,
        periodStart: start,
        periodEnd: end,
        recurring: false,
        status: "active",
        stripePaymentIntentId: pi.id,
      });
      report.changed.push({
        membershipId: id,
        name: `${pi.metadata.firstName ?? ""} ${pi.metadata.lastName ?? ""}`.trim() || email,
        email,
        changes: [`restored missing ${plan} membership paid in Stripe (${start} → ${end})`],
      });
    } catch (err) {
      report.errors++;
      console.error("Failed to restore membership from Stripe payment", pi.id, err);
    }
  }

  const knownSubs = new Set(rows.map((m) => m.stripeSubscriptionId).filter(Boolean));
  for (const sub of subscriptions) {
    if (knownSubs.has(sub.id) || !LIVE.has(sub.status)) continue;
    const plan = sub.metadata.plan;
    if (plan !== "monthly" && plan !== "quarterly") continue; // not a membership (e.g. a donation)
    try {
      const day = dayFrom(sub.metadata) ?? "friday";
      const start = await earliestStart(sub.start_date, day);
      const stripeEnd =
        sub.status === "trialing" && sub.trial_end
          ? sub.trial_end
          : sub.items.data[0]?.current_period_end;
      const end = stripeEnd ? clubDate(stripeEnd).dateKey : addDays(start, MEMBERSHIP_DAYS[plan]);
      const customer =
        typeof sub.customer === "string" ? await stripe.customers.retrieve(sub.customer) : sub.customer;
      const email =
        sub.metadata.email || (!customer.deleted ? (customer.email ?? "") : "");
      if (!email) continue;
      const id = await insertMembershipFromStripe({
        email,
        firstName: sub.metadata.firstName ?? "",
        lastName: sub.metadata.lastName ?? "",
        phone: null,
        plan,
        day,
        periodStart: start,
        periodEnd: end,
        recurring: true,
        status: sub.status === "trialing" ? "active" : sub.status,
        stripeSubscriptionId: sub.id,
      });
      report.changed.push({
        membershipId: id,
        name: `${sub.metadata.firstName ?? ""} ${sub.metadata.lastName ?? ""}`.trim() || email,
        email,
        changes: [`restored missing auto-renewing ${plan} membership from Stripe (renews ${end})`],
      });
    } catch (err) {
      report.errors++;
      console.error("Failed to restore membership from Stripe subscription", sub.id, err);
    }
  }

  return report;
}
