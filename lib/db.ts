import { db, sql, types } from "@vercel/postgres";

// By default the driver parses Postgres DATE columns into JS Date objects at
// local midnight, so converting back with .toISOString().slice(0,10) silently
// shifts the day whenever the process's timezone isn't UTC (verified: it
// breaks under Pacific/Auckland, the club's own timezone — the exact
// environment this app cares about getting right). DATE has no time-of-day
// component to begin with, so keep it as the plain 'YYYY-MM-DD' string
// Postgres already sends, sidestepping the conversion entirely everywhere in
// this file. OID 1082 = date.
types.setTypeParser(1082, (val: string) => val);
import {
  MEMBERSHIP_CYCLE_DAYS,
  MEMBERSHIP_DAYS,
  MEMBERSHIP_DAY_TO_DOW,
  MEMBERSHIP_START_SEARCH_DAYS,
  PENDING_MEMBERSHIP_HOLD_MINUTES,
  SESSION_CAPACITY,
  maxPlayersForCourts,
  type MembershipDay,
  type MembershipTier,
} from "./constants";
import {
  defaultCourtsForDate,
  getClubToday,
  getMembershipDayForDate,
} from "./dates";

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
  // Guards the additive period_end advance on renewal (see applyRenewal)
  // against Stripe's at-least-once webhook delivery re-granting a cycle.
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS last_renewal_invoice_id TEXT;`;
  // Which weekday's membership pool this row grants access to — defaults to
  // 'friday' since every membership predating this column was Friday-only.
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS day TEXT NOT NULL DEFAULT 'friday';`;
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
  // Set once a "spot opened" email has actually been sent for this waitlist
  // row, so notifyWaitlistIfSpotOpened (lib/waitlist-notify.ts) never
  // double-emails someone across repeated capacity-increase triggers.
  await sql`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;`;
  // Dedup guard for the day-before membership reminder cron — a given
  // membership should only ever get one reminder for a given play day, even
  // if the cron is retried or runs more than once on the same day.
  await sql`
    CREATE TABLE IF NOT EXISTS membership_reminders_sent (
      membership_id INT NOT NULL,
      session_date DATE NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (membership_id, session_date)
    );
  `;
  // Dedup guard for the day-before casual-booking reminder — a booking only
  // ever covers one session_date, so a single nullable column (unlike the
  // membership table above) is enough to guarantee at most one reminder.
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;`;
}

// Adds an exact number of days to a YYYY-MM-DD date string. Unlike calendar-
// month arithmetic (setUTCMonth), this has no rollover ambiguity — used to
// compute membership period_end as an exact 28-day/84-day span.
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function ensureSession(date: string) {
  await sql`
    INSERT INTO sessions (date, max_spots, booked_spots, courts)
    VALUES (${date}, ${SESSION_CAPACITY}, 0, ${defaultCourtsForDate(date)})
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
  const maxPlayers = maxPlayersForCourts(row?.courts ?? defaultCourtsForDate(date));
  const activeMembers = await getActiveMemberCountForDate(date);
  return Math.max(0, maxPlayers - activeMembers - booked);
}

