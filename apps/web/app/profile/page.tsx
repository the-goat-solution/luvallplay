import { getCurrentPlayer } from "@/lib/player-auth";
import { getPausedDays } from "@/lib/day-requests";
import { CASUAL_PRICE_CENTS, MONTHLY_PRICE_CENTS, QUARTERLY_PRICE_CENTS } from "@/lib/constants";
import { getCurrentMembership, playDaysLeft, type MemberView } from "@/lib/membership-self-service";
import { getQuickStats } from "@/lib/stats-db";
import { listShopProductsForPlayer, listOrdersForPlayer } from "@/lib/shop-db";
import { listThreadsForPlayer } from "@/lib/messages-db";
import { calendarFor, nextUp } from "@/lib/me-data";
import { db } from "@/lib/admin-access";
import { getAccess, hasAdminAccess } from "@/lib/admin-roles";
import { MembershipCard } from "@/components/profile/membership/MembershipCard";
import { JoinPanel } from "@/components/profile/membership/JoinPanel";
import { PlayCalendar } from "@/components/profile/membership/PlayCalendar";
import { ShopSection } from "@/components/profile/shop/ShopSection";
import { WelcomeCard } from "@/components/profile/AccountSections";
import { MeHeader, type MembershipPill } from "@/components/profile/me/MeHeader";
import { NextUpCard } from "@/components/profile/me/NextUpCard";
import { InboxPreview } from "@/components/profile/me/InboxPreview";
import m from "@/components/profile/me/me.module.css";
import { clubMajor } from "@/lib/money";

// Me (home tab): "What's my status, and what's next?" Account and Membership
// in one page (build plan §2.2). Settings are one tap away (⚙), the inbox is
// behind the bell. The home-screen app opens here (manifest start_url), and
// the old /profile/account and /profile/membership redirect here.

function pillFor(mem: MemberView | null): MembershipPill {
  if (!mem) return { kind: "none" };
  if (mem.recurring && !mem.cancelAtPeriodEnd) return { kind: "renews", date: mem.periodEnd };
  const end = mem.continuation?.periodEnd ?? mem.periodEnd;
  return end ? { kind: "ends", date: end } : { kind: "active", date: null };
}

export default async function MePage() {
  const player = await getCurrentPlayer();
  if (!player) return null;
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const [membership, pausedDays, access, threads] = await Promise.all([
    hasDb ? getCurrentMembership(player.email) : Promise.resolve(null),
    hasDb ? getPausedDays() : Promise.resolve([]),
    hasDb ? getAccess(db, player.id, player.email).catch(() => null) : Promise.resolve(null),
    hasDb ? listThreadsForPlayer(player.id) : Promise.resolve([]),
  ]);
  const [daysLeft, quick, calendar, products, orders] = await Promise.all([
    membership ? playDaysLeft(membership) : Promise.resolve(0),
    getQuickStats(player),
    hasDb ? calendarFor(player.email, membership, pausedDays) : Promise.resolve([]),
    listShopProductsForPlayer(),
    listOrdersForPlayer(player.id),
  ]);
  const prices = { monthly: clubMajor(MONTHLY_PRICE_CENTS), quarterly: clubMajor(QUARTERLY_PRICE_CENTS) };
  const contact = { firstName: player.firstName, lastName: player.lastName, email: player.email, phone: player.phone ?? "" };
  const initials = `${player.firstName.trim()[0] ?? player.email[0] ?? "?"}${player.lastName.trim()[0] ?? ""}`.toUpperCase();

  return (
    <>
      <MeHeader
        name={`${player.firstName} ${player.lastName}`.trim() || player.email}
        initials={initials}
        avatarUrl={player.avatarUrl}
        pill={pillFor(membership)}
        threads={threads}
        isAdmin={Boolean(access && hasAdminAccess(access))}
      />
      <div className={m.grid}>
        <div className={m.col}>
          <NextUpCard day={nextUp(calendar)} />
          {membership ? (
            <MembershipCard
              membership={membership}
              daysLeft={daysLeft}
              streak={quick.streak}
              monthRank={quick.monthRank}
              prices={prices}
              pausedDays={pausedDays}
            />
          ) : (
            <JoinPanel prices={prices} pausedDays={pausedDays} player={contact} />
          )}
          <PlayCalendar days={calendar} player={contact} casualPriceNzd={clubMajor(CASUAL_PRICE_CENTS)} />
        </div>
        <div className={m.col}>
          <ShopSection products={products} orders={orders} />
          <InboxPreview threads={threads} />
          {!player.welcomeCardDismissed && <WelcomeCard firstName={player.firstName} />}
        </div>
      </div>
    </>
  );
}
