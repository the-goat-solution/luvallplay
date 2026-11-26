// The Vietnam country pack (build plan §6.9, §11.4 "Localisation"; decisions
// X, AC, AD, AE). Data only.
//
// Not selectable for a real club yet: the tax and legal items wait for
// Vietnamese counsel (§11.4), so countryPackSelectable(VN_PACK) is false and
// the tests pin exactly which items are open.

import type { CountryPack } from "./country-pack.ts";
import { VIETQR_CAPABILITIES } from "./vietqr.ts";

export const VN_PACK: CountryPack = {
  country: "VN",
  name: "Vietnam",
  // Hanoi (decision AE). Nothing runs there yet.
  region: "han",
  // No minor unit: amounts are whole dong (money.ts).
  currency: "VND",
  // One time zone for the whole country, UTC+7, no daylight saving.
  timezone: "Asia/Ho_Chi_Minh",
  languages: ["vi", "en"],
  phone: {
    dial: "84",
    trunkPrefix: "0",
    // Mobiles since the 2018 renumbering: 9 digits after +84, starting 3, 5, 7, 8 or 9.
    mobile: /^\+84[35789]\d{8}$/,
    groups: [3, 3, 3],
    example: "912 345 678",
  },
  names: {
    // Family name, middle name, given name; people are called by the given name.
    order: "family-first",
    accentInsensitiveSearch: true,
  },
  tax: {
    name: "VAT (thuế GTGT)",
    // Check with counsel: the standard rate, the temporary reductions, and the e-invoice rules (§11.4).
    standardRate: null,
    confirmed: null,
    notes: "The rate, e-invoices and what applies to TGS's own fees are with Vietnamese counsel.",
  },
  legal: {
    terms: null,
    privacy: null,
    minimumAccountAge: null,
    confirmed: null,
  },
  payments: {
    providers: [{ id: "vietqr", kind: "bank-transfer", capabilities: VIETQR_CAPABILITIES }],
    planned: [{ id: "momo", waitingFor: "MoMo's rules confirmed in writing (§6.5, §11.4)" }],
    bankFeed: null,
  },
  fixedHolidays: [
    { date: "01-01", name: "Tết Dương lịch" },
    { date: "04-30", name: "Ngày Giải phóng miền Nam" },
    { date: "05-01", name: "Ngày Quốc tế Lao động" },
    { date: "09-02", name: "Quốc khánh" },
  ],
  holidaysNote: "Tết Nguyên đán and Giỗ Tổ Hùng Vương follow the lunar calendar, and the days off around National Day are announced each year: they need a yearly list.",
  // Wording to be reviewed by a Vietnamese speaker before launch (test plan §3.16 "Vietnamese quality").
  sportVocabulary: [
    { sport: "badminton", court: "sân", game: "ván", match: "trận", singles: "đánh đơn", doubles: "đánh đôi", mixedDoubles: "đôi nam nữ" },
    { sport: "pickleball", court: "sân", game: "ván", match: "trận", singles: "đánh đơn", doubles: "đánh đôi", mixedDoubles: "đôi nam nữ" },
  ],
};

/** Packs that exist as data, by country code. NZ and Australia join when their packs are written down (today their values are the defaults in the code). */
export const COUNTRY_PACKS: Readonly<Record<string, CountryPack>> = { VN: VN_PACK };
