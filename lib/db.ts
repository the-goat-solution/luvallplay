import { sql } from "@vercel/postgres";
import { DEFAULT_COURTS, SESSION_CAPACITY, maxPlayersForCourts } from "./constants";

// Every route touching the DB calls ensureTables() first, and it's ~24
// sequential DDL statements — cheap individually but a heavy tax when paid
// on every request. The DDL is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS), so it only ever needs to actually run once per warm server
// instance; memoize the promise so later calls resolve immediately.
let ensureTablesPromise: Promise<void> | null = null;

export function ensureTables(): Promise<void> {
  if (!ensureTablesPromise) {
    ensureTablesPromise = ensureTablesImpl().catch((err) => {
      ensureTablesPromise = null;
      throw err;
    });
  }
  return ensureTablesPromise;
}

async function ensureTablesImpl() {
  // DEFAULT must be a literal — Postgres rejects bind params in CREATE TABLE DDL.
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      date DATE PRIMARY KEY,
      max_spots INT NOT NULL DEFAULT 12,
      booked_spots INT NOT NULL DEFAULT 0
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      session_date DATE NOT NULL REFERENCES sessions(date),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      payment_intent_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY,
      session_date DATE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS memberships (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      plan TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      period_start DATE,
      period_end DATE,
      stripe_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS first_name TEXT;`;
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS last_name TEXT;`;
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS phone TEXT;`;
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS period_start DATE;`;
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS period_end DATE;`;
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;`;
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS recurring BOOLEAN NOT NULL DEFAULT TRUE;`;
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT UNIQUE;`;
  await sql`
    CREATE TABLE IF NOT EXISTS donations (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      amount_cents INT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'once',
      stripe_payment_intent_id TEXT UNIQUE,
      stripe_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS google_event_id TEXT;
  `;
  await sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS calendar_summary TEXT;
  `;
  await sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS event_start_time TIMESTAMPTZ;
  `;
  await sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS event_end_time TIMESTAMPTZ;
  `;
  await sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS event_location TEXT;
  `;
  await sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS session_alert_state (
      session_date DATE PRIMARY KEY REFERENCES sessions(date),
      state TEXT NOT NULL DEFAULT 'ok',
      headcount INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  // Courts booked for a play day, admin-configurable (default 2, matching the
  // previous fixed 12-player capacity). Unlike max_spots, this is never
  // touched by the calendar sync's upsert, so it doesn't drift.
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS courts INT NOT NULL DEFAULT 2;`;
}

// Adds whole calendar months to a YYYY-MM-DD date string, for computing a
// one-time (non-recurring) membership's period_end without a Stripe subscription.
export function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function ensureSession(date: string) {
  await sql`
    INSERT INTO sessions (date, max_spots, booked_spots)
    VALUES (${date}, ${SESSION_CAPACITY}, 0)
    ON CONFLICT (date) DO NOTHING;
  `;
}

// Casual spots remaining for a session = that play day's court-derived max
// players, minus current active members (monthly/quarterly — they can show
// up any Friday), minus casual spots already booked for that date.
//
// This deliberately ignores the sessions.max_spots column (see courts
// instead): max_spots is set once when a session row is first created and
// never updated afterwards (the Google Calendar sync's upsert only touches
// the calendar-derived columns), so it drifts from reality. `courts` is only
// ever written by setCourtsForDate, so it stays trustworthy.
export async function getAvailableSpots(date: string): Promise<number> {
  await ensureSession(date);
  const { rows } = await sql`
    SELECT booked_spots, courts FROM sessions WHERE date = ${date};
  `;
  const row = rows[0] as { booked_spots: number; courts: number } | undefined;
  const booked = row?.booked_spots ?? 0;
  const maxPlayers = maxPlayersForCourts(row?.courts ?? DEFAULT_COURTS);
  const activeMembers = await getActiveMemberCount();
  return Math.max(0, maxPlayers - activeMembers - booked);
}

// Batched variant of getAvailableSpots + getSessionHeadcount for the
// multi-date "Next Session" widget: instead of 3 sequential round trips per
// date, this does 1 upsert + 2 queries (in parallel) for the whole batch.
export async function getSpotsAndHeadcountForDates(
  dates: string[],
): Promise<{
  spots: Record<string, number>;
  signedUp: Record<string, number>;
}> {
  if (dates.length === 0) return { spots: {}, signedUp: {} };

  // The `sql` tagged template only types params as Primitive (no arrays), so
  // array binding goes through the underlying pool's `.query()` instead —
  // still parameterized, just not via the template tag.
  await sql.query(
    `INSERT INTO sessions (date, max_spots, booked_spots)
     SELECT unnest($1::date[]), $2, 0
     ON CONFLICT (date) DO NOTHING;`,
    [dates, SESSION_CAPACITY],
  );

  const [{ rows }, activeMembers] = await Promise.all([
    sql.query(
      `SELECT date, booked_spots, courts FROM sessions WHERE date = ANY($1::date[]);`,
      [dates],
    ),
    getActiveMemberCount(),
  ]);

  const bookedByDate = new Map<string, number>();
  const courtsByDate = new Map<string, number>();
  for (const row of rows) {
    const r = row as { date: Date; booked_spots: number; courts: number };
    const key = r.date.toISOString().slice(0, 10);
    bookedByDate.set(key, r.booked_spots);
    courtsByDate.set(key, r.courts);
  }

  const spots: Record<string, number> = {};
  const signedUp: Record<string, number> = {};
  for (const date of dates) {
    const booked = bookedByDate.get(date) ?? 0;
    const maxPlayers = maxPlayersForCourts(courtsByDate.get(date) ?? DEFAULT_COURTS);
    spots[date] = Math.max(0, maxPlayers - activeMembers - booked);
    signedUp[date] = booked + activeMembers;
  }
  return { spots, signedUp };
}

export async function reserveBookingSlot(
  date: string,
  booking: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    paymentIntentId: string;
  },
): Promise<boolean> {
  await ensureSession(date);
  // Casual capacity is that play day's court-derived max minus current
  // active members (they can show up any Friday), so the atomic guard must
  // account for both to avoid overselling the court. The CASE mirrors
  // COURTS_TO_MAX_PLAYERS in lib/constants.ts — keep the two in sync. See
  // getAvailableSpots for why this reads sessions.courts rather than the
  // stale sessions.max_spots column.
  const { rowCount } = await sql`
    UPDATE sessions
    SET booked_spots = booked_spots + 1
    WHERE date = ${date}
      AND booked_spots < (
        CASE courts
          WHEN 1 THEN 7
          WHEN 2 THEN 12
          WHEN 3 THEN 18
          WHEN 4 THEN 22
          ELSE ${SESSION_CAPACITY}
        END
      ) - (
        SELECT COUNT(*)::int FROM memberships WHERE status = 'active'
      );
  `;
  if (!rowCount) return false;

  await sql`
    INSERT INTO bookings (session_date, first_name, last_name, email, phone, payment_intent_id, status)
    VALUES (
      ${date},
      ${booking.firstName},
      ${booking.lastName},
      ${booking.email},
      ${booking.phone ?? null},
      ${booking.paymentIntentId},
      'confirmed'
    )
    ON CONFLICT (payment_intent_id) DO NOTHING;
  `;
  return true;
}

export async function removeBooking(bookingId: number, date: string): Promise<void> {
  const { rowCount } = await sql`
    DELETE FROM bookings WHERE id = ${bookingId} AND session_date = ${date};
  `;
  if (rowCount) {
    await sql`
      UPDATE sessions SET booked_spots = GREATEST(booked_spots - 1, 0) WHERE date = ${date};
    `;
  }
}

export async function upsertSessionFromCalendar(
  date: string,
  event: { id: string; summary?: string; start: string; end?: string; location?: string },
): Promise<void> {
  await sql`
    INSERT INTO sessions (date, max_spots, booked_spots, google_event_id, calendar_summary, event_start_time, event_end_time, event_location, synced_at)
    VALUES (${date}, ${SESSION_CAPACITY}, 0, ${event.id}, ${event.summary ?? null}, ${event.start}, ${event.end ?? null}, ${event.location ?? null}, NOW())
    ON CONFLICT (date) DO UPDATE SET
      google_event_id = EXCLUDED.google_event_id,
      calendar_summary = EXCLUDED.calendar_summary,
      event_start_time = EXCLUDED.event_start_time,
      event_end_time = EXCLUDED.event_end_time,
      event_location = EXCLUDED.event_location,
      synced_at = NOW();
  `;
}

export async function sessionExists(date: string): Promise<boolean> {
  const { rows } = await sql`
    SELECT 1 FROM sessions WHERE date = ${date} AND google_event_id IS NOT NULL;
  `;
  return rows.length > 0;
}

export async function listSessionsInRange(
  from: string,
  to: string,
): Promise<
  {
    date: string;
    maxSpots: number;
    bookedSpots: number;
    eventStartTime: string | null;
    eventEndTime: string | null;
    eventLocation: string | null;
  }[]
> {
  const { rows } = await sql`
    SELECT date, courts, booked_spots, event_start_time, event_end_time, event_location
    FROM sessions
    WHERE date >= ${from} AND date <= ${to} AND google_event_id IS NOT NULL
    ORDER BY date;
  `;
  return rows.map((row) => {
    const r = row as {
      date: Date;
      courts: number;
      booked_spots: number;
      event_start_time: Date | null;
      event_end_time: Date | null;
      event_location: string | null;
    };
    return {
      date: r.date.toISOString().slice(0, 10),
      maxSpots: maxPlayersForCourts(r.courts),
      bookedSpots: r.booked_spots,
      eventStartTime: r.event_start_time ? r.event_start_time.toISOString() : null,
      eventEndTime: r.event_end_time ? r.event_end_time.toISOString() : null,
      eventLocation: r.event_location,
    };
  });
}

export async function getUpcomingSessionDates(withinDays: number): Promise<string[]> {
  const { rows } = await sql`
    SELECT date FROM sessions
    WHERE date >= CURRENT_DATE AND date <= CURRENT_DATE + ${withinDays}::int
      AND google_event_id IS NOT NULL
    ORDER BY date;
  `;
  return rows.map((row) => (row as { date: Date }).date.toISOString().slice(0, 10));
}

export async function listAllSessionDates(): Promise<string[]> {
  const { rows } = await sql`
    SELECT date FROM sessions
    WHERE google_event_id IS NOT NULL
    ORDER BY date;
  `;
  return rows.map((row) => (row as { date: Date }).date.toISOString().slice(0, 10));
}

export async function getActiveMemberCount(): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*)::int AS count FROM memberships WHERE status = 'active';
  `;
  return (rows[0] as { count: number })?.count ?? 0;
}

export async function getSessionHeadcount(
  date: string,
): Promise<{ casual: number; members: number; total: number }> {
  const { rows } = await sql`
    SELECT booked_spots FROM sessions WHERE date = ${date};
  `;
  const casual = (rows[0] as { booked_spots: number } | undefined)?.booked_spots ?? 0;
  const members = await getActiveMemberCount();
  return { casual, members, total: casual + members };
}

export async function getCourtsForDate(date: string): Promise<number> {
  await ensureSession(date);
  const { rows } = await sql`
    SELECT courts FROM sessions WHERE date = ${date};
  `;
  return (rows[0] as { courts: number } | undefined)?.courts ?? DEFAULT_COURTS;
}

// Updates how many courts are booked for a play day. Refuses to shrink
// capacity below the number of players already signed up (casual bookings +
// active members), so an admin can't accidentally strand booked players.
export async function setCourtsForDate(
  date: string,
  courts: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await ensureSession(date);
  const maxPlayers = maxPlayersForCourts(courts);
  const { rows } = await sql`
    SELECT booked_spots FROM sessions WHERE date = ${date};
  `;
  const booked = (rows[0] as { booked_spots: number } | undefined)?.booked_spots ?? 0;
  const activeMembers = await getActiveMemberCount();
  const totalSignedUp = booked + activeMembers;

  if (totalSignedUp > maxPlayers) {
    return {
      ok: false,
      reason: `Can't set ${courts} court${courts === 1 ? "" : "s"} (max ${maxPlayers} players) — ${totalSignedUp} players are already signed up for this play day.`,
    };
  }

  await sql`
    UPDATE sessions SET courts = ${courts} WHERE date = ${date};
  `;
  return { ok: true };
}

export async function getSessionAlertState(
  date: string,
): Promise<{ state: string; headcount: number }> {
  const { rows } = await sql`
    SELECT state, headcount FROM session_alert_state WHERE session_date = ${date};
  `;
  const row = rows[0] as { state: string; headcount: number } | undefined;
  return row ?? { state: "ok", headcount: 0 };
}

export async function upsertSessionAlertState(
  date: string,
  state: string,
  headcount: number,
): Promise<void> {
  await sql`
    INSERT INTO session_alert_state (session_date, state, headcount, updated_at)
    VALUES (${date}, ${state}, ${headcount}, NOW())
    ON CONFLICT (session_date) DO UPDATE SET
      state = EXCLUDED.state,
      headcount = EXCLUDED.headcount,
      updated_at = NOW();
  `;
}

export type RosterEntry = {
  bookingId: number | null;
  name: string;
  email: string;
  phone: string | null;
  type: "casual" | "monthly" | "quarterly";
  method: "card" | "cash";
};

export async function getRosterForDate(date: string): Promise<RosterEntry[]> {
  const { rows: bookingRows } = await sql`
    SELECT id, first_name, last_name, email, phone, payment_intent_id
    FROM bookings
    WHERE session_date = ${date} AND status = 'confirmed'
    ORDER BY created_at ASC;
  `;
  const { rows: memberRows } = await sql`
    SELECT first_name, last_name, email, phone, plan
    FROM memberships
    WHERE status = 'active' AND period_start <= ${date} AND period_end >= ${date}
    ORDER BY created_at ASC;
  `;

  const casual: RosterEntry[] = bookingRows.map((r) => ({
    bookingId: r.id as number,
    name: `${r.first_name} ${r.last_name}`.trim(),
    email: r.email as string,
    phone: (r.phone as string | null) ?? null,
    type: "casual",
    method: (r.payment_intent_id as string | null)?.startsWith("cash-invoice-")
      ? "cash"
      : "card",
  }));

  const members: RosterEntry[] = memberRows.map((r) => ({
    bookingId: null,
    name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || (r.email as string),
    email: r.email as string,
    phone: (r.phone as string | null) ?? null,
    type: r.plan === "quarterly" ? "quarterly" : "monthly",
    method: "card",
  }));

  return [...casual, ...members];
}

export type MembershipRow = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  plan: "monthly" | "quarterly";
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  recurring: boolean;
  stripeSubscriptionId: string | null;
};

function mapMembershipRow(r: {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  plan: string;
  period_start: Date | null;
  period_end: Date | null;
  status: string;
  cancel_at_period_end: boolean;
  recurring: boolean;
  stripe_subscription_id: string | null;
}): MembershipRow {
  return {
    id: r.id,
    name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.email,
    email: r.email,
    phone: r.phone,
    plan: r.plan === "quarterly" ? "quarterly" : "monthly",
    periodStart: r.period_start ? r.period_start.toISOString().slice(0, 10) : null,
    periodEnd: r.period_end ? r.period_end.toISOString().slice(0, 10) : null,
    status: r.status,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    recurring: r.recurring,
    stripeSubscriptionId: r.stripe_subscription_id,
  };
}

// Memberships still worth showing to the admin roster: active subscriptions
// and any already scheduled to lapse (so a pending cancellation stays visible
// until Stripe's period-end webhook flips the status).
export async function listMemberships(): Promise<MembershipRow[]> {
  const { rows } = await sql`
    SELECT id, email, first_name, last_name, phone, plan, period_start, period_end, status, cancel_at_period_end, recurring, stripe_subscription_id
    FROM memberships
    WHERE status IN ('active', 'trialing', 'past_due')
    ORDER BY plan, created_at DESC;
  `;
  return rows.map((r) => mapMembershipRow(r as Parameters<typeof mapMembershipRow>[0]));
}

export async function getMembershipById(id: number): Promise<MembershipRow | null> {
  const { rows } = await sql`
    SELECT id, email, first_name, last_name, phone, plan, period_start, period_end, status, cancel_at_period_end, recurring, stripe_subscription_id
    FROM memberships
    WHERE id = ${id};
  `;
  const row = rows[0];
  return row ? mapMembershipRow(row as Parameters<typeof mapMembershipRow>[0]) : null;
}

export async function listActiveMembershipsByEmail(
  email: string,
): Promise<MembershipRow[]> {
  const { rows } = await sql`
    SELECT id, email, first_name, last_name, phone, plan, period_start, period_end, status, cancel_at_period_end, recurring, stripe_subscription_id
    FROM memberships
    WHERE status IN ('active', 'trialing', 'past_due')
      AND lower(email) = lower(${email})
      AND cancel_at_period_end = FALSE
      AND recurring = TRUE
    ORDER BY created_at DESC;
  `;
  return rows.map((r) => mapMembershipRow(r as Parameters<typeof mapMembershipRow>[0]));
}

export async function setMembershipCancelAtPeriodEnd(id: number): Promise<void> {
  await sql`
    UPDATE memberships SET cancel_at_period_end = TRUE WHERE id = ${id};
  `;
}
