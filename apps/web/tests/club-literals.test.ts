// Phase 3 step 4: club-specific values live in one place each, so they can
// become settings (build plan §6.2). This scan fails when a new copy of one
// is typed into the app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = new URL("..", import.meta.url).pathname;
const ROOT = join(WEB, "../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

test("the club's time zone is written once (lib/constants.ts), not typed into pages and helpers", () => {
  const dirs = ["app", "lib", "components", "context", "hooks"].map((d) => join(WEB, d)).concat(join(ROOT, "packages"));
  const allowed = new Set(["apps/web/lib/constants.ts"]);
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      const rel = relative(ROOT, file);
      if (allowed.has(rel)) continue;
      // A quoted literal; mentions in comments are fine.
      if (/["'`]Pacific\/Auckland["'`]/.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "use CLUB_TIME_ZONE from lib/constants (or the club's settings) instead of the literal");
});

test("the club's clock is passed to every call of the date helpers", () => {
  // getClubToday() and clubDateKeyForInstant() without the club's clock would
  // use the built-in one. Nothing does any more; a new call without it fails here.
  const allowed: Record<string, number> = {};
  const found: Record<string, number> = {};
  for (const dir of ["app", "lib", "components"].map((d) => join(WEB, d))) {
    for (const file of sourceFiles(dir)) {
      const rel = relative(ROOT, file);
      if (rel === "apps/web/lib/dates.ts") continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (/^\s*(\/\/|\*)/.test(line)) continue;
        // One argument or none: no clock was passed.
        if (/(?<![\w.])(getClubToday|getClubTodayDate)\(\w*\)/.test(line) || /(?<![\w.])clubDateKeyForInstant\((?:[^(),]|\([^()]*\))*\)/.test(line)) found[rel] = (found[rel] ?? 0) + 1;
      }
    }
  }
  assert.deepEqual(found, allowed, "pass the club's clock: getClubToday(now, await clubClock()), or useClub().clock in the browser");
});

// Track A step A2 (build plan §6.2.4 layer 3; audit C4): nothing club-specific
// is typed into admin code. The club's name, locale, currency code and
// weekdays come from lib/club-brand.ts (and lib/money.ts), so another club's
// admin never says "Three Wolves", "NZD" or "Friday". Comments are exempt;
// so are tests and fixtures (they aren't scanned).
//
// The scan grows with A2: emails, receipts, exports and payment descriptions
// (lib/, app/api/) join ADMIN_SCAN_DIRS as they are cleaned.
const ADMIN_SCAN_DIRS = ["app/admin", "components/admin"];

const CLUB_LITERALS: [name: string, pattern: RegExp][] = [
  ["the club's name", /Three Wolves|three-wolves|3 ?Wolves/i],
  ["a club word (use the club's terms)", /\bWol(f|ves)\b/],
  ["a locale (use clubLocale(), clubDate())", /["'`]en-(NZ|AU|US|GB)["'`]/],
  ["a currency code (use clubCurrencyCode(), clubMoney())", /\b(NZD|AUD|USD|VND)\b|NZ\$/],
  ["a weekday (use membershipDays(), weekdayName())", /\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)days?\b|["'`](mon|tues|wednes|thurs|fri|satur|sun)day["'`]/],
  // "$10" typed into wording. (SQL placeholders, "$1", only ever sit in a query.)
  ["a fixed price (use clubMoney(), clubRoundAmount())", /(?<!(SELECT|INSERT|UPDATE|DELETE|WHERE|VALUES|AND|SET)\b.*)\$\d/],
];

function stripComments(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("A2: no club name, locale, currency code, weekday or fixed price is typed into admin code", () => {
  const offenders: string[] = [];
  for (const dir of ADMIN_SCAN_DIRS) {
    for (const file of sourceFiles(join(WEB, dir))) {
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        // Trailing comments on a line of code.
        const code = line.replace(/\s\/\/ .*$/, "");
        for (const [name, pattern] of CLUB_LITERALS) {
          if (pattern.test(code)) offenders.push(`${relative(ROOT, file)}: ${name}: ${code.trim().slice(0, 100)} (line ~${i + 1})`);
        }
      });
    }
  }
  assert.deepEqual(offenders, [], "take it from lib/club-brand.ts, lib/money.ts or the club's terms instead of typing it");
});

test("A2: the club-brand helpers give Three Wolves exactly the wording it had", async () => {
  const b = await import("../lib/club-brand.ts");
  assert.equal(b.clubName(), "Three Wolves Badminton Club");
  assert.equal(b.clubShortName(), "Three Wolves");
  assert.equal(b.clubLocale(), "en-NZ");
  assert.equal(b.clubCurrencyCode(), "NZD");
  assert.equal(`${b.clubSlug()}-financials.xlsx`, "three-wolves-financials.xlsx");
  assert.deepEqual(b.membershipDays(), ["friday", "wednesday"]);
  assert.equal(b.membershipDayList(), "Friday and Wednesday");
  assert.equal(b.weekdayPlural("wednesday"), "Wednesdays");
  // Posted values: exactly the old rule (anything but "wednesday" was Friday).
  assert.equal(b.parseMembershipDay("wednesday"), "wednesday");
  assert.equal(b.parseMembershipDay("friday"), "friday");
  assert.equal(b.parseMembershipDay(null), "friday");
  assert.equal(b.parseMembershipDay("sunday"), "friday");
  // What members read on receipts and statements.
  assert.equal(b.membershipDescription("monthly", "friday"), "Three Wolves — Monthly Membership (Friday)");
  assert.equal(b.membershipDescription("quarterly", "wednesday"), "Three Wolves — Quarterly Membership (Wednesday)");
  assert.equal(b.shopDescription("Club tee (M)", "cash"), "Three Wolves shop — Club tee (M) — cash");
  assert.equal(b.clubRoundAmount(0), "$0");
  assert.equal(b.clubRoundAmount(1_000_000), "$1,000,000");
  assert.equal(b.clubDate("2026-11-27T00:00:00Z", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }), "Fri, 27 Nov");
});
