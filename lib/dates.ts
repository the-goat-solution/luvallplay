import { BOOKING_CUTOFF_HOUR, BOOKING_WINDOW_DAYS } from "./constants";

const CLUB_TIME_ZONE = "Pacific/Auckland";

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateKeyToUTCms(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// Reads the current date/time as observed in the club's time zone, since
// bookings close at a wall-clock time (5PM) at the venue regardless of
// where the browser or server happens to be running.
function getClubNow(now: Date): { dateKey: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour) % 24,
  };
}

function bookingWindowDiffDays(sessionDate: Date, now: Date): number {
  const sessionKey = toDateKey(sessionDate);
  const club = getClubNow(now);
  return (
    (dateKeyToUTCms(sessionKey) - dateKeyToUTCms(club.dateKey)) / 86400000
  );
}

// Bookable from BOOKING_WINDOW_DAYS before the session up until
// BOOKING_CUTOFF_HOUR (club local time) on the day of the session itself.
export function isBookable(sessionDate: Date, today: Date = new Date()): boolean {
  const diffDays = bookingWindowDiffDays(sessionDate, today);
  if (diffDays < 0 || diffDays > BOOKING_WINDOW_DAYS) return false;
  if (diffDays === 0) {
    return getClubNow(today).hour < BOOKING_CUTOFF_HOUR;
  }
  return true;
}

// A session day that's visible on the calendar but not currently bookable
// (registration hasn't opened yet, or the same-day cutoff has passed).
export function isWithinBookingLock(
  sessionDate: Date,
  today: Date = new Date(),
): boolean {
  const diffDays = bookingWindowDiffDays(sessionDate, today);
  if (diffDays < 0) return false;
  return !isBookable(sessionDate, today);
}

export function formatDateLong(d: Date, lang: "en" | "vi"): string {
  const monthsEn = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthsVi = [
    "tháng 1",
    "tháng 2",
    "tháng 3",
    "tháng 4",
    "tháng 5",
    "tháng 6",
    "tháng 7",
    "tháng 8",
    "tháng 9",
    "tháng 10",
    "tháng 11",
    "tháng 12",
  ];
  if (lang === "vi")
    return `${d.getDate()} ${monthsVi[d.getMonth()]} ${d.getFullYear()}`;
  return `${monthsEn[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatEventTimeRange(start: string, end: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: CLUB_TIME_ZONE,
  };
  const startLabel = new Intl.DateTimeFormat("en-NZ", opts).format(new Date(start));
  if (!end) return startLabel;
  const endLabel = new Intl.DateTimeFormat("en-NZ", opts).format(new Date(end));
  return `${startLabel} – ${endLabel}`;
}

export function getDayName(d: Date, lang: "en" | "vi"): string {
  const en = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const vi = [
    "Chủ Nhật",
    "Thứ Hai",
    "Thứ Ba",
    "Thứ Tư",
    "Thứ Năm",
    "Thứ Sáu",
    "Thứ Bảy",
  ];
  return lang === "vi" ? vi[d.getDay()] : en[d.getDay()];
}
