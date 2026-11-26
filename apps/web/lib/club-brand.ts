// The club's name, locale and membership days, for wording (Track A step A2,
// build plan §6.2.4 layer 3: "nothing club-specific is written in admin
// code"). Like lib/money.ts for the currency: one place answers, today with
// the built-in values (lib/constants.ts), so pages, emails, exports and
// payment descriptions stop typing "Three Wolves", "en-NZ", "NZD" and
// "Friday" themselves. tests/club-literals.test.ts fails on a new copy.
//
// Synchronous on purpose: client components use it too. When a deployment
// serves more than one club (audit C7), this file and lib/money.ts are the
// two places that take the club from the request.
import {
  CLUB_CONTACT_EMAIL,
  CLUB_CURRENCY,
  CLUB_EMAIL_LOGO_DARK_PATH,
  CLUB_EMAIL_LOGO_PATH,
  CLUB_LOCALE,
  CLUB_NAME,
  CLUB_PLACE,
  CLUB_SHORT_NAME,
  CLUB_SLUG,
  CLUB_TIME_ZONE,
  MEMBERSHIP_ACCESS_DAYS,
  type MembershipDay,
} from "./constants.ts";

/** The club's full name ("… Badminton Club"): letterheads, report headers, file authors. */
export function clubName(): string {
  return CLUB_NAME;
}

/** The club's short name: the admin's top-left corner, email subjects, payment descriptions. */
export function clubShortName(): string {
  return CLUB_SHORT_NAME;
}

/** Where the club is, as an email footer says it ("Christchurch, NZ"). */
export function clubPlace(): string {
  return CLUB_PLACE;
}

/** The club's public inbox: shown to members, and where alerts go when no other address is set. */
export function clubContactEmail(): string {
  return CLUB_CONTACT_EMAIL;
}

/** The club's logo for emails, as a path under the site ("/uploads/…"); `dark` is the one for dark backgrounds. */
export function clubEmailLogoPath(dark = false): string {
  return dark ? CLUB_EMAIL_LOGO_DARK_PATH : CLUB_EMAIL_LOGO_PATH;
}

/** An amount in major units with the currency code, as receipts and emails write it: "NZD $33.00". */
export function clubAmountWithCode(major: number): string {
  return `${CLUB_CURRENCY} ${new Intl.NumberFormat(clubLocale(), { style: "currency", currency: CLUB_CURRENCY }).format(major)}`;
}

/** The club's slug, for file names ("<slug>-financials.xlsx"). */
export function clubSlug(): string {
  return CLUB_SLUG;
}

/** The locale the club's dates and numbers are written in. */
export function clubLocale(): string {
  return CLUB_LOCALE;
}

/** The club's currency code as people read it ("NZD"), for field labels. */
export function clubCurrencyCode(): string {
  return CLUB_CURRENCY;
}

/** A round amount in major units, written for a sentence: "$0", "$1,000,000". */
export function clubRoundAmount(major: number): string {
  return new Intl.NumberFormat(clubLocale(), { style: "currency", currency: CLUB_CURRENCY, maximumFractionDigits: 0 }).format(major);
}

/** A date in the club's locale. Pass `timeZone: "UTC"` for a calendar day key, nothing for an instant (the club's time zone). */
export function clubDate(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleDateString(clubLocale(), { timeZone: CLUB_TIME_ZONE, ...options });
}

/** A date and time in the club's locale and time zone. */
export function clubDateTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleString(clubLocale(), { timeZone: CLUB_TIME_ZONE, ...options });
}

// ── Membership days ─────────────────────────────────────────────────────────

/** The weekdays a membership can be for, in the club's order. */
export function membershipDays(): MembershipDay[] {
  return [...MEMBERSHIP_ACCESS_DAYS];
}

/** A posted value as one of the club's membership days (the first one when it isn't). */
export function parseMembershipDay(value: unknown): MembershipDay {
  const days = membershipDays();
  return days.find((d) => d === value) ?? days[0];
}

/** "Friday" */
export function weekdayName(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/** "Fridays" */
export function weekdayPlural(day: string): string {
  return `${weekdayName(day)}s`;
}

/** "Friday and Wednesday" */
export function membershipDayList(): string {
  const names = membershipDays().map(weekdayName);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ── Payment descriptions (what the member sees on a receipt or statement) ───

/** "Three Wolves — Monthly Membership (Friday)" */
export function membershipDescription(plan: "monthly" | "quarterly", day: string): string {
  return `${clubShortName()} — ${plan === "monthly" ? "Monthly" : "Quarterly"} Membership (${weekdayName(day)})`;
}

/** "Three Wolves shop — Club tee (M) — cash" */
export function shopDescription(items: string, how?: string): string {
  return `${clubShortName()} shop — ${items}${how ? ` — ${how}` : ""}`;
}
