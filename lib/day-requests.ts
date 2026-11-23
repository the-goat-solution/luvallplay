import { sql } from "./database";
import { DEFAULT_PAUSED_DAYS, WEEKDAYS, type Weekday } from "./constants";
import { isDatePaused } from "./dates";

export function isWeekday(value: unknown): value is Weekday {
  return typeof value === "string" && (WEEKDAYS as string[]).includes(value);
}

// Weekdays whose public sign-ups are currently paused. Falls back to the
// seeded defaults when there's no database (local dev) or the lookup fails,
// so a DB hiccup errs on the side of keeping a paused day paused.
export async function getPausedDays(): Promise<Weekday[]> {
  if (!process.env.POSTGRES_URL) return [...DEFAULT_PAUSED_DAYS];
  try {
    const { rows } = await sql`
      SELECT day FROM day_signup_settings WHERE paused = TRUE;
    `;
    return WEEKDAYS.filter((d) => rows.some((r) => r.day === d));
  } catch (err) {
    console.error("Failed to load paused days", err);
    return [...DEFAULT_PAUSED_DAYS];
  }
}

export async function isDayPaused(day: Weekday): Promise<boolean> {
  return (await getPausedDays()).includes(day);
}

export async function isSessionDatePaused(dateKey: string): Promise<boolean> {
  return isDatePaused(dateKey, await getPausedDays());
}

export async function setDayPaused(day: Weekday, paused: boolean): Promise<void> {
  await sql`
    INSERT INTO day_signup_settings (day, paused, updated_at)
    VALUES (${day}, ${paused}, NOW())
    ON CONFLICT (day) DO UPDATE SET paused = EXCLUDED.paused, updated_at = NOW();
  `;
}

export type DayRequest = {
  id: number;
  day: Weekday;
  name: string;
  email: string;
  createdAt: string;
  notifiedAt: string | null;
};

// Returns false when this email already has a pending request for the day —
// the caller still treats that as success, since they're on the list either way.
export async function addDayRequest(
  day: Weekday,
  name: string,
  email: string,
): Promise<boolean> {
  const { rowCount } = await sql`
    INSERT INTO day_requests (day, name, email)
    VALUES (${day}, ${name}, ${email})
    ON CONFLICT (day, LOWER(email)) WHERE notified_at IS NULL DO NOTHING;
  `;
  return (rowCount ?? 0) > 0;
}

export async function listDayRequests(): Promise<DayRequest[]> {
  const { rows } = await sql`
    SELECT id, day, name, email, created_at, notified_at
    FROM day_requests
    ORDER BY created_at ASC;
  `;
  return rows
    .filter((r) => isWeekday(r.day))
    .map((r) => ({
      id: r.id as number,
      day: r.day as Weekday,
      name: r.name as string,
      email: r.email as string,
      createdAt: (r.created_at as Date).toISOString(),
      notifiedAt: r.notified_at ? (r.notified_at as Date).toISOString() : null,
    }));
}

export async function getPendingDayRequests(day: Weekday): Promise<DayRequest[]> {
  return (await listDayRequests()).filter(
    (r) => r.day === day && r.notifiedAt === null,
  );
}

export async function markDayRequestsNotified(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await sql.query(
    `UPDATE day_requests SET notified_at = NOW() WHERE id = ANY($1::int[]);`,
    [ids],
  );
}

export async function deleteDayRequest(id: number): Promise<void> {
  await sql`DELETE FROM day_requests WHERE id = ${id};`;
}
