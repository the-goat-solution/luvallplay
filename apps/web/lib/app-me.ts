// The players' app's Me tab (/api/v1/app/clubs/{club}/me): the same data
// the website's Me page shows (app/profile/page.tsx), from the same
// functions, in the contract's shape (packages/api, "me.home").
//
// What the club has switched off stays out: Memberships off means no
// membership card and no join prices (the data is kept).
import type { MeResponse } from "@luvallplay/api/schemas";
import { CASUAL_PRICE_CENTS, MONTHLY_PRICE_CENTS, QUARTERLY_PRICE_CENTS } from "./constants";
import { clubClock } from "./club";
import type { ClubConfig } from "./club-config";
import { enabledModules } from "./club-modules";
import { sql } from "./database";
import { getClubToday } from "./dates";
import { getPausedDays } from "./day-requests";
import { calendarFor } from "./me-data";
import { getCurrentMembership, playDaysLeft, type MemberView } from "./membership-self-service";
import { listThreadsForPlayer } from "./messages-db";
import type { Player } from "./player-db";
import { getQuickStats } from "./stats-db";

/**
 * What a membership costs and what a casual spot costs, in minor units.
 * One place, so moving prices into the club's settings later changes only
 * this function. Today they are the same constants the website's Me page and
 * the Stripe checkout use.
 */
export function clubPrices(): { monthly: number; quarterly: number; casual: number } {
  return { monthly: MONTHLY_PRICE_CENTS, quarterly: QUARTERLY_PRICE_CENTS, casual: CASUAL_PRICE_CENTS };
}

type MembershipStatus = NonNullable<MeResponse["membership"]>["status"];

/** As the website's membership card words it: payment due, ending, starts soon, or active. */
export function membershipStatus(m: MemberView, today: string): MembershipStatus {
  if (m.status === "past_due") return "past_due";
  if (m.cancelAtPeriodEnd) return "ending";
  if (m.periodStart && m.periodStart > today) return "upcoming";
  return "active";
}

export function initialsOf(p: { firstName: string; lastName: string; email: string }): string {
  return `${p.firstName.trim()[0] ?? p.email[0] ?? "?"}${p.lastName.trim()[0] ?? ""}`.toUpperCase();
}

export async function meHome(player: Player, club: ClubConfig): Promise<MeResponse> {
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const [membership, pausedDays, threads, on, clock] = await Promise.all([
    hasDb ? getCurrentMembership(player.email) : Promise.resolve(null),
    hasDb ? getPausedDays() : Promise.resolve([]),
    hasDb ? listThreadsForPlayer(player.id) : Promise.resolve([]),
    enabledModules(sql),
    clubClock(),
  ]);
  const [daysLeft, quick, calendar] = await Promise.all([
    membership ? playDaysLeft(membership) : Promise.resolve(0),
    getQuickStats(player),
    hasDb ? calendarFor(player.email, membership, pausedDays) : Promise.resolve([]),
  ]);
  const today = getClubToday(new Date(), clock).dateKey;
  const prices = clubPrices();
  const sells = on.has("memberships");

  return {
    player: {
      firstName: player.firstName,
      lastName: player.lastName,
      displayName: player.displayName,
      initials: initialsOf(player),
      avatarUrl: player.avatarUrl,
    },
    membership:
      sells && membership
        ? {
            plan: membership.plan,
            day: membership.day,
            status: membershipStatus(membership, today),
            periodStart: membership.periodStart,
            periodEnd: membership.periodEnd,
            autoRenews: membership.recurring && !membership.cancelAtPeriodEnd,
            method: membership.method,
            daysLeft,
            next: membership.continuation
              ? { plan: membership.continuation.plan, periodStart: membership.continuation.periodStart, periodEnd: membership.continuation.periodEnd }
              : null,
          }
        : null,
    join: sells && !membership ? { monthly: prices.monthly, quarterly: prices.quarterly, days: club.memberships.days } : null,
    casualPrice: prices.casual,
    stats: { streak: quick.streak, monthRank: quick.monthRank },
    calendar,
    inbox: {
      unread: threads.filter((t) => t.unread).length,
      latest: threads.slice(0, 3).map((t) => ({ id: t.id, subject: t.subject, preview: t.preview, unread: t.unread, lastMessageAt: t.lastMessageAt })),
    },
    welcome: !player.welcomeCardDismissed,
  };
}
