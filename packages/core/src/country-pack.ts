// Country packs (build plan §6.9: "Everything that differs by country lives
// in data and small adapters, not in the core"; test plan §3.16).
//
// Pure: no I/O. A pack is data: the currency, time zone, phone format, how
// names are written and searched, the tax and legal position, the payment
// providers and the sport words. The code that needs one of these asks the
// club's pack rather than assuming New Zealand.
//
// A pack can only be chosen for a new club when its whole checklist passes
// (countryPackChecklist): a country whose tax or legal answers are still
// with counsel exists as data, for tests and demo clubs, and can't go live.

import { isRegion, type Region } from "./host-routing.ts";
import { isCurrency } from "./money.ts";
import type { PaymentCapabilities } from "./payments.ts";
import { foldForSearch, foldedIncludes } from "./text-fold.ts";

export type NameOrder = "given-first" | "family-first";

export type PhoneFormat = {
  /** The country calling code, without "+": "84". */
  dial: string;
  /** What a number starts with when dialled inside the country: "0". */
  trunkPrefix: string;
  /** Mobile numbers in E.164, the only numbers we text. */
  mobile: RegExp;
  /** How the digits after the calling code are grouped for display: [3, 3, 3] → "912 345 678". */
  groups: readonly number[];
  /** An example of the national part, for form placeholders. */
  example: string;
};

/** A word for something a sport has; null where the pack has no reviewed wording yet. */
export type SportVocabulary = {
  sport: string;
  court: string;
  game: string;
  match: string;
  singles: string;
  doubles: string;
  mixedDoubles: string | null;
};

export type PackPaymentProvider = { id: string; kind: "online" | "bank-transfer"; capabilities: PaymentCapabilities };

export type CountryPack = {
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  name: string;
  /** The region clubs in this country live in (§6.9). */
  region: string;
  /** ISO 4217. Its exponent comes from ./money.ts. */
  currency: string;
  timezone: string;
  /** The first language is the default for a new club. */
  languages: readonly string[];
  phone: PhoneFormat;
  names: {
    order: NameOrder;
    /** Search compares names without accents ("nguyen" finds "Nguyễn"). */
    accentInsensitiveSearch: boolean;
  };
  tax: {
    name: string;
    /** Percent, or null until it is decided. */
    standardRate: number | null;
    /** Who confirmed the tax and invoice rules, and when. Null: not confirmed. */
    confirmed: string | null;
    notes: string;
  };
  legal: {
    /** Where each document lives. Null: not written or not signed off. */
    terms: string | null;
    privacy: string | null;
    /** The youngest age at which someone may hold their own account. Null: not decided. */
    minimumAccountAge: number | null;
    confirmed: string | null;
  };
  payments: {
    /** Providers that can be offered: each declares what it can do. */
    providers: readonly PackPaymentProvider[];
    /** Named in the plan but not buildable yet, and why. */
    planned: readonly { id: string; waitingFor: string }[];
    /** The bank-feed provider that matches transfers, or null (matched by hand). */
    bankFeed: string | null;
  };
  /** Fixed-date public holidays as "MM-DD". Holidays that move each year aren't here. */
  fixedHolidays: readonly { date: string; name: string }[];
  holidaysNote: string;
  sportVocabulary: readonly SportVocabulary[];
};

// ── Phones ──────────────────────────────────────────────────────────────────

/**
 * A phone number typed any of the usual ways → E.164 for this country, or
 * null. "0912 345 678", "912345678", "+84 912 345 678", "84912345678" and
 * "0084 912 345 678" are all "+84912345678". A number that plainly belongs
 * to another country ("+64 21 …") is kept as it is.
 */
