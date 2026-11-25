// The players' app membership self-service and casual booking
// (/api/v1/app/clubs/{club}/membership…, /me/book). Every change is the
// website's own function (lib/membership-self-service.ts, lib/stripe.ts,
// lib/db.ts). Joining and booking repeat the website's routes step for step
// (app/api/create-subscription and app/api/create-payment-intent): keep them
// in step with those files, down to the Stripe description and metadata
// (the subscription itself is lib/stripe.ts createMembershipSubscription).
import { revalidatePath } from "next/cache";
import type { BodyOf, ResponseOf } from "@luvallplay/api/contract";
import { allowedOrigins } from "./app-api";
import type { ClubConfig } from "./club-config";
import { clubPrices, membershipStatus } from "./app-me";
import { clubClock } from "./club";
import { CASUAL_PRICE_CENTS, CLUB_CURRENCY } from "./constants";
import { assignAndReserveMembershipAccessStart, attachStripeIdToMembership, getAvailableSpots, isRegistrationLocked } from "./db";
import { getClubToday } from "./dates";
import { getPausedDays, isDayPaused, isSessionDatePaused } from "./day-requests";
import { getSiteUrl } from "./email-layout";
import {
  SelfServiceError,
  cancelAtPeriodEnd,
  cancelPendingChange,
  cardUpdatePortalUrl,
  confirmAutoRenewFromOneTime,
  createAutoRenewSetup,
  getBilling,
  getCurrentMembership,
  playDaysLeft,
  recordFeedback,
  resumeMembership,
  scheduleChangeAtRenewal,
  startOneTimeRenewal,
} from "./membership-self-service";
import { payments } from "./payments";
import type { Player } from "./player-db";
import { assertSessionBookable } from "./security";
import { getQuickStats } from "./stats-db";
import { createMembershipSubscription, createOneTimeMembershipPaymentIntent } from "./stripe";

type Fail = { ok: false; status: number; code: string };
const fail = (status: number, code: string): Fail => ({ ok: false, status, code });
const DAYS = ["friday", "wednesday"] as const;

export async function membershipState(player: Player, club: ClubConfig): Promise<ResponseOf<"membership.state">> {
  const [m, paused, quick, clock] = await Promise.all([getCurrentMembership(player.email), getPausedDays(), getQuickStats(player), clubClock()]);
  const today = getClubToday(new Date(), clock).dateKey;
  const prices = clubPrices();
  return {
    membership: m
      ? {
          plan: m.plan,
          day: m.day,
          status: membershipStatus(m, today),
          periodStart: m.periodStart,
          periodEnd: m.periodEnd,
          recurring: m.recurring,
          cancelAtPeriodEnd: m.cancelAtPeriodEnd,
          method: m.method,
          manageable: m.recurring && !m.cancelAtPeriodEnd && Boolean(m.stripeSubscriptionId),
          continuation: m.continuation,
          daysLeft: await playDaysLeft(m),
        }
      : null,
    prices: { monthly: prices.monthly, quarterly: prices.quarterly },
    days: DAYS.filter((d) => club.memberships.days.includes(d)),
    pausedDays: paused,
    streak: quick.streak,
    monthRank: quick.monthRank,
  };
}

export async function billingFor(player: Player) {
  return getBilling(player, await getCurrentMembership(player.email));
}

