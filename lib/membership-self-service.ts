import Stripe from "stripe";
import { paymentMethodFromRef, type PaymentMethod } from "./offline-payment";
import { sql } from "@vercel/postgres";
import {
  addDays,
  assignAndReserveMembershipAccessStart,
  attachStripeIdToMembership,
  ensureTables,
  getActiveRenewalOf,
  getSpotsAndHeadcountForDates,
  listSessionsInRange,
  type MembershipRow,
} from "./db";
import { isDayPaused } from "./day-requests";
import { getClubToday } from "./dates";
import {
  createOneTimeMembershipPaymentIntent,
  getStripe,
  oneTimeMembershipPriceCents,
  resolvePriceId,
} from "./stripe";
import { MEMBERSHIP_CYCLE_DAYS, type MembershipDay, type MembershipTier } from "./constants";
import { ensurePlayerTables, type Player } from "./player-db";
import { sendAdminAlertEmail, sendPlayerNoticeEmail } from "./player-email";
import { onceThisDeploy } from "./schema-gate";

// Self-service membership management from the profile's Membership tab.
//
// Plan and day changes take effect at the NEXT renewal (a Stripe
// subscription schedule: the current phase runs out, then the new price
// starts with no proration). The new phase carries the new plan/day as
// subscription metadata, which the Stripe webhook copies onto the
// membership row — see syncPlanFromSubscriptionMetadata.

const LIVE_STATUSES = ["active", "trialing", "past_due"];

export type MemberView = {
  id: number;
  plan: MembershipTier;
  day: MembershipDay;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  recurring: boolean;
  cancelAtPeriodEnd: boolean;
  method: PaymentMethod;
  stripeSubscriptionId: string | null;
  /** A paid follow-on membership (one-time renewal) that starts after this one. */
  continuation: { periodStart: string | null; periodEnd: string | null; plan: MembershipTier; recurring: boolean } | null;
};

type Row = {
  id: number;
  plan: string;
  day: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  recurring: boolean;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
  stripe_payment_intent_id: string | null;
  renewal_of: number | null;
};

function view(r: Row, continuation: MemberView["continuation"]): MemberView {
  return {
    id: r.id,
    plan: r.plan === "quarterly" ? "quarterly" : "monthly",
    day: r.day === "wednesday" ? "wednesday" : "friday",
    status: r.status,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    recurring: r.recurring,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    method: paymentMethodFromRef(r.stripe_payment_intent_id),
    stripeSubscriptionId: r.stripe_subscription_id,
    continuation,
  };
}

/** The member's current (or next upcoming) membership, if any. */
export async function getCurrentMembership(email: string): Promise<MemberView | null> {
  if (!process.env.POSTGRES_URL) return null;
  await ensureTables();
  const today = getClubToday().dateKey;
  const { rows } = await sql.query(
    `SELECT id, plan, day, status, period_start::text AS period_start, period_end::text AS period_end,
       recurring, cancel_at_period_end, stripe_subscription_id, stripe_payment_intent_id, renewal_of
     FROM memberships
     WHERE lower(trim(email)) = $1 AND status = ANY($2::text[])
       AND (period_end IS NULL OR period_end >= $3::date OR (recurring AND cancel_at_period_end = FALSE))
     ORDER BY period_start ASC NULLS LAST, created_at ASC;`,
    [email.trim().toLowerCase(), LIVE_STATUSES, today],
  );
  const all = rows as Row[];
  if (all.length === 0) return null;
  const current = all.find((r) => !r.period_start || r.period_start <= today) ?? all[0];
  const next = all.find((r) => r.id !== current.id && (r.renewal_of === current.id || (r.period_start ?? "") > (current.period_end ?? "")));
  return view(
    current,
    next
      ? {
          periodStart: next.period_start,
          periodEnd: next.period_end,
          plan: next.plan === "quarterly" ? "quarterly" : "monthly",
          recurring: next.recurring,
        }
      : null,
  );
}

/** Play days left in the member's current window (from today). */
export async function playDaysLeft(m: MemberView): Promise<number> {
  if (!m.periodEnd) return 0;
  const today = getClubToday().dateKey;
  const from = m.periodStart && m.periodStart > today ? m.periodStart : today;
  const sessions = await listSessionsInRange(from, m.periodEnd);
  const dow = m.day === "friday" ? 5 : 3;
  return sessions.filter((s) => new Date(`${s.date}T00:00:00Z`).getUTCDay() === dow).length;
}

// ---------------------------------------------------------------------------
// Stripe customer + billing details
// ---------------------------------------------------------------------------

