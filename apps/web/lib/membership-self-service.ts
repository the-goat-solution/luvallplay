import { clubClock } from "./club";
import { paymentMethodFromRef, type PaymentMethod } from "./offline-payment";
import { sql } from "./database";
import { addDays, assignAndReserveMembershipAccessStart, attachStripeIdToMembership, getActiveRenewalOf, getSpotsAndHeadcountForDates, listSessionsInRange, type MembershipRow } from "./db";
import { isDayPaused } from "./day-requests";
import { getClubToday } from "./dates";
import { customersOf, payments, subscriptionsOf, type Subscription } from "./payments";
import { createOneTimeMembershipPayment, membershipDescription, oneTimeMembershipPriceCents, resolvePriceId } from "./payments/membership";
import { type MembershipDay, type MembershipTier } from "./constants";
import { type Player } from "./player-db";
import { sendAdminAlertEmail, sendPlayerNoticeEmail } from "./player-email";
import { clubMajor } from "./money";

// Self-service membership management from the profile's Membership tab.
//
// Every call to the payment provider goes through the payments interface
// (lib/payments): customers, cards and subscriptions. A club whose provider
// has no subscriptions gets PaymentError("unsupported") from the auto-renew
// changes; tests/stripe-requests.test.ts pins what Stripe is sent.
//
// Plan and day changes take effect at the NEXT renewal (the provider's
// scheduleChange: the current period runs out, then the new price starts
// with no proration). The change carries the new plan/day as subscription
// metadata, which the webhook copies onto the membership row — see
// syncPlanFromSubscriptionMetadata.

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
  const today = getClubToday(new Date(), await clubClock()).dateKey;
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
  const today = getClubToday(new Date(), await clubClock()).dateKey;
  const from = m.periodStart && m.periodStart > today ? m.periodStart : today;
  const sessions = await listSessionsInRange(from, m.periodEnd);
  const dow = m.day === "friday" ? 5 : 3;
  return sessions.filter((s) => new Date(`${s.date}T00:00:00Z`).getUTCDay() === dow).length;
}

// ---------------------------------------------------------------------------
// Stripe customer + billing details
// ---------------------------------------------------------------------------

