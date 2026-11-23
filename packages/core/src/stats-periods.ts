// Pure helpers for player stats (no database), so they can be unit-tested
// on their own: NZ calendar periods, leaderboard ranking and week streaks.

export type Period = "month" | "quarter" | "year" | "lifetime";
export const PERIODS: Period[] = ["month", "quarter", "year", "lifetime"];

export type PeriodRange = { period: Period; key: string; start: string | null; end: string | null };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function lastDay(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The period containing `anchor` (YYYY-MM-DD), stepped `offset` periods back
 * (negative) or forward. Keys: 2026-11, 2026-Q4, 2026, all.
 */
export function periodRange(period: Period, anchor: string, offset = 0): PeriodRange {
  const [y0, m0] = anchor.split("-").map(Number);
  if (period === "lifetime") return { period, key: "all", start: null, end: null };
  if (period === "year") {
    const y = y0 + offset;
    return { period, key: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
  }
  if (period === "quarter") {
    const q0 = Math.floor((m0 - 1) / 3) + offset;
    const y = y0 + Math.floor(q0 / 4);
    const q = ((q0 % 4) + 4) % 4;
    const sm = q * 3 + 1;
    const em = sm + 2;
    return { period, key: `${y}-Q${q + 1}`, start: `${y}-${pad(sm)}-01`, end: `${y}-${pad(em)}-${pad(lastDay(y, em))}` };
  }
  const total = y0 * 12 + (m0 - 1) + offset;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { period, key: `${y}-${pad(m)}`, start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
}

/** Parses a period key back to its range (null if malformed). */
export function periodFromKey(period: Period, key: string | undefined): PeriodRange | null {
  if (!key) return null;
  if (period === "lifetime") return periodRange("lifetime", "2000-01-01");
  if (period === "year" && /^\d{4}$/.test(key)) return periodRange("year", `${key}-01-01`);
  if (period === "quarter") {
    const m = /^(\d{4})-Q([1-4])$/.exec(key);
    if (m) return periodRange("quarter", `${m[1]}-${pad((Number(m[2]) - 1) * 3 + 1)}-01`);
  }
  if (period === "month" && /^\d{4}-\d{2}$/.test(key)) return periodRange("month", `${key}-01`);
  return null;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export const DISPLAY_NAME_SQL = `coalesce(nullif(trim(p.display_name), ''),
  p.first_name || CASE WHEN p.last_name <> '' THEN ' ' || upper(left(p.last_name, 1)) || '.' ELSE '' END)`;

/** Standard competition ranking (1, 2, 2, 4) over already-sorted rows. */
export function rankRows<T extends { value: number; tie: string }>(rows: T[]): (T & { rank: number })[] {
  let lastKey = "";
  let lastRank = 0;
  return rows.map((r, i) => {
    const key = `${r.value}|${r.tie}`;
    const rank = key === lastKey ? lastRank : i + 1;
    lastKey = key;
    lastRank = rank;
    return { ...r, rank };
  });
}

/** Monday-based week key, so a streak counts weeks played. */
export function weekKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Current and best streak in weeks. Only weeks when the club actually ran a
 * play day count; a week the player said they couldn't make keeps the
 * streak going; the current week doesn't break it before it's over.
 */
export function computeStreaks(attended: string[], clubDays: string[], excused: string[], today: string): { current: number; best: number } {
  const played = new Set(attended.map(weekKey));
  const excusedWeeks = new Set(excused.map(weekKey));
  const weeks = [...new Set(clubDays.filter((d) => d <= today).map(weekKey))].sort();
  const thisWeek = weekKey(today);
  let best = 0;
  let run = 0;
  for (const w of weeks) {
    if (played.has(w)) {
      run++;
      best = Math.max(best, run);
    } else if (excusedWeeks.has(w) || w === thisWeek) {
      // keeps the streak, doesn't add to it
    } else {
      run = 0;
    }
  }
  return { current: run, best };
}