// Batched variant of getAvailableSpots + getSessionHeadcount for the
// multi-date "Next Session" widget: instead of 3 sequential round trips per
// date, this does 1 upsert + 2 queries (in parallel) for the whole batch.
export async function getSpotsAndHeadcountForDates(dates: string[]): Promise<{
  spots: Record<string, number>;
  signedUp: Record<string, number>;
}> {
  if (dates.length === 0) return { spots: {}, signedUp: {} };

  // Each date may default to a different court count (membership day vs.
  // not), so the per-date default is computed in JS and zipped with the
  // dates array via a paired unnest — a flat $2 like max_spots below can't
  // vary per row.
  const courtsDefaults = dates.map(defaultCourtsForDate);
  // Each date's membership day (or null for casual-only), zipped with dates
  // the same way, so the member-count query below only counts members whose
  // day matches that specific date.
  const membershipDays = dates.map(getMembershipDayForDate);

  // The `sql` tagged template only types params as Primitive (no arrays), so
  // array binding goes through the underlying pool's `.query()` instead —
  // still parameterized, just not via the template tag.
  await sql.query(
    `INSERT INTO sessions (date, max_spots, booked_spots, courts)
     SELECT t.d, $2, 0, t.c
     FROM unnest($1::date[], $3::int[]) AS t(d, c)
     ON CONFLICT (date) DO NOTHING;`,
    [dates, SESSION_CAPACITY, courtsDefaults],
  );

  const [{ rows }, { rows: memberRows }] = await Promise.all([
    sql.query(
      `SELECT date::text AS date, booked_spots, courts FROM sessions WHERE date = ANY($1::date[]);`,
      [dates],
    ),
    // Each date gets its own correctly-scoped member count (a member only
    // counts toward dates within their period_start..period_end AND whose
    // day matches that date's membership day — a NULL day for a casual-only
    // date never matches m.day, so it naturally counts zero), rather than
    // one global count applied uniformly to every date in the batch.
    // date::text avoids handing back a JS Date — @vercel/postgres's tagged-
    // template and .query() paths parse DATE columns inconsistently across
    // process timezones otherwise (verified: shifts a day under
    // Pacific/Auckland), so every date column in this file is cast to text
    // at the SQL level rather than relying on driver-side type parsing.
    sql.query(
      `SELECT t.d::text AS date, COUNT(m.id)::int AS active_members
       FROM unnest($1::date[], $2::text[]) AS t(d, day)
       LEFT JOIN memberships m
         ON m.status = 'active' AND m.period_start <= t.d AND m.period_end >= t.d AND m.day = t.day
       GROUP BY t.d;`,
      [dates, membershipDays],
    ),
  ]);

  const bookedByDate = new Map<string, number>();
  const courtsByDate = new Map<string, number>();
  for (const row of rows) {
    const r = row as { date: string; booked_spots: number; courts: number };
    bookedByDate.set(r.date, r.booked_spots);
    courtsByDate.set(r.date, r.courts);
  }
  const membersByDate = new Map<string, number>();
  for (const row of memberRows) {
    const r = row as { date: string; active_members: number };
    membersByDate.set(r.date, r.active_members);
  }

  const spots: Record<string, number> = {};
  const signedUp: Record<string, number> = {};
  for (const date of dates) {
    const booked = bookedByDate.get(date) ?? 0;
    // Already scoped to the right membership day (or zero for casual-only
    // dates) by the day-matched join above — see getActiveMemberCountForDate
    // for the equivalent single-date query.
    const activeMembers = membersByDate.get(date) ?? 0;
    const maxPlayers = maxPlayersForCourts(
      courtsByDate.get(date) ?? defaultCourtsForDate(date),
    );
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
  // active members whose period covers this date AND whose day matches this
  // date's membership day, so the atomic guard must account for both to
  // avoid overselling the court. The CASE mirrors COURTS_TO_MAX_PLAYERS in
  // lib/constants.ts — keep the two in sync. See getAvailableSpots for why
  // this reads sessions.courts rather than the stale sessions.max_spots
  // column. The day CASE mirrors MEMBERSHIP_DAY_TO_DOW; a NULL result (a
  // casual-only day) never matches memberships.day, so the subquery counts
  // zero on those days without needing a separate ELSE 0 branch.
  const { rowCount } = await sql`
    UPDATE sessions
    SET booked_spots = booked_spots + 1
    WHERE date = ${date}
      AND booked_spots < (
        CASE courts
          WHEN 1 THEN 6
          WHEN 2 THEN 12
          WHEN 3 THEN 18
          WHEN 4 THEN 22
          ELSE ${SESSION_CAPACITY}
        END
      ) - (
        SELECT COUNT(*)::int FROM memberships
        WHERE status = 'active' AND period_start <= ${date} AND period_end >= ${date}
          AND day = CASE EXTRACT(DOW FROM date) WHEN 5 THEN 'friday' WHEN 3 THEN 'wednesday' END
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

export async function removeBooking(
  bookingId: number,
  date: string,
): Promise<void> {
  const { rowCount } = await sql`
    DELETE FROM bookings WHERE id = ${bookingId} AND session_date = ${date};
  `;
  if (rowCount) {
    await sql`
      UPDATE sessions SET booked_spots = GREATEST(booked_spots - 1, 0) WHERE date = ${date};
    `;
  }
}

export type MembershipAssignment =
  | {
      blocked: false;
      membershipId: number;
      periodStart: string;
      periodEnd: string;
    }
  | { blocked: true; reason: "sessions_full" | "already_member" };

// Finds the nearest upcoming play day for the given membership day (Friday
// or Wednesday — every other day is casual-bookings-only) that still has
// room, and atomically reserves a 'pending' membership row starting there,
// so the member's access window never overlaps a day that's already full.
// Locks each candidate session row in turn (FOR UPDATE) so two concurrent
// signups can't both claim the same last-open spot — see
// PENDING_MEMBERSHIP_HOLD_MINUTES for why an abandoned checkout doesn't
// block a spot forever. Returns `{ blocked: true, reason: "sessions_full" }`
// if no known upcoming play day (within MEMBERSHIP_START_SEARCH_DAYS)
// currently has room, or `{ blocked: true, reason: "already_member" }` if
// this email already has an active (or recently-pending) membership for the
// same day — a member can hold one Friday AND one Wednesday membership at
// once, just not two of the same day.
export async function assignAndReserveMembershipAccessStart(
  plan: MembershipTier,
  day: MembershipDay,
  member: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    recurring: boolean;
  },
): Promise<MembershipAssignment> {
  const { dateKey: clubToday, cutoffPassed } = getClubToday();
  const dow = MEMBERSHIP_DAY_TO_DOW[day];
  const lockKey = `${member.email.toLowerCase()}:${day}`;

  const client = await db.connect();
  try {
    // Session-level advisory lock (not transaction-scoped, so it spans every
    // per-candidate transaction below) held for this whole function, so the
    // duplicate-membership check and the capacity search + insert that
    // follows it are serialized against any other concurrent signup for the
    // same email+day. Without this, two requests racing each other could
    // both pass the check below before either has committed a row.
    await client.query(`SELECT pg_advisory_lock(hashtext($1));`, [lockKey]);

    // A lapsed one-time (non-recurring) membership never transitions out of
    // 'active' (nothing re-checks it once period_end passes), so this must
    // require period_end >= today rather than trusting status alone —
    // otherwise a member whose old plan already ended could never sign up
    // again for the same day.
    const { rows: conflictRows } = await client.query(
      `SELECT id FROM memberships
       WHERE lower(email) = lower($1) AND day = $2
         AND (
           (status IN ('active', 'trialing', 'past_due') AND (period_end IS NULL OR period_end >= $3))
           OR (status = 'pending' AND created_at > NOW() - ($4 * INTERVAL '1 minute'))
         )
       LIMIT 1;`,
      [member.email, day, clubToday, PENDING_MEMBERSHIP_HOLD_MINUTES],
    );
    if (conflictRows.length > 0) {
      return { blocked: true, reason: "already_member" };
    }

    const { rows: candidates } = await client.query(
      `SELECT date::text AS date FROM sessions
       WHERE google_event_id IS NOT NULL
         AND EXTRACT(DOW FROM date) = $2
         AND date >= ($1::date + $3::int)
         AND date <= ($1::date + $4::int)
       ORDER BY date;`,
      [clubToday, dow, cutoffPassed ? 1 : 0, MEMBERSHIP_START_SEARCH_DAYS],
    );

    for (const row of candidates) {
      const date = (row as { date: string }).date;

      await client.query("BEGIN");
      try {
        const { rows: sessionRows } = await client.query(
          `SELECT booked_spots, courts FROM sessions WHERE date = $1 FOR UPDATE;`,
          [date],
        );
        const session = sessionRows[0] as
          | { booked_spots: number; courts: number }
          | undefined;
        const maxPlayers = maxPlayersForCourts(
          session?.courts ?? defaultCourtsForDate(date),
        );
        const booked = session?.booked_spots ?? 0;

        const { rows: memberCountRows } = await client.query(
          `SELECT COUNT(*)::int AS count FROM memberships
           WHERE day = $3 AND period_start <= $1 AND period_end >= $1
             AND (
               status = 'active'
               OR (status = 'pending' AND created_at > NOW() - ($2 * INTERVAL '1 minute'))
             );`,
          [date, PENDING_MEMBERSHIP_HOLD_MINUTES, day],
        );
        const activeMembers = (memberCountRows[0] as { count: number }).count;

        if (maxPlayers - activeMembers - booked > 0) {
          const periodEnd = addDays(date, MEMBERSHIP_DAYS[plan]);
          const { rows: inserted } = await client.query(
            `INSERT INTO memberships
               (email, plan, day, first_name, last_name, phone, period_start, period_end, recurring, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
             RETURNING id;`,
            [
              member.email,
              plan,
              day,
              member.firstName,
              member.lastName,
              member.phone,
              date,
              periodEnd,
              member.recurring,
            ],
          );
          await client.query("COMMIT");
          return {
            blocked: false,
            membershipId: (inserted[0] as { id: number }).id,
            periodStart: date,
            periodEnd,
          };
        }
        await client.query("ROLLBACK");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }

    return { blocked: true, reason: "sessions_full" };
  } finally {
    await client
      .query(`SELECT pg_advisory_unlock(hashtext($1));`, [lockKey])
      .catch(() => {});
    client.release();
  }
}

// Attaches a Stripe subscription/PaymentIntent id to a membership row created
// by assignAndReserveMembershipAccessStart, once the corresponding Stripe
// object has been created.
export async function attachStripeIdToMembership(
  membershipId: number,
  ids: { stripeSubscriptionId?: string; stripePaymentIntentId?: string },
): Promise<void> {
  if (ids.stripeSubscriptionId) {
    await sql`
      UPDATE memberships SET stripe_subscription_id = ${ids.stripeSubscriptionId}
      WHERE id = ${membershipId};
    `;
  }
  if (ids.stripePaymentIntentId) {
    await sql`
      UPDATE memberships SET stripe_payment_intent_id = ${ids.stripePaymentIntentId}
      WHERE id = ${membershipId};
    `;
  }
}

export async function upsertSessionFromCalendar(
  date: string,
  event: {
    id: string;
    summary?: string;
    start: string;
    end?: string;
    location?: string;
  },
): Promise<void> {
  // courts is set only on insert (never in the DO UPDATE SET below) so a
  // recurring calendar resync never clobbers an admin's manual court
  // override for a date that's already been synced once.
  await sql`
    INSERT INTO sessions (date, max_spots, booked_spots, courts, google_event_id, calendar_summary, event_start_time, event_end_time, event_location, synced_at)
    VALUES (${date}, ${SESSION_CAPACITY}, 0, ${defaultCourtsForDate(date)}, ${event.id}, ${event.summary ?? null}, ${event.start}, ${event.end ?? null}, ${event.location ?? null}, NOW())
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
    SELECT date::text AS date, courts, booked_spots, event_start_time, event_end_time, event_location
    FROM sessions
    WHERE date >= ${from} AND date <= ${to} AND google_event_id IS NOT NULL
    ORDER BY date;
  `;
  return rows.map((row) => {
    const r = row as {
      date: string;
      courts: number;
      booked_spots: number;
      event_start_time: Date | null;
      event_end_time: Date | null;
      event_location: string | null;
    };
    return {
      date: r.date,
      maxSpots: maxPlayersForCourts(r.courts),
      bookedSpots: r.booked_spots,
      eventStartTime: r.event_start_time
        ? r.event_start_time.toISOString()
        : null,
      eventEndTime: r.event_end_time ? r.event_end_time.toISOString() : null,
      eventLocation: r.event_location,
    };
  });
}

// Postgres CURRENT_DATE is UTC-based, which disagrees with the club's
// Pacific/Auckland "today" for roughly half of every NZ calendar day —
// exactly the same class of bug documented on getClubToday. Bind the club-
// local date explicitly instead of relying on the database's own clock, so
// this agrees with every other "today" computation in the app (e.g. the
// membership access-start search in assignAndReserveMembershipAccessStart).
export async function getUpcomingSessionDates(
  withinDays: number,
): Promise<string[]> {
  const { dateKey: clubToday } = getClubToday();
  const { rows } = await sql`
    SELECT date::text AS date FROM sessions
    WHERE date >= ${clubToday}::date AND date <= ${clubToday}::date + ${withinDays}::int
      AND google_event_id IS NOT NULL
    ORDER BY date;
  `;
  return rows.map((row) => (row as { date: string }).date);
}

export async function listAllSessionDates(): Promise<string[]> {
  const { rows } = await sql`
    SELECT date::text AS date FROM sessions
    WHERE google_event_id IS NOT NULL
    ORDER BY date;
  `;
  return rows.map((row) => (row as { date: string }).date);
}

// Members whose period covers this specific date AND whose day matches this
// date's membership day — the correct scoping for any per-play-day capacity
// calculation. Mirrors getRosterForDate's predicate. A casual-only day (no
// membership day) never has members occupying capacity.
export async function getActiveMemberCountForDate(
  date: string,
): Promise<number> {
  const day = getMembershipDayForDate(date);
  if (!day) return 0;
  const { rows } = await sql`
    SELECT COUNT(*)::int AS count FROM memberships
    WHERE status = 'active' AND day = ${day} AND period_start <= ${date} AND period_end >= ${date};
  `;
  return (rows[0] as { count: number })?.count ?? 0;
}

// Global active-member headcount, ignoring date range — only meaningful for
// an overall "N active members" summary stat, never for per-session capacity
// (use getActiveMemberCountForDate for that).
export async function getTotalActiveMemberCount(): Promise<number> {
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
  const casual =
    (rows[0] as { booked_spots: number } | undefined)?.booked_spots ?? 0;
  const members = await getActiveMemberCountForDate(date);
  return { casual, members, total: casual + members };
}

export async function getCourtsForDate(date: string): Promise<number> {
  await ensureSession(date);
  const { rows } = await sql`
    SELECT courts FROM sessions WHERE date = ${date};
  `;
  return (
    (rows[0] as { courts: number } | undefined)?.courts ??
    defaultCourtsForDate(date)
  );
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
  const booked =
    (rows[0] as { booked_spots: number } | undefined)?.booked_spots ?? 0;
  const activeMembers = await getActiveMemberCountForDate(date);
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

export type WaitlistEntry = {
  id: number;
  name: string;
  email: string;
  createdAt: string;
  notifiedAt: string | null;
};

function mapWaitlistRow(r: {
  id: number;
  name: string;
  email: string;
  created_at: Date;
  notified_at: Date | null;
}): WaitlistEntry {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    createdAt: r.created_at.toISOString(),
    notifiedAt: r.notified_at ? r.notified_at.toISOString() : null,
  };
}

export async function getWaitlistForDate(
  date: string,
): Promise<WaitlistEntry[]> {
  const { rows } = await sql`
    SELECT id, name, email, created_at, notified_at
    FROM waitlist
    WHERE session_date = ${date}
    ORDER BY created_at ASC;
  `;
  return rows.map((r) => mapWaitlistRow(r as Parameters<typeof mapWaitlistRow>[0]));
}

// Oldest-first, capped at `limit` — used by notifyWaitlistIfSpotOpened so a
// capacity increase of N spots only notifies (up to) N people at a time.
export async function getUnnotifiedWaitlistForDate(
  date: string,
  limit: number,
): Promise<WaitlistEntry[]> {
  if (limit <= 0) return [];
  const { rows } = await sql`
    SELECT id, name, email, created_at, notified_at
    FROM waitlist
    WHERE session_date = ${date} AND notified_at IS NULL
    ORDER BY created_at ASC
    LIMIT ${limit};
  `;
  return rows.map((r) => mapWaitlistRow(r as Parameters<typeof mapWaitlistRow>[0]));
}

export async function markWaitlistNotified(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await sql.query(
    `UPDATE waitlist SET notified_at = NOW() WHERE id = ANY($1::int[]);`,
    [ids],
  );
}

export async function deleteWaitlistEntry(id: number): Promise<void> {
  await sql`DELETE FROM waitlist WHERE id = ${id};`;
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
  // Membership access only applies on a membership day — see
  // getActiveMemberCountForDate.
  const rosterDay = getMembershipDayForDate(date);
  const { rows: memberRows } = rosterDay
    ? await sql`
        SELECT first_name, last_name, email, phone, plan
        FROM memberships
        WHERE status = 'active' AND day = ${rosterDay} AND period_start <= ${date} AND period_end >= ${date}
        ORDER BY created_at ASC;
      `
    : { rows: [] };

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
    name:
      `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() ||
      (r.email as string),
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
  plan: MembershipTier;
  day: MembershipDay;
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  recurring: boolean;
  stripeSubscriptionId: string | null;
  method: "card" | "cash";
};

function mapMembershipRow(r: {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  plan: string;
  day: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
  cancel_at_period_end: boolean;
  recurring: boolean;
  stripe_subscription_id: string | null;
  stripe_payment_intent_id: string | null;
}): MembershipRow {
  return {
    id: r.id,
    name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.email,
    email: r.email,
    phone: r.phone,
    plan: r.plan === "quarterly" ? "quarterly" : "monthly",
    day: r.day === "wednesday" ? "wednesday" : "friday",
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    recurring: r.recurring,
    stripeSubscriptionId: r.stripe_subscription_id,
    method: r.stripe_payment_intent_id?.startsWith("cash-invoice-")
      ? "cash"
      : "card",
  };
}

// Memberships still worth showing to the admin roster: active subscriptions
// and any already scheduled to lapse (so a pending cancellation stays visible
// until Stripe's period-end webhook flips the status).
export async function listMemberships(): Promise<MembershipRow[]> {
  const { rows } = await sql`
    SELECT id, email, first_name, last_name, phone, plan, day, period_start::text AS period_start, period_end::text AS period_end, status, cancel_at_period_end, recurring, stripe_subscription_id, stripe_payment_intent_id
    FROM memberships
    WHERE status IN ('active', 'trialing', 'past_due')
    ORDER BY plan, created_at DESC;
  `;
  return rows.map((r) =>
    mapMembershipRow(r as Parameters<typeof mapMembershipRow>[0]),
  );
}

export async function getMembershipById(
  id: number,
): Promise<MembershipRow | null> {
  const { rows } = await sql`
    SELECT id, email, first_name, last_name, phone, plan, day, period_start::text AS period_start, period_end::text AS period_end, status, cancel_at_period_end, recurring, stripe_subscription_id, stripe_payment_intent_id
    FROM memberships
    WHERE id = ${id};
  `;
  const row = rows[0];
  return row
    ? mapMembershipRow(row as Parameters<typeof mapMembershipRow>[0])
    : null;
}

export async function listActiveMembershipsByEmail(
  email: string,
): Promise<MembershipRow[]> {
  const { rows } = await sql`
    SELECT id, email, first_name, last_name, phone, plan, day, period_start::text AS period_start, period_end::text AS period_end, status, cancel_at_period_end, recurring, stripe_subscription_id, stripe_payment_intent_id
    FROM memberships
    WHERE status IN ('active', 'trialing', 'past_due')
      AND lower(email) = lower(${email})
      AND cancel_at_period_end = FALSE
      AND recurring = TRUE
    ORDER BY created_at DESC;
  `;
  return rows.map((r) =>
    mapMembershipRow(r as Parameters<typeof mapMembershipRow>[0]),
  );
}

export async function setMembershipCancelAtPeriodEnd(
  id: number,
): Promise<void> {
  await sql`
    UPDATE memberships SET cancel_at_period_end = TRUE WHERE id = ${id};
  `;
}

// Advances a recurring membership's access window by one billing cycle on
// renewal. Additive (rolls forward from whatever's stored, rather than
// resetting from Stripe's absolute period fields) so a delayed access-start
// offset set at signup is preserved indefinitely. Stripe delivers webhooks
// at-least-once, and this update is NOT naturally idempotent like the rest of
// this file's absolute-value writes — the last_renewal_invoice_id guard is
// required, or a duplicate delivery would silently grant an extra cycle.
export async function applyMembershipRenewal(
  subscriptionId: string,
  invoiceId: string,
): Promise<void> {
  await sql`
    UPDATE memberships
    SET
      period_end = period_end + (
        CASE plan WHEN 'monthly' THEN ${MEMBERSHIP_CYCLE_DAYS.monthly} WHEN 'quarterly' THEN ${MEMBERSHIP_CYCLE_DAYS.quarterly} ELSE 0 END
      ),
      last_renewal_invoice_id = ${invoiceId}
    WHERE stripe_subscription_id = ${subscriptionId}
      AND last_renewal_invoice_id IS DISTINCT FROM ${invoiceId};
  `;
}

// Activates a one-time-payment membership and, in the same statement, tells
// the caller whether this call is the one that actually flipped it — Stripe
// delivers webhooks at-least-once, so a plain unconditional UPDATE would
// have re-sent the "membership confirmed" email on every redelivery. A
// non-null return means "activate + email"; null means "already active,
// skip" (either a genuine duplicate delivery, or the row doesn't exist).
export async function activateMembershipByPaymentIntentId(
  paymentIntentId: string,
): Promise<MembershipRow | null> {
  const { rows } = await sql`
    UPDATE memberships SET status = 'active'
    WHERE stripe_payment_intent_id = ${paymentIntentId} AND status != 'active'
    RETURNING id, email, first_name, last_name, phone, plan, day, period_start::text AS period_start, period_end::text AS period_end, status, cancel_at_period_end, recurring, stripe_subscription_id;
  `;
  const row = rows[0];
  return row
    ? mapMembershipRow(row as Parameters<typeof mapMembershipRow>[0])
    : null;
}

// Same guard as activateMembershipByPaymentIntentId, for the recurring-
// subscription signup path (invoice.payment_succeeded, initial invoice).
export async function activateMembershipBySubscriptionId(
  subscriptionId: string,
): Promise<MembershipRow | null> {
  const { rows } = await sql`
    UPDATE memberships SET status = 'active'
    WHERE stripe_subscription_id = ${subscriptionId} AND status != 'active'
    RETURNING id, email, first_name, last_name, phone, plan, day, period_start::text AS period_start, period_end::text AS period_end, status, cancel_at_period_end, recurring, stripe_subscription_id;
  `;
  const row = rows[0];
  return row
    ? mapMembershipRow(row as Parameters<typeof mapMembershipRow>[0])
    : null;
}

export type MembershipReminderTarget = {
  membershipId: number;
  email: string;
  firstName: string;
  plan: MembershipTier;
  day: MembershipDay;
  periodEnd: string;
};

// Active members whose membership period covers `date` — the pool eligible
// for the day-before reminder cron (app/api/cron/membership-reminders).
export async function getMembersWithPlayDayTomorrow(
  date: string,
): Promise<MembershipReminderTarget[]> {
  const membershipDay = getMembershipDayForDate(date);
  if (!membershipDay) return [];
  const { rows } = await sql`
    SELECT id, email, first_name, plan, day, period_end::text AS period_end
    FROM memberships
    WHERE status = 'active' AND day = ${membershipDay} AND period_start <= ${date} AND period_end >= ${date};
  `;
  return rows.map((r) => {
    const row = r as {
      id: number;
      email: string;
      first_name: string | null;
      plan: string;
      day: string;
      period_end: string;
    };
    return {
      membershipId: row.id,
      email: row.email,
      firstName: row.first_name ?? "",
      plan: row.plan === "quarterly" ? "quarterly" : "monthly",
      day: row.day === "wednesday" ? "wednesday" : "friday",
      periodEnd: row.period_end,
    };
  });
}

// Every synced play day for the given membership day, from `fromDate`
// through `periodEnd` (inclusive) — the "remaining sessions in their
// membership period" list for the reminder email. Only synced
// (google_event_id set) dates are included, matching every other
// bookable-date computation in the app.
export async function getRemainingSessionDatesInPeriod(
  fromDate: string,
  periodEnd: string,
  day: MembershipDay,
): Promise<string[]> {
  const dow = MEMBERSHIP_DAY_TO_DOW[day];
  const { rows } = await sql`
    SELECT date::text AS date FROM sessions
    WHERE date >= ${fromDate} AND date <= ${periodEnd} AND google_event_id IS NOT NULL
      AND EXTRACT(DOW FROM date) = ${dow}
    ORDER BY date;
  `;
  return rows.map((row) => (row as { date: string }).date);
}

// Atomic dedup claim for the reminder cron: returns true only for the call
// that actually inserted the row, so a retried or double-triggered cron run
// never sends the same member two reminders for the same play day.
export async function claimMembershipReminder(
  membershipId: number,
  sessionDate: string,
): Promise<boolean> {
  const { rowCount } = await sql`
    INSERT INTO membership_reminders_sent (membership_id, session_date)
    VALUES (${membershipId}, ${sessionDate})
    ON CONFLICT (membership_id, session_date) DO NOTHING;
  `;
  return (rowCount ?? 0) > 0;
}

export type CasualReminderTarget = {
  bookingId: number;
  email: string;
  firstName: string;
};

// Confirmed casual bookings for `date` — the pool eligible for the
// day-before reminder cron (app/api/cron/membership-reminders), alongside
// active members.
export async function getCasualBookingsForDate(
  date: string,
): Promise<CasualReminderTarget[]> {
  const { rows } = await sql`
    SELECT id, email, first_name
    FROM bookings
    WHERE session_date = ${date} AND status = 'confirmed';
  `;
  return rows.map((r) => {
    const row = r as { id: number; email: string; first_name: string | null };
    return {
      bookingId: row.id,
      email: row.email,
      firstName: row.first_name ?? "",
    };
  });
}

// Atomic dedup claim mirroring claimMembershipReminder, for casual bookings.
export async function claimBookingReminder(bookingId: number): Promise<boolean> {
  const { rowCount } = await sql`
    UPDATE bookings SET reminder_sent_at = NOW()
    WHERE id = ${bookingId} AND reminder_sent_at IS NULL;
  `;
  return (rowCount ?? 0) > 0;
}