export async function stripeCustomerFor(player: Player, create = false): Promise<string | null> {
  if (!payments().configured()) return null;
  if (player.stripeCustomerId) return player.stripeCustomerId;
  const customers = customersOf(payments());
  let id = await customers.find(player.email);
  if (!id && create) {
    id = await customers.create({
      email: player.email,
      name: `${player.firstName} ${player.lastName}`.trim() || undefined,
      phone: player.phone ?? undefined,
    });
  }
  if (id) {
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

/** The club's date for a provider time (ms since the epoch). */
function isoDate(at: number | null | undefined): string | null {
  return at ? getClubToday(new Date(at)).dateKey : null;
}

export async function getBilling(player: Player, m: MemberView | null): Promise<Billing> {
  const empty: Billing = { card: null, nextCharge: null, pendingChange: null, receipts: [] };
  const customerId = await stripeCustomerFor(player);
  if (!customerId) return empty;
  const customers = customersOf(payments());
  const billing: Billing = { ...empty };

  const { paymentMethod, receipts } = await customers.billing(customerId);
  billing.receipts = receipts.map((r) => ({
    date: isoDate(r.paidAt) ?? "",
    amountCents: r.amount,
    description: r.description ?? "Three Wolves",
    url: r.url,
    refunded: r.refunded,
  }));

  let pm = paymentMethod;

  if (m?.stripeSubscriptionId) {
    const sub = await subscriptionsOf(payments()).get(m.stripeSubscriptionId, { billing: true });
    if (sub.paymentMethod) pm = sub.paymentMethod;
    let amount = sub.amount ?? 0;
    const md = sub.pendingChange?.metadata ?? {};
    if (sub.pendingChange && (md.plan === "monthly" || md.plan === "quarterly") && (md.day === "friday" || md.day === "wednesday")) {
      billing.pendingChange = { plan: md.plan, day: md.day, from: isoDate(sub.pendingChange.startsAt) ?? "" };
      amount = oneTimeMembershipPriceCents(md.plan);
    }
    if (!sub.cancelAtPeriodEnd && sub.nextChargeAt && sub.status !== "canceled") {
      billing.nextCharge = { date: isoDate(sub.nextChargeAt) ?? "", amountCents: amount };
    }
  }
  // Nothing set as the default: any card they've saved. (A default that isn't a card shows no card.)
  billing.card = pm ? pm.card : await customers.savedCard(customerId);
  return billing;
}

/** The provider's hosted page, limited to updating the card (no cancel button). */
export async function cardUpdatePortalUrl(player: Player, returnUrl: string): Promise<string> {
  const customerId = await stripeCustomerFor(player, true);
  if (!customerId) throw new Error("Payments aren't set up");
  return customersOf(payments()).cardUpdateUrl({ customerId, returnUrl });
}

// ---------------------------------------------------------------------------
// Changes at the next renewal
// ---------------------------------------------------------------------------

export class SelfServiceError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
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
  const { spots, miniGame } = await getSpotsAndHeadcountForDates(sessions);
  // A mini game day reports 0 casual spots (its sign-ups are locked), but
  // members are always included in it, so it counts as room for a member.
  return sessions.some((d) => miniGame[d] || (spots[d] ?? 0) > 0);
}

async function currentSubscription(m: MemberView): Promise<Subscription> {
  if (!m.stripeSubscriptionId || !m.recurring) throw new SelfServiceError("not_recurring");
  const sub = await subscriptionsOf(payments()).get(m.stripeSubscriptionId);
  if (!["active", "trialing", "past_due"].includes(sub.status)) throw new SelfServiceError("not_active");
  return sub;
}

/**
 * Switches plan and/or day from the next renewal. Re-scheduling replaces
 * any change already pending; choosing the current plan and day just
 * cancels the pending change.
 */
export async function scheduleChangeAtRenewal(m: MemberView, plan: MembershipTier, day: MembershipDay): Promise<{ from: string } | { cleared: true }> {
  const sub = await currentSubscription(m);
  if (sub.cancelAtPeriodEnd) throw new SelfServiceError("cancelling");
  if (plan === m.plan && day === m.day) {
    await subscriptionsOf(payments()).clearScheduledChange(sub);
    return { cleared: true };
  }
  if (day !== m.day) {
    if (await isDayPaused(day)) throw new SelfServiceError("day_paused");
    const from = m.periodEnd ? addDays(m.periodEnd, 1) : getClubToday(new Date(), await clubClock()).dateKey;
    if (!(await dayHasRoom(day, from))) throw new SelfServiceError("sessions_full");
  }
  const priceId = await resolvePriceId(plan, day);
  const { startsAt } = await subscriptionsOf(payments()).scheduleChange(sub, { price: { priceId }, weeks: plan === "quarterly" ? 12 : 4, metadata: { plan, day } });
  return { from: isoDate(startsAt) ?? "" };
}

export async function cancelPendingChange(m: MemberView): Promise<void> {
  await subscriptionsOf(payments()).clearScheduledChange(await currentSubscription(m));
}

export async function recordFeedback(playerId: number, membershipId: number, action: "downgrade" | "cancel", reason: string, comment: string | null): Promise<void> {
  await sql`
    INSERT INTO cancellation_feedback (player_id, membership_id, action, reason, comment)
    VALUES (${playerId}, ${membershipId}, ${action}, ${reason.slice(0, 60)}, ${comment?.slice(0, 1000) ?? null});
  `;
}

export async function listRecentFeedback(limit = 30): Promise<{ email: string; name: string; action: string; reason: string; comment: string | null; createdAt: string }[]> {
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
  const subscriptions = subscriptionsOf(payments());
  await subscriptions.clearScheduledChange(sub);
  await subscriptions.setCancelAtPeriodEnd(sub.id, true);
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
      cta: { label: vi ? "Mở thẻ thành viên" : "Open my membership", path: "/profile" },
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
  await subscriptionsOf(payments()).setCancelAtPeriodEnd(m.stripeSubscriptionId, false);
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
  const pi = await createOneTimeMembershipPayment({
    plan,
    day: m.day,
    firstName: player.firstName,
    lastName: player.lastName,
    email: player.email,
    phone: player.phone,
    renewalOf: m.id,
  });
  if (!pi.clientSecret) throw new SelfServiceError("payment_failed");
  await attachStripeIdToMembership(assignment.membershipId, { stripePaymentIntentId: pi.id });
  return { clientSecret: pi.clientSecret, periodStart: assignment.periodStart, periodEnd: assignment.periodEnd, priceNzd: clubMajor(oneTimeMembershipPriceCents(plan)) };
}

/**
 * One-time → auto-renew, step 1: save a card (SetupIntent). Nothing is
 * charged and nothing is booked yet.
 */
export async function createAutoRenewSetup(player: Player): Promise<{ clientSecret: string }> {
  const customerId = await stripeCustomerFor(player, true);
  if (!customerId) throw new SelfServiceError("payment_failed");
  const setup = await customersOf(payments()).createCardSetup({ customerId, metadata: { type: "membership_autorenew", playerId: String(player.id) } });
  if (!setup.clientSecret) throw new SelfServiceError("payment_failed");
  return { clientSecret: setup.clientSecret };
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
  // Asked for first, so a provider that can't is refused before the customer is looked up.
  const subscriptions = subscriptionsOf(payments());
  payments().assertReady();
  const customerId = await stripeCustomerFor(player);
  const setup = await customersOf(payments()).getCardSetup(setupIntentId);
  if (!setup.succeeded || !customerId || setup.customerId !== customerId || !setup.paymentMethodId) {
    throw new SelfServiceError("card_not_saved");
  }
  const paymentMethod = setup.paymentMethodId;

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
  const sub = await subscriptions.startLater({
    customerId,
    price: { priceId: await resolvePriceId(plan, m.day) },
    paymentMethodId: paymentMethod,
    firstChargeAt: trialEnd * 1000,
    description: membershipDescription(plan, m.day),
    metadata: { plan, day: m.day, firstName: player.firstName, lastName: player.lastName, email: player.email, renewalOf: String(m.id) },
  });
  await attachStripeIdToMembership(assignment.membershipId, { stripeSubscriptionId: sub.subscriptionId });
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

export type { MembershipRow };