export async function stripeCustomerFor(player: Player, create = false): Promise<string | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (player.stripeCustomerId) return player.stripeCustomerId;
  const stripe = getStripe();
  const found = await stripe.customers.list({ email: player.email, limit: 1 });
  let id = found.data[0]?.id ?? null;
  if (!id && create) {
    id = (
      await stripe.customers.create({
        email: player.email,
        name: `${player.firstName} ${player.lastName}`.trim() || undefined,
        phone: player.phone ?? undefined,
      })
    ).id;
  }
  if (id) {
    await ensurePlayerTables();
    await sql`UPDATE players SET stripe_customer_id = ${id} WHERE id = ${player.id} AND stripe_customer_id IS NULL;`;
  }
  return id;
}

export type Billing = {
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  nextCharge: { date: string; amountCents: number } | null;
  pendingChange: { plan: MembershipTier; day: MembershipDay; from: string } | null;
  receipts: { date: string; amountCents: number; description: string; url: string | null; refunded: boolean }[];
};

function isoDate(unix: number | null | undefined): string | null {
  return unix ? getClubToday(new Date(unix * 1000)).dateKey : null;
}

export async function getBilling(player: Player, m: MemberView | null): Promise<Billing> {
  const empty: Billing = { card: null, nextCharge: null, pendingChange: null, receipts: [] };
  const customerId = await stripeCustomerFor(player);
  if (!customerId) return empty;
  const stripe = getStripe();
  const billing: Billing = { ...empty };

  const [customer, charges] = await Promise.all([
    stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] }),
    stripe.charges.list({ customer: customerId, limit: 12 }),
  ]);
  billing.receipts = charges.data
    .filter((c) => c.status === "succeeded")
    .map((c) => ({
      date: isoDate(c.created) ?? "",
      amountCents: c.amount,
      description: c.description ?? "Three Wolves",
      url: c.receipt_url ?? null,
      refunded: c.refunded,
    }));

  let pm: Stripe.PaymentMethod | null = null;
  if (!customer.deleted) {
    const dpm = customer.invoice_settings?.default_payment_method;
    if (dpm && typeof dpm === "object") pm = dpm;
  }

  if (m?.stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(m.stripeSubscriptionId, {
      expand: ["default_payment_method", "schedule"],
    });
    if (sub.default_payment_method && typeof sub.default_payment_method === "object") pm = sub.default_payment_method;
    const item = sub.items.data[0];
    const nextAt = sub.status === "trialing" && sub.trial_end ? sub.trial_end : item?.current_period_end;
    let amount = item?.price?.unit_amount ?? 0;
    const schedule = sub.schedule && typeof sub.schedule === "object" ? sub.schedule : null;
    if (schedule && schedule.status === "active") {
      const now = Math.floor(Date.now() / 1000);
      const upcoming = schedule.phases.find((p) => p.start_date > now);
      const md = upcoming?.metadata ?? {};
      if (upcoming && (md.plan === "monthly" || md.plan === "quarterly") && (md.day === "friday" || md.day === "wednesday")) {
        billing.pendingChange = { plan: md.plan, day: md.day, from: isoDate(upcoming.start_date) ?? "" };
        amount = oneTimeMembershipPriceCents(md.plan);
      }
    }
    if (!sub.cancel_at_period_end && nextAt && sub.status !== "canceled") {
      billing.nextCharge = { date: isoDate(nextAt) ?? "", amountCents: amount };
    }
  }
  if (!pm) {
    const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    pm = list.data[0] ?? null;
  }
  if (pm?.card) {
    billing.card = { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
  }
  return billing;
}

/** Stripe's hosted page, limited to updating the card (no cancel button). */
export async function cardUpdatePortalUrl(player: Player, returnUrl: string): Promise<string> {
  const customerId = await stripeCustomerFor(player, true);
  if (!customerId) throw new Error("Payments aren't set up");
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    ...(process.env.STRIPE_PORTAL_CONFIGURATION_ID ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID } : {}),
    flow_data: {
      type: "payment_method_update",
      after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
    },
  });
  return session.url;
}

// ---------------------------------------------------------------------------
// Changes at the next renewal
// ---------------------------------------------------------------------------

export class SelfServiceError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Is there room on the target day for the first few play days after the switch? */
async function dayHasRoom(day: MembershipDay, fromDate: string): Promise<boolean> {
  const dow = day === "friday" ? 5 : 3;
  const sessions = (await listSessionsInRange(fromDate, addDays(fromDate, 60)))
    .map((s) => s.date)
    .filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === dow)
    .slice(0, 4);
  if (sessions.length === 0) return true; // not on the calendar yet: nothing to check against
  const { spots } = await getSpotsAndHeadcountForDates(sessions);
  return sessions.some((d) => (spots[d] ?? 0) > 0);
}