/** One change, as the website's /api/profile/membership/action. */
export async function membershipAction(player: Player, body: BodyOf<"membership.action">): Promise<({ ok: true } & Record<string, unknown>) | Fail> {
  try {
    if (body.action === "autorenew_setup") return { ok: true, ...(await createAutoRenewSetup(player)) };
    const m = await getCurrentMembership(player.email);
    if (!m) return fail(404, "no_membership");
    let result: Record<string, unknown> = {};
    switch (body.action) {
      case "change":
        // A downgrade goes through the extra steps, with a reason.
        if (m.plan === "quarterly" && body.plan === "monthly") {
          if (!body.reason) return fail(400, "reason_required");
          await recordFeedback(player.id, m.id, "downgrade", body.reason, body.comment ?? null);
        }
        result = await scheduleChangeAtRenewal(m, body.plan, body.day);
        break;
      case "cancel_change":
        await cancelPendingChange(m);
        break;
      case "cancel":
        result = { endsOn: await cancelAtPeriodEnd(player, m, body.reason, body.comment ?? null) };
        break;
      case "resume":
        await resumeMembership(m);
        break;
      case "renew":
        result = await startOneTimeRenewal(player, m, body.plan);
        break;
      case "autorenew_confirm":
        result = await confirmAutoRenewFromOneTime(player, m, body.plan, body.setupIntentId);
        break;
    }
    try {
      revalidatePath("/profile");
    } catch {
      // Outside a request (tests).
    }
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof SelfServiceError) return fail(409, err.code);
    throw err;
  }
}

/** Stripe's page for updating the card, returning to the app (when called from it) or the website. */
export async function portalUrl(player: Player, request: Request): Promise<string> {
  const origin = request.headers.get("origin");
  const back = origin && allowedOrigins().includes(origin) ? `${origin}/membership?card=updated` : `${getSiteUrl()}/profile?card=updated`;
  return cardUpdatePortalUrl(player, back);
}

/** Joining, as the website's /api/create-subscription for a signed-in player: capacity first, then Stripe. */
export async function joinMembership(player: Player, body: BodyOf<"membership.join">): Promise<{ ok: true; clientSecret: string; periodStart: string } | Fail> {
  const who = { email: player.email, firstName: player.firstName, lastName: player.lastName, phone: player.phone ?? "" };
  if (await isDayPaused(body.day)) return fail(409, "day_paused");
  const result = await assignAndReserveMembershipAccessStart(body.plan, body.day, { ...who, phone: who.phone || null, recurring: body.recurring });
  if (result.blocked) return fail(409, result.reason);
  const periodStart = result.periodStart ?? getClubToday(new Date(), await clubClock()).dateKey;

  if (!body.recurring) {
    const paymentIntent = await createOneTimeMembershipPaymentIntent({ plan: body.plan, day: body.day, ...who });
    if (!paymentIntent.client_secret) return fail(500, "failed");
    await attachStripeIdToMembership(result.membershipId, { stripePaymentIntentId: paymentIntent.id });
    return { ok: true, clientSecret: paymentIntent.client_secret, periodStart };
  }

  const sub = await createMembershipSubscription({ plan: body.plan, day: body.day, ...who });
  if (!sub) return fail(500, "failed");
  await attachStripeIdToMembership(result.membershipId, { stripeSubscriptionId: sub.subscriptionId });
  return { ok: true, clientSecret: sub.clientSecret, periodStart };
}

/** A casual spot, as the website's /api/create-payment-intent for a signed-in player; the webhook books it once paid. */
export async function bookCasual(player: Player, date: string): Promise<{ ok: true; clientSecret: string; periodStart: null } | Fail> {
  try {
    await assertSessionBookable(date);
  } catch {
    return fail(409, "not_bookable");
  }
  if (await isSessionDatePaused(date)) return fail(409, "day_paused");
  if (await isRegistrationLocked(date)) return fail(409, "locked");
  if ((await getAvailableSpots(date)) <= 0) return fail(409, "full");
  const payment = await payments().createPayment({
    amount: CASUAL_PRICE_CENTS,
    currency: CLUB_CURRENCY,
    metadata: { type: "casual", sessionDate: date, firstName: player.firstName, lastName: player.lastName, email: player.email, phone: player.phone ?? "" },
    receiptEmail: player.email,
    description: `Casual session — ${date}`,
    idempotencyKey: `casual-${date}-${player.email}-${Date.now()}`,
  });
  if (!payment.clientSecret) return fail(500, "failed");
  return { ok: true, clientSecret: payment.clientSecret, periodStart: null };
}
