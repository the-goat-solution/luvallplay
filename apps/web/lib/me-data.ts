import { sql } from "./database";
import { addDays, getSpotsAndHeadcountForDates, listSessionsInRange } from "./db";
import { getClubToday, isBookable, isDatePaused, getMembershipDayForDate } from "./dates";
import { clubClock } from "./club";
import type { Weekday } from "./constants";
import type { MemberView } from "./membership-self-service";
import { listAbsences } from "./stats-db";
import type { CalDay } from "@/components/profile/membership/PlayCalendar";

// Data for the Me page (Account + Membership merged, build plan §2.2).

const CALENDAR_DAYS = 35;

function covers(m: MemberView | null, date: string): boolean {
  if (!m || getMembershipDayForDate(date) !== m.day) return false;
  if (m.periodStart && date < m.periodStart) return false;
  if (m.periodEnd && date <= m.periodEnd) return true;
  return m.recurring && !m.cancelAtPeriodEnd;
}

/** The next five weeks of play days, as this player sees them. */
export async function calendarFor(email: string, m: MemberView | null, pausedDays: Weekday[]): Promise<CalDay[]> {
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
  const clock = await clubClock();
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
      bookable: isBookable(new Date(y, mo - 1, d), now, clock),
      included: covers(m, s.date),
      absent: absent.has(s.date),
      booked: booked.has(s.date),
    };
  });
}

/** "Next up": the first play day this player is in (membership day or a booked casual spot). */
export function nextUp(days: CalDay[]): CalDay | null {
  return days.find((d) => !d.paused && (d.booked || d.included)) ?? null;
}