async function currentSubscription(m: MemberView): Promise<Stripe.Subscription> {
  if (!m.stripeSubscriptionId || !m.recurring) throw new SelfServiceError("not_recurring");
  const sub = await getStripe().subscriptions.retrieve(m.stripeSubscriptionId);
  if (!["active", "trialing", "past_due"].includes(sub.status)) throw new SelfServiceError("not_active");
  return sub;
}

async function releaseSchedule(sub: Stripe.Subscription): Promise<void> {
  const id = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id;
  if (!id) return;
  const schedule = await getStripe().subscriptionSchedules.retrieve(id);
  if (schedule.status === "active" || schedule.status === "not_started") {
    await getStripe().subscriptionSchedules.release(id);
  }
}

/**
 * Switches plan and/or day from the next renewal. Re-scheduling replaces
 * any change already pending; choosing the current plan and day just
 * cancels the pending change.
 */
export async function scheduleChangeAtRenewal(m: MemberView, plan: MembershipTier, day: MembershipDay): Promise<{ from: string } | { cleared: true }> {
  const sub = await currentSubscription(m);
  if (sub.cancel_at_period_end) throw new SelfServiceError("cancelling");
  if (plan === m.plan && day === m.day) {
    await releaseSchedule(sub);
    return { cleared: true };
  }
  if (day !== m.day) {
    if (await isDayPaused(day)) throw new SelfServiceError("day_paused");
    const from = m.periodEnd ? addDays(m.periodEnd, 1) : getClubToday().dateKey;
    if (!(await dayHasRoom(day, from))) throw new SelfServiceError("sessions_full");
  }
  const stripe = getStripe();
  const newPrice = await resolvePriceId(plan, day);
  let scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id;
  if (!scheduleId) {
    scheduleId = (await stripe.subscriptionSchedules.create({ from_subscription: sub.id })).id;
  }
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const now = Math.floor(Date.now() / 1000);
  const currentPhase =
    schedule.phases.find((p) => p.start_date <= now && p.end_date > now) ?? schedule.phases[0];
  const currentItems = currentPhase.items.map((it) => ({
    price: typeof it.price === "string" ? it.price : it.price.id,
    quantity: it.quantity ?? 1,
  }));
  await stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: "release",
    phases: [
      {
        items: currentItems,
        start_date: currentPhase.start_date,
        end_date: currentPhase.end_date,
        metadata: { ...(sub.metadata ?? {}) },
        ...(currentPhase.trial_end ? { trial_end: currentPhase.trial_end } : {}),
      },
      {
        items: [{ price: newPrice, quantity: 1 }],
        duration: { interval: "week", interval_count: plan === "quarterly" ? 12 : 4 },
        proration_behavior: "none",
        metadata: { ...(sub.metadata ?? {}), plan, day },
      },
    ],
  });
  return { from: isoDate(currentPhase.end_date) ?? "" };
}

export async function cancelPendingChange(m: MemberView): Promise<void> {
  await releaseSchedule(await currentSubscription(m));
}

