import { BOOKING_LOCK_DAYS } from "./constants";

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

export function isWithinBookingLock(
  sessionDate: Date,
  today: Date = new Date(),
): boolean {
  const diff = startOfDay(sessionDate).getTime() - startOfDay(today).getTime();
  return diff >= 0 && diff < BOOKING_LOCK_DAYS * 86400000;
}

export function isBookable(sessionDate: Date, today: Date = new Date()): boolean {
  const session = startOfDay(sessionDate);
  const now = startOfDay(today);
  if (session < now) return false;
  return !isWithinBookingLock(session, today);
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

const CLUB_TIME_ZONE = "Pacific/Auckland";

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
