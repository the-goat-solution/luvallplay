import { BOOKING_LOCK_DAYS } from "./constants";

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function getNextFriday(from: Date): Date {
  const d = startOfDay(from);
  const day = d.getDay();
  const diff = (5 - day + 7) % 7;
  if (diff > 0) d.setDate(d.getDate() + diff);
  return d;
}

export function getUpcomingFridays(from: Date, n: number): Date[] {
  const fridays: Date[] = [];
  let d = getNextFriday(from);
  for (let i = 0; i < n; i++) {
    fridays.push(new Date(d));
    d = new Date(d);
    d.setDate(d.getDate() + 7);
  }
  return fridays;
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
