// "Everyone who has played with the club", one row per person.
//
// There is no player table: people exist only as casual bookings, memberships
// and fill-ins, each carrying its own copy of a name and email. A person who
// booked five times and also joined as a member is therefore seven rows. This
// module turns those rows into one entry per *email*, so the same person is
// never counted twice, and flags the two ways that goes wrong:
//   - one email used with different names (kept as one person, names listed)
//   - one name used with different emails (kept as separate people, but
//     listed together so an admin can decide if they are the same person)
//
// The grouping is free of the database so it can be tested on its own; the
// SQL lives in loadPlayerRecords() (lib/db.ts-style, via @vercel/postgres).

import { sql } from "@vercel/postgres";
import { MEMBERSHIP_DAY_TO_DOW } from "./constants";
import { ensureTables, membershipCoversDateSql } from "./db";
import { normalizeEmail } from "./jersey";

export type PlayerSource = "casual" | "member" | "fill-in";

/** One booking, membership or fill-in, as stored. */
export type PlayerRecord = {
  source: PlayerSource;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  /** Casual: "card"/"cash". Member: "monthly"/"quarterly". */
  detail: string;
  /** Session dates (YYYY-MM-DD) this record played on, up to today. */
  dates: string[];
  /** Members only. */
  periodStart?: string | null;
  periodEnd?: string | null;
  status?: string | null;
};

export type Player = {
  /** Normalised email: the key that makes one person one row. */
  key: string;
  name: string;
  email: string;
  otherEmails: string[];
  otherNames: string[];
  phone: string;
  isCasual: boolean;
  isMember: boolean;
  isFillIn: boolean;
  casualSessions: number;
  memberSessions: number;
  fillInSessions: number;
  /** Distinct play days across all three. */
  totalSessions: number;
  firstPlayed: string;
  lastPlayed: string;
  membership: string;
  /** Other players sharing this name under a different email. */
  sameNameEmails: string[];
};

export type NameClash = { name: string; players: Player[] };

const clean = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
const nameOf = (r: PlayerRecord) => clean(`${r.firstName} ${r.lastName}`);
const nameKey = (name: string) =>
  name.toLowerCase().replace(/[^\p{L}]+/gu, " ").trim();