let feedbackReady: Promise<void> | null = null;
async function ensureFeedbackTable() {
  if (!feedbackReady) {
    feedbackReady = onceThisDeploy("cancellation_feedback", async () => {
      await ensurePlayerTables();
      await sql`
        CREATE TABLE IF NOT EXISTS cancellation_feedback (
          id SERIAL PRIMARY KEY,
          player_id INT REFERENCES players(id) ON DELETE SET NULL,
          membership_id INT,
          action TEXT NOT NULL,
          reason TEXT NOT NULL,
          comment TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
    }).catch((e) => {
      feedbackReady = null;
      throw e;
    });
  }
  return feedbackReady;
}

export async function recordFeedback(playerId: number, membershipId: number, action: "downgrade" | "cancel", reason: string, comment: string | null): Promise<void> {
  await ensureFeedbackTable();
  await sql`
    INSERT INTO cancellation_feedback (player_id, membership_id, action, reason, comment)
    VALUES (${playerId}, ${membershipId}, ${action}, ${reason.slice(0, 60)}, ${comment?.slice(0, 1000) ?? null});
  `;
}

export async function listRecentFeedback(limit = 30): Promise<{ email: string; name: string; action: string; reason: string; comment: string | null; createdAt: string }[]> {
  await ensureFeedbackTable();
  const { rows } = await sql`
    SELECT f.action, f.reason, f.comment, f.created_at, p.email, trim(p.first_name || ' ' || p.last_name) AS name
    FROM cancellation_feedback f LEFT JOIN players p ON p.id = f.player_id
    ORDER BY f.created_at DESC LIMIT ${limit};
  `;
  return rows.map((r) => ({
    email: (r.email as string) ?? "",
    name: (r.name as string) ?? "",
    action: r.action as string,
    reason: r.reason as string,
    comment: (r.comment as string | null) ?? null,
    createdAt: new Date(r.created_at as Date).toISOString(),
  }));
}

const PLAN_LABEL: Record<MembershipTier, string> = { monthly: "Monthly", quarterly: "Quarterly" };
const DAY_LABEL: Record<MembershipDay, string> = { friday: "Friday", wednesday: "Wednesday" };

export function formatNzDate(dateKey: string | null): string {
  if (!dateKey) return "";
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-NZ", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Turns off auto-renew; access continues to the end of the paid period. */
export async function cancelAtPeriodEnd(player: Player, m: MemberView, reason: string, comment: string | null): Promise<string | null> {
  const sub = await currentSubscription(m);
  await releaseSchedule(sub);
  await getStripe().subscriptions.update(sub.id, { cancel_at_period_end: true });
  await sql`UPDATE memberships SET cancel_at_period_end = TRUE WHERE id = ${m.id};`;
  await recordFeedback(player.id, m.id, "cancel", reason, comment);
  const end = formatNzDate(m.periodEnd);
  const vi = player.lang === "vi";
  await Promise.allSettled([
    sendPlayerNoticeEmail({
      to: player.email,
      subject: vi ? "Đã tắt tự động gia hạn thành viên Three Wolves" : "Your Three Wolves membership won't renew",
      heading: vi ? "Đã tắt tự động gia hạn" : "Auto-renew is off",
      lines: vi
        ? [`Thẻ thành viên ${PLAN_LABEL[m.plan]} (${DAY_LABEL[m.day]}) của bạn sẽ kết thúc vào ${end}. Bạn sẽ không bị trừ tiền nữa.`, "Đổi ý? Bạn có thể bật lại bất cứ lúc nào trước ngày đó trong hồ sơ."]
        : [`Your ${PLAN_LABEL[m.plan]} (${DAY_LABEL[m.day]}) membership will end on ${end}. You won't be charged again.`, "Changed your mind? You can resume it any time before then from your profile."],
      cta: { label: vi ? "Mở thẻ thành viên" : "Open my membership", path: "/profile/membership" },
    }),
    sendAdminAlertEmail({
      subject: `Membership cancelling: ${player.firstName} ${player.lastName}`,
      heading: "A member turned off auto-renew",
      lines: [
        `${player.firstName} ${player.lastName} (${player.email}) — ${PLAN_LABEL[m.plan]}, ${DAY_LABEL[m.day]}. Ends ${end}.`,
        `Reason: ${reason}${comment ? ` — “${comment}”` : ""}`,
      ],
      cta: { label: "Message them", path: "/admin/inbox" },
    }),
  ]);
  return m.periodEnd;
}

export async function resumeMembership(m: MemberView): Promise<void> {
  if (!m.stripeSubscriptionId) throw new SelfServiceError("not_recurring");
  await getStripe().subscriptions.update(m.stripeSubscriptionId, { cancel_at_period_end: false });
  await sql`UPDATE memberships SET cancel_at_period_end = FALSE WHERE id = ${m.id};`;
}

// ---------------------------------------------------------------------------
// One-time memberships
// ---------------------------------------------------------------------------

/** Pays for the next period of a one-time membership (like the emailed renewal link). */
export async function startOneTimeRenewal(player: Player, m: MemberView, plan: MembershipTier): Promise<{ clientSecret: string; periodStart: string; periodEnd: string; priceNzd: number }> {
  if (m.recurring || !m.periodEnd) throw new SelfServiceError("not_one_time");
  if (await getActiveRenewalOf(m.id)) throw new SelfServiceError("already_renewed");
  const assignment = await assignAndReserveMembershipAccessStart(
    plan,
    m.day,
    { email: player.email, firstName: player.firstName, lastName: player.lastName, phone: player.phone, recurring: false },
    undefined,
    { membershipId: m.id, periodEnd: m.periodEnd },
  );
  if (assignment.blocked) throw new SelfServiceError(assignment.reason === "already_member" ? "already_renewed" : assignment.reason);
  const pi = await createOneTimeMembershipPaymentIntent({
    plan,
    day: m.day,
    firstName: player.firstName,
    lastName: player.lastName,
    email: player.email,
    phone: player.phone,
    renewalOf: m.id,
  });
  if (!pi.client_secret) throw new SelfServiceError("payment_failed");
  await attachStripeIdToMembership(assignment.membershipId, { stripePaymentIntentId: pi.id });
  return { clientSecret: pi.client_secret, periodStart: assignment.periodStart, periodEnd: assignment.periodEnd, priceNzd: oneTimeMembershipPriceCents(plan) / 100 };
}

