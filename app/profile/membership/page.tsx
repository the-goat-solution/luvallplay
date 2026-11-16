import { sql } from "@vercel/postgres";
import { getCurrentPlayer } from "@/lib/player-auth";
import { addDays, ensureTables, getSpotsAndHeadcountForDates, listSessionsInRange } from "@/lib/db";
import { getClubToday, isBookable, isDatePaused, getMembershipDayForDate } from "@/lib/dates";
import { getPausedDays } from "@/lib/day-requests";
import { CASUAL_PRICE_CENTS, MONTHLY_PRICE_CENTS, QUARTERLY_PRICE_CENTS, type Weekday } from "@/lib/constants";
import { getCurrentMembership, playDaysLeft, type MemberView } from "@/lib/membership-self-service";
import { getQuickStats, listAbsences } from "@/lib/stats-db";
import { MembershipCard } from "@/components/profile/membership/MembershipCard";
import { JoinPanel } from "@/components/profile/membership/JoinPanel";
import { PlayCalendar, type CalDay } from "@/components/profile/membership/PlayCalendar";
import { ShopSection } from "@/components/profile/shop/ShopSection";
import { listShopProductsForPlayer, listOrdersForPlayer } from "@/lib/shop-db";
import { PT } from "@/components/profile/PT";
import styles from "@/components/profile/profile.module.css";

const CALENDAR_DAYS = 35;

function covers(m: MemberView | null, date: string): boolean {
  if (!m || getMembershipDayForDate(date) !== m.day) return false;
  if (m.periodStart && date < m.periodStart) return false;
  if (m.periodEnd && date <= m.periodEnd) return true;
  return m.recurring && !m.cancelAtPeriodEnd;
}

async function calendarFor(email: string, m: MemberView | null, pausedDays: Weekday[]): Promise<CalDay[]> {
  await ensureTables();
  const today = getClubToday().dateKey;
  const sessions = await listSessionsInRange(today, addDays(today, CALENDAR_DAYS));
  if (sessions.length === 0) return [];
  const dates = sessions.map((s) => s.date);
  const [{ spots, locked }, { rows: bookings }, absences] = await Promise.all([
    getSpotsAndHeadcountForDates(dates),
    sql.query(
      `SELECT session_date::text AS d FROM bookings WHERE lower(trim(email)) = $1 AND status = 'confirmed' AND session_date >= $2::date;`,
      [email, today],
    ),
    listAbsences(email, today),
  ]);
  const booked = new Set(bookings.map((b) => b.d as string));
  const absent = new Set(absences);
  const now = new Date();
  return sessions.map((s) => {
    const [y, mo, d] = s.date.split("-").map(Number);
    return {
      date: s.date,
      startTime: s.eventStartTime,
      endTime: s.eventEndTime,
      location: s.eventLocation,
      spots: spots[s.date] ?? 0,
      closed: Boolean(locked[s.date]),
      paused: isDatePaused(s.date, pausedDays),
      bookable: isBookable(new Date(y, mo - 1, d), now),
      included: covers(m, s.date),
      absent: absent.has(s.date),
      booked: booked.has(s.date),
    };
  });
}

export default async function MembershipPage() {
  const player = await getCurrentPlayer();
  if (!player) return null;
  const hasDb = Boolean(process.env.POSTGRES_URL);
  const [membership, pausedDays] = await Promise.all([
    hasDb ? getCurrentMembership(player.email) : Promise.resolve(null),
    hasDb ? getPausedDays() : Promise.resolve([]),
  ]);
  const [daysLeft, quick, calendar, products, orders] = await Promise.all([
    membership ? playDaysLeft(membership) : Promise.resolve(0),
    getQuickStats(player),
    hasDb ? calendarFor(player.email, membership, pausedDays) : Promise.resolve([]),
    listShopProductsForPlayer(),
    listOrdersForPlayer(player.id),
  ]);
  const prices = { monthly: MONTHLY_PRICE_CENTS / 100, quarterly: QUARTERLY_PRICE_CENTS / 100 };
  const contact = { firstName: player.firstName, lastName: player.lastName, email: player.email, phone: player.phone ?? "" };

  return (
    <>
      <h1 className={styles.pageTitle}>
        <PT k="mem_title" />
      </h1>
      <div className={styles.split}>
        <div className={styles.stack}>
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
        </div>
        <div className={styles.stack}>
          <PlayCalendar days={calendar} player={contact} casualPriceNzd={CASUAL_PRICE_CENTS / 100} />
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <ShopSection products={products} orders={orders} />
      </div>
    </>
  );
}