export function packPhoneToE164(raw: string | null | undefined, pack: Pick<CountryPack, "phone">): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  const { dial, trunkPrefix } = pack.phone;
  if (trimmed.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (trunkPrefix && digits.startsWith(trunkPrefix)) {
    digits = dial + digits.slice(trunkPrefix.length);
  } else if (!(digits.startsWith(dial) && pack.phone.mobile.test(`+${digits}`))) {
    digits = dial + digits;
  }
  // "+84 0912…": the trunk zero typed after the calling code.
  if (trunkPrefix && digits.startsWith(dial + trunkPrefix)) digits = dial + digits.slice(dial.length + trunkPrefix.length);
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** True for a mobile number of this country, in E.164. */
export function isPackMobile(e164: string | null | undefined, pack: Pick<CountryPack, "phone">): boolean {
  return Boolean(e164 && pack.phone.mobile.test(e164));
}

function grouped(digits: string, groups: readonly number[]): string {
  const parts: string[] = [];
  let i = 0;
  for (const size of groups) {
    if (i >= digits.length) break;
    parts.push(digits.slice(i, i + size));
    i += size;
  }
  if (i < digits.length) parts[parts.length - 1] += digits.slice(i);
  return parts.join(" ");
}

/** "+84912345678" → "+84 912 345 678". Numbers of another country come back unchanged. */
export function formatPackPhone(e164: string, pack: Pick<CountryPack, "phone">): string {
  if (!isPackMobile(e164, pack)) return e164;
  return `+${pack.phone.dial} ${grouped(e164.slice(1 + pack.phone.dial.length), pack.phone.groups)}`;
}

/** "+84912345678" → "0912 345 678", the way it is written inside the country. */
export function formatPackPhoneNational(e164: string, pack: Pick<CountryPack, "phone">): string {
  if (!isPackMobile(e164, pack)) return e164;
  const national = pack.phone.trunkPrefix + e164.slice(1 + pack.phone.dial.length);
  const [first, ...rest] = pack.phone.groups;
  return grouped(national, [first + pack.phone.trunkPrefix.length, ...rest]);
}

// ── Names ───────────────────────────────────────────────────────────────────

const words = (name: string) => name.trim().split(/\s+/).filter(Boolean);

/**
 * The name a person is called by, when they haven't chosen a display name.
 * Family-first names (Vietnamese): the last word, "Nguyễn Thị Hương" →
 * "Hương". Given-first names: the first word, "Mai Tran" → "Mai".
 */
export function calledName(fullName: string, order: NameOrder): string {
  const w = words(fullName);
  return (order === "family-first" ? w.at(-1) : w[0]) ?? "";
}

/** The family name: the first word of a family-first name, the last of a given-first one. "" for a single word. */
export function familyName(fullName: string, order: NameOrder): string {
  const w = words(fullName);
  if (w.length < 2) return "";
  return (order === "family-first" ? w[0] : w.at(-1)) ?? "";
}

/** What to show for a person: the display name they chose, or the full name exactly as they wrote it. Never reordered. */
export function shownName(person: { fullName: string; displayName?: string | null }): string {
  return person.displayName?.trim() || person.fullName.trim().replace(/\s+/g, " ");
}

/**
 * The key a list of people is sorted by. Vietnamese lists go by the called
 * name first (the last word), then the rest, without accents deciding the
 * order: Hương (Nguyễn Thị) sorts under H, not N.
 */
export function nameSortKey(fullName: string, order: NameOrder): string {
  const folded = foldForSearch(fullName);
  if (order !== "family-first") return folded;
  const w = folded.split(" ");
  return w.length < 2 ? folded : `${w.at(-1)} ${w.slice(0, -1).join(" ")}`;
}

/** Sorts people by nameSortKey; equal keys keep the accented spelling's order so the result is stable. */
export function sortByName<T extends { fullName: string }>(people: readonly T[], order: NameOrder): T[] {
  return [...people].sort((a, b) => {
    const ka = nameSortKey(a.fullName, order);
    const kb = nameSortKey(b.fullName, order);
    return ka < kb ? -1 : ka > kb ? 1 : a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0;
  });
}

/** People whose full name or display name has every word typed, accents and case ignored. */
export function searchPeople<T extends { fullName: string; displayName?: string | null }>(people: readonly T[], typed: string): T[] {
  return people.filter((p) => foldedIncludes(`${p.fullName} ${p.displayName ?? ""}`, typed));
}

// ── Sport words ─────────────────────────────────────────────────────────────

/** The pack's word for a sport's thing, or null: the caller falls back to the neutral wording. */
export function sportWord(pack: Pick<CountryPack, "sportVocabulary">, sport: string, thing: Exclude<keyof SportVocabulary, "sport">): string | null {
  return pack.sportVocabulary.find((v) => v.sport === sport)?.[thing] ?? null;
}

// ── The checklist every pack must pass (test plan §3.16) ───────────────────

export type ChecklistItem = { item: "currency" | "tax" | "phone" | "timezone" | "search" | "legal" | "payments" | "region"; ok: boolean; why: string };

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function countryPackChecklist(pack: CountryPack): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const add = (item: ChecklistItem["item"], ok: boolean, why: string) => out.push({ item, ok, why: ok ? "" : why });

  add("currency", isCurrency(pack.currency), `the currency "${pack.currency}" has no exponent in money.ts`);
  add("region", isRegion(pack.region), `the region "${pack.region}" doesn't exist`);
  add("timezone", validTimeZone(pack.timezone), `"${pack.timezone}" isn't a time zone`);

  const typed = pack.phone.trunkPrefix + pack.phone.example.replace(/\s/g, "");
  const e164 = packPhoneToE164(typed, pack);
  add("phone", /^\d{1,3}$/.test(pack.phone.dial) && isPackMobile(e164, pack), "the example number isn't a mobile number of this country");

  add("search", !pack.names.accentInsensitiveSearch || foldedIncludes("Nguyễn Thị Hương", "nguyen huong"), "accent-free search doesn't find an accented name");
  add("tax", pack.tax.standardRate !== null && pack.tax.confirmed !== null, "the tax and invoice rules aren't confirmed");
  add("legal", Boolean(pack.legal.terms && pack.legal.privacy && pack.legal.minimumAccountAge !== null && pack.legal.confirmed), "the legal documents aren't written and signed off");

  const providers = pack.payments.providers;
  const takesCurrency = providers.length > 0 && providers.every((p) => p.capabilities.currencies.includes(pack.currency) && (p.capabilities.qr || p.capabilities.clientConfirmation));
  add("payments", takesCurrency, "no payment provider that takes the country's currency, or one that gives the payer no way to pay");
  return out;
}

/** Whether a new club may choose this country in the setup wizard: every checklist item passes. */
export function countryPackSelectable(pack: CountryPack): boolean {
  return countryPackChecklist(pack).every((i) => i.ok);
}

/** Type guard used by the registry test. */
export const isRegionOfPack = (pack: CountryPack): pack is CountryPack & { region: Region } => isRegion(pack.region);