/**
 * One-time → auto-renew, step 1: save a card (SetupIntent). Nothing is
 * charged and nothing is booked yet.
 */
export async function createAutoRenewSetup(player: Player): Promise<{ clientSecret: string }> {
  const customerId = await stripeCustomerFor(player, true);
  if (!customerId) throw new SelfServiceError("payment_failed");
  const si = await getStripe().setupIntents.create({
    customer: customerId,
    usage: "off_session",
    automatic_payment_methods: { enabled: true },
    metadata: { type: "membership_autorenew", playerId: String(player.id) },
  });
  if (!si.client_secret) throw new SelfServiceError("payment_failed");
  return { clientSecret: si.client_secret };
}

/**
 * Step 2, once the card is saved: a subscription whose first charge is on
 * the first play day after the current one-time membership ends. The new
 * membership row starts with an empty window (period_end = start − 1), so
 * that first renewal invoice extends it by exactly one cycle
 * (applyMembershipRenewal).
 */
export async function confirmAutoRenewFromOneTime(
  player: Player,
  m: MemberView,
  plan: MembershipTier,
  setupIntentId: string,
): Promise<{ periodStart: string }> {
  if (m.recurring || !m.periodEnd) throw new SelfServiceError("not_one_time");
  if (await getActiveRenewalOf(m.id)) throw new SelfServiceError("already_renewed");
  const stripe = getStripe();
  const customerId = await stripeCustomerFor(player);
  const si = await stripe.setupIntents.retrieve(setupIntentId);
  const siCustomer = typeof si.customer === "string" ? si.customer : si.customer?.id;
  if (si.status !== "succeeded" || !customerId || siCustomer !== customerId || !si.payment_method) {
    throw new SelfServiceError("card_not_saved");
  }
  const paymentMethod = typeof si.payment_method === "string" ? si.payment_method : si.payment_method.id;

  const assignment = await assignAndReserveMembershipAccessStart(
    plan,
    m.day,
    { email: player.email, firstName: player.firstName, lastName: player.lastName, phone: player.phone, recurring: true },
    undefined,
    { membershipId: m.id, periodEnd: m.periodEnd },
  );
  if (assignment.blocked) throw new SelfServiceError(assignment.reason === "already_member" ? "already_renewed" : assignment.reason);

  // Charge on the morning of the first play day of the new window (NZ).
  const startsAt = Math.floor(new Date(`${assignment.periodStart}T08:00:00+13:00`).getTime() / 1000);
  const trialEnd = Math.max(startsAt, Math.floor(Date.now() / 1000) + 3600);
  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: await resolvePriceId(plan, m.day) }],
    default_payment_method: paymentMethod,
    trial_end: trialEnd,
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    description: `Three Wolves — ${PLAN_LABEL[plan]} Membership (${DAY_LABEL[m.day]})`,
    metadata: { plan, day: m.day, firstName: player.firstName, lastName: player.lastName, email: player.email, renewalOf: String(m.id) },
  });
  await attachStripeIdToMembership(assignment.membershipId, { stripeSubscriptionId: sub.id });
  await sql`
    UPDATE memberships SET period_end = period_start - 1, renewal_of = ${m.id}, status = 'active'
    WHERE id = ${assignment.membershipId};
  `;
  return { periodStart: assignment.periodStart };
}

/**
 * Copies plan/day from a subscription's metadata onto its membership row
 * (set by a scheduled change when the new phase starts). Called from the
 * Stripe webhook for subscription updates and before applying a renewal, so
 * the renewal adds the right cycle length whichever event arrives first.
 */
export async function syncPlanFromSubscriptionMetadata(subscriptionId: string, metadata: Record<string, string> | null | undefined): Promise<void> {
  const plan = metadata?.plan;
  const day = metadata?.day;
  if (plan !== "monthly" && plan !== "quarterly") return;
  if (day !== "friday" && day !== "wednesday") return;
  await sql`
    UPDATE memberships SET plan = ${plan}, day = ${day}
    WHERE stripe_subscription_id = ${subscriptionId} AND (plan <> ${plan} OR day <> ${day});
  `;
}

export { MEMBERSHIP_CYCLE_DAYS };
export type { MembershipRow };