function latest<T>(items: T[], pick: (t: T) => string): string[] {
  // Values in order of newest first, de-duplicated case-insensitively.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const v = pick(item);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

export function buildPlayers(records: PlayerRecord[]): { players: Player[]; clashes: NameClash[] } {
  const groups = new Map<string, PlayerRecord[]>();
  for (const r of records) {
    const email = r.email.trim();
    if (!email) continue;
    const key = normalizeEmail(email);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const players: Player[] = [];
  for (const [key, recs] of groups) {
    // Newest record first, so the "current" name/email/phone is the latest one.
    const sorted = [...recs].sort((a, b) =>
      (maxDate(b) || "").localeCompare(maxDate(a) || ""),
    );
    const names = latest(sorted, nameOf);
    const emails = latest(sorted, (r) => r.email.trim());
    const phones = latest(sorted, (r) => clean(r.phone));

    const dates = (src: PlayerSource) =>
      new Set(recs.filter((r) => r.source === src).flatMap((r) => r.dates));
    const casual = dates("casual");
    const member = dates("member");
    const fillIn = dates("fill-in");
    const all = new Set([...casual, ...member, ...fillIn]);
    const sortedDates = [...all].sort();

    const plans = latest(
      sorted.filter((r) => r.source === "member"),
      (r) => r.detail,
    );

    players.push({
      key,
      // Older membership rows can lack a name; the roster falls back to the
      // email the same way.
      name: names[0] ?? emails[0] ?? key,
      email: (emails[0] ?? key).toLowerCase(),
      otherEmails: emails.slice(1),
      otherNames: names.slice(1),
      phone: phones[0] ?? "",
      isCasual: recs.some((r) => r.source === "casual"),
      isMember: recs.some((r) => r.source === "member"),
      isFillIn: recs.some((r) => r.source === "fill-in"),
      casualSessions: casual.size,
      memberSessions: member.size,
      fillInSessions: fillIn.size,
      totalSessions: all.size,
      firstPlayed: sortedDates[0] ?? "",
      lastPlayed: sortedDates[sortedDates.length - 1] ?? "",
      membership: plans.join(", "),
      sameNameEmails: [],
    });
  }

  // Same name under different emails: not merged (could be two people), but
  // flagged so an admin can look.
  const byName = new Map<string, Player[]>();
  for (const p of players) {
    for (const n of [p.name, ...p.otherNames]) {
      const k = nameKey(n);
      if (!k) continue;
      const list = byName.get(k);
      if (!list) byName.set(k, [p]);
      else if (!list.includes(p)) list.push(p);
    }
  }
  const clashes: NameClash[] = [];
  for (const [, list] of byName) {
    if (list.length < 2) continue;
    clashes.push({ name: list[0].name, players: list });
    for (const p of list) {
      for (const q of list) if (q !== p && !p.sameNameEmails.includes(q.email)) p.sameNameEmails.push(q.email);
    }
  }

  const byLast = (p: Player) => p.name.toLowerCase();
  players.sort((a, b) => byLast(a).localeCompare(byLast(b)) || a.email.localeCompare(b.email));
  clashes.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return { players, clashes };
}

function maxDate(r: PlayerRecord): string {
  return r.dates.length ? r.dates[r.dates.length - 1] : r.periodStart ?? "";
}

/**
 * Pulls every booking, fill-in and membership that has actually started, up
 * to and including `today` (YYYY-MM-DD). Future bookings are left out: those
 * people have not played yet.
 */
export async function loadPlayerRecords(today: string): Promise<PlayerRecord[]> {
  await ensureTables();

  const { rows: bookings } = await sql`
    SELECT first_name, last_name, email, phone, payment_intent_id, session_date::text AS session_date
    FROM bookings b
    WHERE status = 'confirmed' AND session_date <= ${today}
      AND NOT EXISTS (SELECT 1 FROM session_fill_ins f WHERE f.booking_id = b.id)
    ORDER BY session_date;
  `;
  const { rows: fillIns } = await sql`
    SELECT first_name, last_name, email, phone, session_date::text AS session_date
    FROM session_fill_ins
    WHERE session_date <= ${today}
    ORDER BY session_date;
  `;
  // A membership "played" on every session on its membership day that its
  // window covers (membershipCoversDateSql also projects auto-renewing
  // subscriptions forward). A membership that is no longer active stops at
  // its period_end. Never-paid rows (pending/incomplete) are skipped.
  const dowCase = Object.entries(MEMBERSHIP_DAY_TO_DOW)
    .map(([day, dow]) => `WHEN '${day}' THEN ${dow}`)
    .join(" ");
  const { rows: members } = await sql.query(
    `SELECT m.first_name, m.last_name, m.email, m.phone, m.plan, m.status,
            m.period_start::text AS period_start, m.period_end::text AS period_end,
            ARRAY(
              SELECT s.date::text FROM sessions s
              WHERE s.date <= $1
                AND EXTRACT(DOW FROM s.date) = (CASE m.day ${dowCase} ELSE -1 END)
                AND ${membershipCoversDateSql("s.date", "m")}
                AND (m.status IN ('active', 'trialing', 'past_due') OR s.date <= m.period_end)
                AND NOT EXISTS (
                  SELECT 1 FROM session_fill_ins f
                  WHERE f.membership_id = m.id AND f.session_date = s.date
                )
              ORDER BY s.date
            ) AS dates
     FROM memberships m
     WHERE m.status NOT IN ('pending', 'incomplete')
       AND m.period_start IS NOT NULL AND m.period_start <= $1
     ORDER BY m.period_start;`,
    [today],
  );

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return [
    ...bookings.map((r): PlayerRecord => ({
      source: "casual",
      firstName: str(r.first_name),
      lastName: str(r.last_name),
      email: str(r.email),
      phone: (r.phone as string | null) ?? null,
      detail: str(r.payment_intent_id).startsWith("cash-invoice-") ? "cash" : "card",
      dates: [str(r.session_date)],
    })),
    ...fillIns.map((r): PlayerRecord => ({
      source: "fill-in",
      firstName: str(r.first_name),
      lastName: str(r.last_name),
      email: str(r.email),
      phone: (r.phone as string | null) ?? null,
      detail: "fill-in",
      dates: [str(r.session_date)],
    })),
    ...members.map((r): PlayerRecord => ({
      source: "member",
      firstName: str(r.first_name),
      lastName: str(r.last_name),
      email: str(r.email),
      phone: (r.phone as string | null) ?? null,
      detail: str(r.plan),
      dates: (r.dates as string[] | null) ?? [],
      periodStart: (r.period_start as string | null) ?? null,
      periodEnd: (r.period_end as string | null) ?? null,
      status: str(r.status),
    })),
  ];
}
