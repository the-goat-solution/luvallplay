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
  DEFAULT_PAUSED_DAYS,
  MEMBERSHIP_CYCLE_DAYS,
  MEMBERSHIP_DAYS,
  MEMBERSHIP_DAY_TO_DOW,
  MEMBERSHIP_START_SEARCH_DAYS,
  PENDING_MEMBERSHIP_HOLD_MINUTES,
  MINI_GAME_MAX_PLAYERS,
  SESSION_CAPACITY,
  sessionMaxPlayers,
  type MembershipDay,
  type MembershipTier,
} from "./constants";
import {
  defaultCourtsForDate,
  getClubToday,
  getMembershipDayForDate,
} from "./dates";
import { onceThisDeploy } from "./schema-gate";
import { memberHasRoom } from "./membership-start";
import { paymentMethodFromRef, type PaymentMethod } from "./offline-payment";

// Every route touching the DB calls ensureTables() first, and it's ~24
// sequential DDL statements — cheap individually but a heavy tax when paid
// on every request. The DDL is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS), so it only ever needs to actually run once per warm server
// instance; memoize the promise so later calls resolve immediately.
let ensureTablesPromise: Promise<void> | null = null;

export function ensureTables(): Promise<void> {
  if (!ensureTablesPromise) {
    ensureTablesPromise = onceThisDeploy("core", ensureTablesImpl).catch((err) => {
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
  // One-time membership renewal (see lib/membership-renewal.ts): the cron
  // emails a private renewal link 5 days before period_end. The token in that
  // link is what opens renewal for the member; renewal_reminder_sent_at
  // guarantees one reminder per membership. A renewal row points back at the
  // membership it continues via renewal_of.
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS renewal_token TEXT UNIQUE;`;
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS renewal_reminder_sent_at TIMESTAMPTZ;`;
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS renewal_of INT;`;
  // Total free days an admin has given this membership ("Give free month"),
  // shown on the Members page.
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS free_days_granted INT NOT NULL DEFAULT 0;`;
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
  // Admin switch that closes registration for a play day before it's full.
  // While set, the day offers no casual spots and new memberships won't
  // start on it; existing bookings and members keep their places.
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS registration_locked BOOLEAN NOT NULL DEFAULT FALSE;`;
  // Mini game day: capacity is MINI_GAME_MAX_PLAYERS whatever the courts,
  // and registration is locked while it's on (see setMiniGameDay).
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mini_game BOOLEAN NOT NULL DEFAULT FALSE;`;
  // Set once a "spot opened" email has actually been sent for this waitlist
  // row, so notifyWaitlistIfSpotOpened (lib/waitlist-notify.ts) never
  // double-emails someone across repeated capacity-increase triggers.
  await sql`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;`;
  // People asking to be emailed when a weekday opens up for play — either a
  // paused day coming back (see day_signup_settings below) or a day the club
  // doesn't run yet. notified_at is set once the "it's open" email has sent.
  await sql`
    CREATE TABLE IF NOT EXISTS day_requests (
      id SERIAL PRIMARY KEY,
      day TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notified_at TIMESTAMPTZ
    );
  `;
  // One pending request per person per day, so a double submit (or asking
  // twice) doesn't send them two "it's open" emails.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS day_requests_pending_idx
      ON day_requests (day, LOWER(email))
      WHERE notified_at IS NULL;
  `;
  // Admin switch pausing public sign-ups (memberships and casual bookings)
  // for every play day on a weekday. Seeded once from DEFAULT_PAUSED_DAYS;
  // ON CONFLICT DO NOTHING means an admin's later choice is never undone.
  await sql`
    CREATE TABLE IF NOT EXISTS day_signup_settings (
      day TEXT PRIMARY KEY,
      paused BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  for (const day of DEFAULT_PAUSED_DAYS) {
    await sql`
      INSERT INTO day_signup_settings (day, paused)
      VALUES (${day}, TRUE)
      ON CONFLICT (day) DO NOTHING;
    `;
  }
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
  // A player standing in for a member (or casual booking) who can't make a
  // given session. The original player has already paid, so a fill-in is
  // purely a substitution: it never creates a booking, never touches
  // capacity, and carries no payment of its own. Exactly one of
  // membership_id / booking_id identifies whose spot is being filled.
  await sql`
    CREATE TABLE IF NOT EXISTS session_fill_ins (
      id SERIAL PRIMARY KEY,
      session_date DATE NOT NULL,
      membership_id INT,
      booking_id INT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT session_fill_ins_one_target CHECK (
        (membership_id IS NULL) <> (booking_id IS NULL)
      )
    );
  `;
  // One fill-in per player per session — the partial indexes let the unused
  // target column stay NULL without colliding (NULLs aren't equal in a
  // plain UNIQUE constraint, so every row would otherwise be "distinct").
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS session_fill_ins_membership_idx
      ON session_fill_ins (session_date, membership_id)
      WHERE membership_id IS NOT NULL;
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS session_fill_ins_booking_idx
      ON session_fill_ins (session_date, booking_id)
      WHERE booking_id IS NOT NULL;
  `;
  // A member saying "Can't make it" for one play day (profile Membership
  // tab). They don't count toward that day's headcount or roster, so their
  // spot opens up for a casual player.
  await sql`
    CREATE TABLE IF NOT EXISTS player_absences (
      session_date DATE NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (session_date, email)
    );
  `;
}

// A member who said they can't make that play day (see player_absences).
// `dateExpr` / `alias` as for membershipCoversDateSql.
export function memberNotAbsentSql(dateExpr: string, alias = ""): string {
  const c = alias ? `${alias}.` : "";
  return `NOT EXISTS (
    SELECT 1 FROM player_absences pa
    WHERE pa.session_date = ${dateExpr} AND pa.email = lower(trim(${c}email))
  )`;
}

// Whether a `memberships` row grants access to a given play day.
//
// period_start..period_end is only the CURRENT billing cycle: period_end
// moves forward when Stripe's renewal invoice is paid (see
// applyMembershipRenewal), which happens at the END of that cycle. So for
// most of every cycle the next play day past period_end falls outside the
// stored window, and a member who is plainly going to be there is counted as
// absent — the roster and headcount under-report that day, and casual
// bookings oversell the court against the spot they'll occupy.
//
// An auto-renewing subscription that isn't scheduled to stop (recurring, and
// no pending cancel_at_period_end) therefore covers every play day from
// period_start onward, not just the cycle that happens to be paid for right
// now. One-time memberships (recurring = FALSE, e.g. cash members) and
// subscriptions already set to cancel keep the hard period_end, since those
// genuinely do lapse.
//
// `dateExpr` is whatever SQL yields the play day being tested — a bind
// placeholder like `$1`, or a column such as `t.d`. Callers must also filter
// on status and `day` themselves; this covers the date window only.
export function membershipCoversDateSql(dateExpr: string, alias = ""): string {
  const c = alias ? `${alias}.` : "";
  return `(
    ${c}period_start <= ${dateExpr}
    AND (
      ${c}period_end >= ${dateExpr}
      OR (${c}recurring AND ${c}cancel_at_period_end = FALSE)
    )
  )`;
}

// The effective end of a member's access window as of `dateExpr`: the stored
// period_end rolled forward by whole billing cycles until it covers that day.
// For a member whose stored window already covers the date this is a no-op,
// so it's safe to apply unconditionally.
export function projectedPeriodEndSql(dateExpr: string): string {
  return `(
    period_end + (
      CASE plan WHEN 'quarterly' THEN ${MEMBERSHIP_CYCLE_DAYS.quarterly} ELSE ${MEMBERSHIP_CYCLE_DAYS.monthly} END
      * GREATEST(
          0,
          CEIL(
            (${dateExpr}::date - period_end)::numeric
            / CASE plan WHEN 'quarterly' THEN ${MEMBERSHIP_CYCLE_DAYS.quarterly} ELSE ${MEMBERSHIP_CYCLE_DAYS.monthly} END
          )::int
        )
    )
  )`;
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
//
// A play day with registration locked by an admin reports 0 spots, unless
// ignoreLock is set (admin-side adds, which bypass the lock on purpose).
export async function getAvailableSpots(
  date: string,
  { ignoreLock = false }: { ignoreLock?: boolean } = {},
): Promise<number> {
  await ensureSession(date);
  const { rows } = await sql`
    SELECT booked_spots, courts, registration_locked, mini_game FROM sessions WHERE date = ${date};
  `;
  const row = rows[0] as
    | { booked_spots: number; courts: number; registration_locked: boolean; mini_game: boolean }
    | undefined;
  if (row?.registration_locked && !ignoreLock) return 0;
  const booked = row?.booked_spots ?? 0;
  const maxPlayers = sessionMaxPlayers(row?.courts ?? defaultCourtsForDate(date), row?.mini_game);
  const activeMembers = await getActiveMemberCountForDate(date);
  return Math.max(0, maxPlayers - activeMembers - booked);
}

// Batched variant of getAvailableSpots + getSessionHeadcount for the
// multi-date "Next Session" widget: instead of 3 sequential round trips per
// date, this does 1 upsert + 2 queries (in parallel) for the whole batch.
export async function getSpotsAndHeadcountForDates(dates: string[]): Promise<{
  spots: Record<string, number>;
  signedUp: Record<string, number>;
  locked: Record<string, boolean>;
  // Mini game days: locked to casual sign-ups, but members are always in.
  miniGame: Record<string, boolean>;
}> {
  if (dates.length === 0) return { spots: {}, signedUp: {}, locked: {}, miniGame: {} };

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
      `SELECT date::text AS date, booked_spots, courts, registration_locked, mini_game FROM sessions WHERE date = ANY($1::date[]);`,
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
         ON m.status = 'active' AND m.day = t.day AND ${membershipCoversDateSql("t.d", "m")}
           AND ${memberNotAbsentSql("t.d", "m")}
       GROUP BY t.d;`,
      [dates, membershipDays],
    ),
  ]);

  const bookedByDate = new Map<string, number>();
  const courtsByDate = new Map<string, number>();
  const lockedDates = new Set<string>();
  const miniGameDates = new Set<string>();
  for (const row of rows) {
    const r = row as {
      date: string;
      booked_spots: number;
      courts: number;
      registration_locked: boolean;
      mini_game: boolean;
    };
    bookedByDate.set(r.date, r.booked_spots);
    courtsByDate.set(r.date, r.courts);
    if (r.registration_locked) lockedDates.add(r.date);
    if (r.mini_game) miniGameDates.add(r.date);
  }
  const membersByDate = new Map<string, number>();
  for (const row of memberRows) {
    const r = row as { date: string; active_members: number };
    membersByDate.set(r.date, r.active_members);
  }

  const spots: Record<string, number> = {};
  const signedUp: Record<string, number> = {};
  const locked: Record<string, boolean> = {};
  const miniGame: Record<string, boolean> = {};
  for (const date of dates) {
    const booked = bookedByDate.get(date) ?? 0;
    // Already scoped to the right membership day (or zero for casual-only
    // dates) by the day-matched join above — see getActiveMemberCountForDate
    // for the equivalent single-date query.
    const activeMembers = membersByDate.get(date) ?? 0;
    const maxPlayers = sessionMaxPlayers(
      courtsByDate.get(date) ?? defaultCourtsForDate(date),
      miniGameDates.has(date),
    );
    locked[date] = lockedDates.has(date);
    miniGame[date] = miniGameDates.has(date);
    spots[date] = locked[date] ? 0 : Math.max(0, maxPlayers - activeMembers - booked);
    signedUp[date] = booked + activeMembers;
  }
  return { spots, signedUp, locked, miniGame };
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
  const { rowCount } = await sql.query(
    `UPDATE sessions
     SET booked_spots = booked_spots + 1
     WHERE date = $1
       AND booked_spots < (
         CASE
           WHEN mini_game THEN $3
           WHEN courts = 1 THEN 6
           WHEN courts = 2 THEN 12
           WHEN courts = 3 THEN 18
           WHEN courts = 4 THEN 22
           ELSE $2
         END
       ) - (
         SELECT COUNT(*)::int FROM memberships
         WHERE status = 'active'
           AND day = CASE EXTRACT(DOW FROM sessions.date) WHEN 5 THEN 'friday' WHEN 3 THEN 'wednesday' END
           AND ${membershipCoversDateSql("$1")}
           AND ${memberNotAbsentSql("$1::date")}
       );`,
    [date, SESSION_CAPACITY, MINI_GAME_MAX_PLAYERS],
  );
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
  | { blocked: true; reason: "sessions_full" | "already_member" | "invalid_date" };

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
  // Admin-chosen start date (cash member signup), overriding the default
  // nearest-available search below. Re-validated here regardless of
  // whatever the client sent — must be an actual synced play day matching
  // this membership day, not already in the past per the same cutoff rule
  // the search uses — so a stale or tampered value can't target a bogus
  // date. `blocked: true, reason: "invalid_date"` if it doesn't hold up.
  preferredDate?: string,
  // Renewing a one-time membership: that membership doesn't count as a
  // conflict, and the new one starts on the first play day with room after
  // it ends (or the usual nearest day, if it has already ended).
  renewalOf?: { membershipId: number; periodEnd: string },
): Promise<MembershipAssignment> {
  const { dateKey: clubToday, cutoffPassed } = getClubToday();
  const earliestStart = (() => {
    const fromToday = addDays(clubToday, cutoffPassed ? 1 : 0);
    if (!renewalOf) return fromToday;
    const afterCurrent = addDays(renewalOf.periodEnd, 1);
    return afterCurrent > fromToday ? afterCurrent : fromToday;
  })();
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

    // A lapsed one-time membership is only marked 'expired' by the daily
    // status upkeep (lib/membership-status.ts), so between its end date and
    // that run it can still read 'active' — require period_end >= today
    // rather than trusting status alone, so a member whose old plan already
    // ended can always sign up again for the same day.
    const { rows: conflictRows } = await client.query(
      `SELECT id FROM memberships
       WHERE lower(email) = lower($1) AND day = $2
         AND id <> $5
         AND (
           (status IN ('active', 'trialing', 'past_due') AND (period_end IS NULL OR period_end >= $3))
           OR (status = 'pending' AND created_at > NOW() - ($4 * INTERVAL '1 minute'))
         )
       LIMIT 1;`,
      [
        member.email,
        day,
        clubToday,
        PENDING_MEMBERSHIP_HOLD_MINUTES,
        renewalOf?.membershipId ?? 0,
      ],
    );
    if (conflictRows.length > 0) {
      return { blocked: true, reason: "already_member" };
    }

    const { rows: candidates } = preferredDate
      ? await client.query(
          `SELECT date::text AS date FROM sessions
           WHERE date = $1 AND google_event_id IS NOT NULL AND EXTRACT(DOW FROM date) = $2
             AND date >= $3::date;`,
          [preferredDate, dow, earliestStart],
        )
      : await client.query(
          // A play day an admin has locked never becomes a new member's
          // first day; the admin-chosen preferredDate above bypasses this.
          // A mini game day is the exception: its lock is for casual sign-ups
          // only, members are always included (see isMemberStartCandidate).
          `SELECT date::text AS date FROM sessions
           WHERE google_event_id IS NOT NULL
             AND (NOT registration_locked OR mini_game)
             AND EXTRACT(DOW FROM date) = $2
             AND date >= $1::date
             AND date <= ($1::date + $3::int)
           ORDER BY date;`,
          [earliestStart, dow, MEMBERSHIP_START_SEARCH_DAYS],
        );

    if (preferredDate && candidates.length === 0) {
      return { blocked: true, reason: "invalid_date" };
    }

    for (const row of candidates) {
      const date = (row as { date: string }).date;

      await client.query("BEGIN");
      try {
        const { rows: sessionRows } = await client.query(
          `SELECT booked_spots, courts, mini_game FROM sessions WHERE date = $1 FOR UPDATE;`,
          [date],
        );
        const session = sessionRows[0] as
          | { booked_spots: number; courts: number; mini_game: boolean }
          | undefined;
        const maxPlayers = sessionMaxPlayers(
          session?.courts ?? defaultCourtsForDate(date),
          session?.mini_game,
        );
        const booked = session?.booked_spots ?? 0;

        const { rows: memberCountRows } = await client.query(
          `SELECT COUNT(*)::int AS count FROM memberships
           WHERE day = $3 AND ${membershipCoversDateSql("$1")}
             AND (
               status = 'active'
               OR (status = 'pending' AND created_at > NOW() - ($2 * INTERVAL '1 minute'))
             );`,
          [date, PENDING_MEMBERSHIP_HOLD_MINUTES, day],
        );
        const activeMembers = (memberCountRows[0] as { count: number }).count;

        if (
          memberHasRoom({
            miniGame: Boolean(session?.mini_game),
            maxPlayers,
            activeMembers,
            booked,
          })
        ) {
          const periodEnd = addDays(date, MEMBERSHIP_DAYS[plan]);
          const { rows: inserted } = await client.query(
            `INSERT INTO memberships
               (email, plan, day, first_name, last_name, phone, period_start, period_end, recurring, status, renewal_of)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)
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
              renewalOf?.membershipId ?? null,
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
    SELECT date::text AS date, courts, mini_game, booked_spots, event_start_time, event_end_time, event_location
    FROM sessions
    WHERE date >= ${from} AND date <= ${to} AND google_event_id IS NOT NULL
    ORDER BY date;
  `;
  return rows.map((row) => {
    const r = row as {
      date: string;
      courts: number;
      mini_game: boolean;
      booked_spots: number;
      event_start_time: Date | null;
      event_end_time: Date | null;
      event_location: string | null;
    };
    return {
      date: r.date,
      maxSpots: sessionMaxPlayers(r.courts, r.mini_game),
      bookedSpots: r.booked_spots,
      eventStartTime: r.event_start_time
        ? r.event_start_time.toISOString()
        : null,
      eventEndTime: r.event_end_time ? r.event_end_time.toISOString() : null,
      eventLocation: r.event_location,
    };
  });
}

// Mini game play days on a membership's weekday within its period. Members
// are always included in a mini game, so their confirmation email names
// these days (and points to "Can't make it" in the app).
export async function listMemberMiniGameDates(
  day: MembershipDay,
  from: string,
  to: string,
): Promise<string[]> {
  const { rows } = await sql`
    SELECT date::text AS date FROM sessions
    WHERE mini_game AND google_event_id IS NOT NULL
      AND date >= ${from} AND date <= ${to}
      AND EXTRACT(DOW FROM date) = ${MEMBERSHIP_DAY_TO_DOW[day]}
    ORDER BY date;
  `;
  return rows.map((r) => (r as { date: string }).date);
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

// Members with access to this specific date (see membershipCoversDateSql,
// which counts an auto-renewing subscription past its current cycle) AND
// whose day matches this date's membership day — the correct scoping for any
// per-play-day capacity calculation. Mirrors getRosterForDate's predicate. A
// casual-only day (no membership day) never has members occupying capacity.
export async function getActiveMemberCountForDate(
  date: string,
): Promise<number> {
  const day = getMembershipDayForDate(date);
  if (!day) return 0;
  const { rows } = await sql.query(
    `SELECT COUNT(*)::int AS count FROM memberships
     WHERE status = 'active' AND day = $2 AND ${membershipCoversDateSql("$1")}
       AND ${memberNotAbsentSql("$1::date")};`,
    [date, day],
  );
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

export async function isRegistrationLocked(date: string): Promise<boolean> {
  const { rows } = await sql`
    SELECT registration_locked FROM sessions WHERE date = ${date};
  `;
  return Boolean((rows[0] as { registration_locked: boolean } | undefined)?.registration_locked);
}

export async function setRegistrationLocked(date: string, locked: boolean): Promise<void> {
  await ensureSession(date);
  await sql`
    UPDATE sessions SET registration_locked = ${locked} WHERE date = ${date};
  `;
}

export async function isMiniGameDay(date: string): Promise<boolean> {
  const { rows } = await sql`
    SELECT mini_game FROM sessions WHERE date = ${date};
  `;
  return Boolean((rows[0] as { mini_game: boolean } | undefined)?.mini_game);
}

// Turns a play day into a mini game day (or back). On: capacity becomes
// MINI_GAME_MAX_PLAYERS whatever the courts, and registration is locked so
// only admins add players. Refused when more players than that are already
// signed up — same rule as shrinking the courts. Off: back to court-based
// capacity, and registration reopens.
export async function setMiniGameDay(
  date: string,
  on: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await ensureSession(date);
  if (on) {
    const { total } = await getSessionHeadcount(date);
    if (total > MINI_GAME_MAX_PLAYERS) {
      return {
        ok: false,
        reason: `Can't make this a mini game day (max ${MINI_GAME_MAX_PLAYERS} players) — ${total} players are already signed up.`,
      };
    }
  }
  await sql`
    UPDATE sessions SET mini_game = ${on}, registration_locked = ${on} WHERE date = ${date};
  `;
  return { ok: true };
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
  const { rows } = await sql`
    SELECT booked_spots, mini_game FROM sessions WHERE date = ${date};
  `;
  const row = rows[0] as { booked_spots: number; mini_game: boolean } | undefined;
  const booked = row?.booked_spots ?? 0;
  // On a mini game day the field size, not the courts, sets capacity.
  const maxPlayers = sessionMaxPlayers(courts, row?.mini_game);
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

export type RosterFillIn = {
  id: number;
  name: string;
  /** As entered at sign-up, so two-word given names stay whole. */
  firstName: string;
  email: string;
  phone: string | null;
};

export type RosterEntry = {
  bookingId: number | null;
  membershipId: number | null;
  name: string;
  /** As entered at sign-up, so two-word given names stay whole. */
  firstName: string;
  email: string;
  phone: string | null;
  type: "casual" | "monthly" | "quarterly";
  method: PaymentMethod;
  /** Booking / membership payment reference (offline payments: see lib/offline-payment.ts). */
  paymentRef: string | null;
  /** Members only: the membership window that puts them on this roster. */
  periodStart?: string | null;
  periodEnd?: string | null;
  /** Members only: auto-renews (so the end date keeps moving on). */
  autoRenews?: boolean;
  // Set when someone is standing in for this player on this date. The
  // original entry is kept (they paid for the spot) — callers render them
  // as replaced rather than dropping them, and headcount is unaffected
  // because a fill-in occupies the spot that was already counted.
  fillIn: RosterFillIn | null;
};

export async function getRosterForDate(date: string): Promise<RosterEntry[]> {
  const { rows: bookingRows } = await sql`
    SELECT id, first_name, last_name, email, phone, payment_intent_id
    FROM bookings
    WHERE session_date = ${date} AND status = 'confirmed'
    ORDER BY created_at ASC;
  `;
  const { rows: fillInRows } = await sql`
    SELECT id, membership_id, booking_id, first_name, last_name, email, phone
    FROM session_fill_ins
    WHERE session_date = ${date};
  `;
  const fillInByBooking = new Map<number, RosterFillIn>();
  const fillInByMembership = new Map<number, RosterFillIn>();
  for (const row of fillInRows) {
    const r = row as {
      id: number;
      membership_id: number | null;
      booking_id: number | null;
      first_name: string;
      last_name: string;
      email: string;
      phone: string | null;
    };
    const entry: RosterFillIn = {
      id: r.id,
      name: `${r.first_name} ${r.last_name}`.trim(),
      firstName: (r.first_name ?? "").trim(),
      email: r.email,
      phone: r.phone,
    };
    if (r.booking_id !== null) fillInByBooking.set(r.booking_id, entry);
    if (r.membership_id !== null) fillInByMembership.set(r.membership_id, entry);
  }
  // Membership access only applies on a membership day — see
  // getActiveMemberCountForDate.
  const rosterDay = getMembershipDayForDate(date);
  const { rows: memberRows } = rosterDay
    ? await sql.query(
        `SELECT id, first_name, last_name, email, phone, plan,
                period_start::text AS period_start, period_end::text AS period_end,
                recurring, cancel_at_period_end, stripe_payment_intent_id
         FROM memberships
         WHERE status = 'active' AND day = $2 AND ${membershipCoversDateSql("$1")}
           AND ${memberNotAbsentSql("$1::date")}
         ORDER BY created_at ASC;`,
        [date, rosterDay],
      )
    : { rows: [] };

  const casual: RosterEntry[] = bookingRows.map((r) => ({
    bookingId: r.id as number,
    membershipId: null,
    name: `${r.first_name} ${r.last_name}`.trim(),
    firstName: String(r.first_name ?? "").trim(),
    email: r.email as string,
    phone: (r.phone as string | null) ?? null,
    type: "casual",
    method: paymentMethodFromRef(r.payment_intent_id as string | null),
    paymentRef: (r.payment_intent_id as string | null) ?? null,
    fillIn: fillInByBooking.get(r.id as number) ?? null,
  }));

  const members: RosterEntry[] = memberRows.map((r) => ({
    bookingId: null,
    membershipId: r.id as number,
    name:
      `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() ||
      (r.email as string),
    firstName: String(r.first_name ?? "").trim(),
    email: r.email as string,
    phone: (r.phone as string | null) ?? null,
    type: r.plan === "quarterly" ? "quarterly" : "monthly",
    method: paymentMethodFromRef(r.stripe_payment_intent_id as string | null),
    paymentRef: (r.stripe_payment_intent_id as string | null) ?? null,
    periodStart: (r.period_start as string | null) ?? null,
    periodEnd: (r.period_end as string | null) ?? null,
    autoRenews: Boolean(r.recurring) && !r.cancel_at_period_end,
    fillIn: fillInByMembership.get(r.id as number) ?? null,
  }));

  return [...casual, ...members];
}

export type FillInTarget =
  | { membershipId: number; bookingId?: undefined }
  | { bookingId: number; membershipId?: undefined };

export type FillInInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
};

// Records (or replaces) the stand-in for one player on one date. Upsert
// rather than insert so the admin "Edit" flow reuses the same call — the
// partial unique indexes on session_fill_ins make the conflict target a
// single (date, player) pair.
export async function saveSessionFillIn(
  date: string,
  target: FillInTarget,
  input: FillInInput,
): Promise<void> {
  const membershipId = target.membershipId ?? null;
  const bookingId = target.bookingId ?? null;
  const conflict =
    membershipId !== null
      ? "(session_date, membership_id) WHERE membership_id IS NOT NULL"
      : "(session_date, booking_id) WHERE booking_id IS NOT NULL";
  await sql.query(
    `INSERT INTO session_fill_ins
       (session_date, membership_id, booking_id, first_name, last_name, email, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ${conflict}
     DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       email = EXCLUDED.email,
       phone = EXCLUDED.phone;`,
    [
      date,
      membershipId,
      bookingId,
      input.firstName,
      input.lastName,
      input.email,
      input.phone,
    ],
  );
}

// Clears the stand-in — the original player is back on the roster as normal.
export async function removeSessionFillIn(
  date: string,
  target: FillInTarget,
): Promise<void> {
  if (target.membershipId !== undefined) {
    await sql`
      DELETE FROM session_fill_ins
      WHERE session_date = ${date} AND membership_id = ${target.membershipId};
    `;
    return;
  }
  await sql`
    DELETE FROM session_fill_ins
    WHERE session_date = ${date} AND booking_id = ${target.bookingId!};
  `;
}

export type MembershipRow = {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
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
  method: PaymentMethod;
  /** When the one-time renewal reminder went out (only selected by listMemberships). */
  renewalReminderSentAt?: string | null;
  /** Free days given by an admin (only selected by listMemberships). */
  freeDaysGranted?: number;
  stripePaymentIntentId?: string | null;
  createdAt?: string | null;
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
  renewal_reminder_sent_at?: Date | null;
  free_days_granted?: number;
  created_at?: Date | null;
}): MembershipRow {
  return {
    id: r.id,
    name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.email,
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
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
    method: paymentMethodFromRef(r.stripe_payment_intent_id),
    renewalReminderSentAt: r.renewal_reminder_sent_at
      ? r.renewal_reminder_sent_at.toISOString()
      : null,
    freeDaysGranted: r.free_days_granted ?? 0,
    stripePaymentIntentId: r.stripe_payment_intent_id ?? null,
    createdAt: r.created_at ? r.created_at.toISOString() : null,
  };
}

// Memberships still worth showing to the admin roster: active subscriptions
// and any already scheduled to lapse (so a pending cancellation stays visible
// until Stripe's period-end webhook flips the status).
export async function listMemberships(): Promise<MembershipRow[]> {
  const { rows } = await sql`
    SELECT id, email, first_name, last_name, phone, plan, day, period_start::text AS period_start, period_end::text AS period_end, status, cancel_at_period_end, recurring, stripe_subscription_id, stripe_payment_intent_id, renewal_reminder_sent_at, free_days_granted
    FROM memberships
    WHERE status IN ('active', 'trialing', 'past_due', 'unpaid', 'incomplete')
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

// Immediately deactivates a membership rather than waiting for period end —
// used for cash (non-recurring) members, which have no Stripe subscription
// to schedule a cancellation against, so "remove" means "stop counting
// toward capacity and drop off the roster right now" instead of the
// cancel-at-period-end flow recurring members get.
export async function cancelMembershipImmediately(id: number): Promise<void> {
  await sql`
    UPDATE memberships SET status = 'canceled' WHERE id = ${id};
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
// An 'expired' or 'canceled' row is never revived by a late redelivery.
export async function activateMembershipByPaymentIntentId(
  paymentIntentId: string,
): Promise<MembershipRow | null> {
  const { rows } = await sql`
    UPDATE memberships SET status = 'active'
    WHERE stripe_payment_intent_id = ${paymentIntentId}
      AND status NOT IN ('active', 'expired', 'canceled')
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

// Active members with access to `date` (auto-renewing subscriptions included
// past their current cycle — see membershipCoversDateSql) — the pool eligible
// for the day-before reminder cron (app/api/cron/membership-reminders).
export async function getMembersWithPlayDayTomorrow(
  date: string,
): Promise<MembershipReminderTarget[]> {
  const membershipDay = getMembershipDayForDate(date);
  if (!membershipDay) return [];
  // period_end is reported as the projected one so the reminder email's
  // "remaining sessions in your membership" list still spans a real cycle for
  // a member whose renewal hasn't billed yet.
  const { rows } = await sql.query(
    `SELECT id, email, first_name, plan, day,
            ${projectedPeriodEndSql("$1")}::text AS period_end
     FROM memberships
     WHERE status = 'active' AND day = $2 AND ${membershipCoversDateSql("$1")}
       AND ${memberNotAbsentSql("$1::date")};`,
    [date, membershipDay],
  );
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

// Columns shared by the renewal lookups below — same shape mapMembershipRow
// expects.
const MEMBERSHIP_COLUMNS = `id, email, first_name, last_name, phone, plan, day,
  period_start::text AS period_start, period_end::text AS period_end, status,
  cancel_at_period_end, recurring, stripe_subscription_id,
  stripe_payment_intent_id, renewal_reminder_sent_at, free_days_granted, created_at`;

// Active one-time (non-recurring) memberships ending between `from` and
// `through` (inclusive) that haven't had a renewal reminder yet and haven't
// already been continued by another membership for the same email + day.
export async function getOneTimeMembershipsDueForRenewalReminder(
  from: string,
  through: string,
): Promise<MembershipRow[]> {
  const { rows } = await sql.query(
    `SELECT ${MEMBERSHIP_COLUMNS}
     FROM memberships m
     WHERE m.status = 'active'
       AND m.recurring = FALSE
       AND m.renewal_reminder_sent_at IS NULL
       AND m.period_end BETWEEN $1::date AND $2::date
       AND NOT EXISTS (
         SELECT 1 FROM memberships n
         WHERE n.id <> m.id
           AND lower(n.email) = lower(m.email)
           AND n.day = m.day
           AND n.status IN ('active', 'trialing', 'past_due')
           AND (n.period_end IS NULL OR n.period_end > m.period_end)
       )
     ORDER BY m.period_end;`,
    [from, through],
  );
  return rows.map((r) =>
    mapMembershipRow(r as Parameters<typeof mapMembershipRow>[0]),
  );
}

// Marks the reminder as sent and stores the renewal token in one step, so a
// retried or overlapping cron run can't email the same member twice. Returns
// false if another run already claimed it.
export async function claimRenewalReminder(
  membershipId: number,
  token: string,
): Promise<boolean> {
  const { rowCount } = await sql`
    UPDATE memberships
    SET renewal_reminder_sent_at = NOW(), renewal_token = ${token}
    WHERE id = ${membershipId} AND renewal_reminder_sent_at IS NULL;
  `;
  return (rowCount ?? 0) > 0;
}

// Undoes claimRenewalReminder when the email didn't actually send, so the
// next cron run tries again.
export async function releaseRenewalReminder(membershipId: number): Promise<void> {
  await sql`
    UPDATE memberships
    SET renewal_reminder_sent_at = NULL, renewal_token = NULL
    WHERE id = ${membershipId};
  `;
}

export async function getMembershipByRenewalToken(
  token: string,
): Promise<MembershipRow | null> {
  const { rows } = await sql.query(
    `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE renewal_token = $1;`,
    [token],
  );
  const row = rows[0];
  return row ? mapMembershipRow(row as Parameters<typeof mapMembershipRow>[0]) : null;
}

// The paid renewal continuing this membership, if there is one.
export async function getActiveRenewalOf(
  membershipId: number,
): Promise<MembershipRow | null> {
  const { rows } = await sql.query(
    `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships
     WHERE renewal_of = $1 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1;`,
    [membershipId],
  );
  const row = rows[0];
  return row ? mapMembershipRow(row as Parameters<typeof mapMembershipRow>[0]) : null;
}

// Another active membership for the same person and day that starts after
// this one ends — i.e. it has already been renewed or re-joined, so
// extending this one would overlap it.
export async function hasLaterMembership(m: MembershipRow): Promise<boolean> {
  if (!m.periodEnd) return false;
  const { rows } = await sql`
    SELECT 1 FROM memberships
    WHERE id <> ${m.id}
      AND lower(email) = lower(${m.email})
      AND day = ${m.day}
      AND status = 'active'
      AND period_start > ${m.periodEnd}
    LIMIT 1;
  `;
  return rows.length > 0;
}

// Records a free-days grant. `extendPeriodEnd` also moves the access window's
// end date (one-time memberships, and quarterly subscriptions whose next
// charge was pushed back); a one-time membership's renewal reminder is reset
// so it goes out again 5 days before the new end date.
export async function recordFreeDays(
  membershipId: number,
  days: number,
  extendPeriodEnd: boolean,
): Promise<string | null> {
  const { rows } = await sql`
    UPDATE memberships
    SET
      period_end = CASE WHEN ${extendPeriodEnd} THEN period_end + ${days}::int ELSE period_end END,
      renewal_reminder_sent_at = CASE
        WHEN ${extendPeriodEnd} AND recurring = FALSE THEN NULL
        ELSE renewal_reminder_sent_at
      END,
      free_days_granted = free_days_granted + ${days}::int
    WHERE id = ${membershipId}
    RETURNING period_end::text AS period_end;
  `;
  return (rows[0]?.period_end as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Membership status upkeep (see lib/membership-status.ts). Run daily by the
// reminders cron and on every load of the admin Members page.

// One-time memberships have no Stripe subscription to tell us they ended, so
// they're marked 'expired' here once the club-local day after period_end
// begins. Returns the rows it changed.
export async function expireLapsedOneTimeMemberships(
  today: string,
): Promise<MembershipRow[]> {
  const { rows } = await sql.query(
    `UPDATE memberships
     SET status = 'expired'
     WHERE status IN ('active', 'trialing', 'past_due')
       AND recurring = FALSE
       AND period_end IS NOT NULL
       AND period_end < $1::date
     RETURNING ${MEMBERSHIP_COLUMNS};`,
    [today],
  );
  return rows.map((r) =>
    mapMembershipRow(r as Parameters<typeof mapMembershipRow>[0]),
  );
}

// Recurring memberships still marked live whose stored access window ended
// before `before` — normally a renewal webhook would have moved period_end
// on (or a cancellation webhook ended it), so these need checking against
// Stripe.
export async function getStaleRecurringMemberships(
  before: string,
): Promise<MembershipRow[]> {
  const { rows } = await sql.query(
    `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships
     WHERE status IN ('active', 'trialing', 'past_due')
       AND recurring = TRUE
       AND stripe_subscription_id IS NOT NULL
       AND period_end IS NOT NULL
       AND period_end < $1::date;`,
    [before],
  );
  return rows.map((r) =>
    mapMembershipRow(r as Parameters<typeof mapMembershipRow>[0]),
  );
}

// Brings a recurring membership in line with its Stripe subscription. When
// Stripe says it's still renewing, period_end is rolled forward by whole
// billing cycles to cover `today` (the same projection access checks
// already use), so it isn't flagged as stale again tomorrow.
export async function syncRecurringMembership(
  membershipId: number,
  status: string,
  cancelAtPeriodEnd: boolean,
  today: string,
): Promise<void> {
  await sql.query(
    `UPDATE memberships
     SET status = $2,
         cancel_at_period_end = $3,
         period_end = CASE
           WHEN $2 = 'active' AND NOT $3 THEN ${projectedPeriodEndSql("$4")}
           ELSE period_end
         END
     WHERE id = $1;`,
    [membershipId, status, cancelAtPeriodEnd, today],
  );
}

// Memberships that ended recently, for the admin Members page.
export async function listRecentlyEndedMemberships(
  since: string,
): Promise<MembershipRow[]> {
  const { rows } = await sql.query(
    `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships
     WHERE status IN ('expired', 'canceled')
       AND period_end IS NOT NULL
       AND period_end >= $1::date
     ORDER BY period_end DESC;`,
    [since],
  );
  return rows.map((r) =>
    mapMembershipRow(r as Parameters<typeof mapMembershipRow>[0]),
  );
}

// ---------------------------------------------------------------------------
// Stripe sync (see lib/stripe-sync.ts).

// Every membership the Stripe sync should look at: everything that has been
// live at some point, plus pending rows linked to a Stripe payment (a missed
// webhook leaves a paid membership stuck there).
export async function listMembershipsForStripeSync(): Promise<MembershipRow[]> {
  const { rows } = await sql.query(
    `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships
     WHERE status <> 'pending'
        OR stripe_payment_intent_id IS NOT NULL
        OR stripe_subscription_id IS NOT NULL
     ORDER BY id;`,
  );
  return rows.map((r) =>
    mapMembershipRow(r as Parameters<typeof mapMembershipRow>[0]),
  );
}

export async function updateMembershipFromStripe(
  id: number,
  patch: {
    status?: string;
    plan?: MembershipTier;
    periodStart?: string;
    periodEnd?: string;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<void> {
  await sql.query(
    `UPDATE memberships SET
       status = COALESCE($2, status),
       plan = COALESCE($3, plan),
       period_start = COALESCE($4::date, period_start),
       period_end = COALESCE($5::date, period_end),
       cancel_at_period_end = COALESCE($6, cancel_at_period_end)
     WHERE id = $1;`,
    [
      id,
      patch.status ?? null,
      patch.plan ?? null,
      patch.periodStart ?? null,
      patch.periodEnd ?? null,
      patch.cancelAtPeriodEnd ?? null,
    ],
  );
}

// A membership paid in Stripe that has no row here (a lost signup).
export async function insertMembershipFromStripe(input: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  plan: MembershipTier;
  day: MembershipDay;
  periodStart: string;
  periodEnd: string;
  recurring: boolean;
  status: string;
  stripePaymentIntentId?: string;
  stripeSubscriptionId?: string;
}): Promise<number> {
  const { rows } = await sql.query(
    `INSERT INTO memberships
       (email, first_name, last_name, phone, plan, day, period_start, period_end,
        recurring, status, stripe_payment_intent_id, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id;`,
    [
      input.email,
      input.firstName,
      input.lastName,
      input.phone,
      input.plan,
      input.day,
      input.periodStart,
      input.periodEnd,
      input.recurring,
      input.status,
      input.stripePaymentIntentId ?? null,
      input.stripeSubscriptionId ?? null,
    ],
  );
  return (rows[0] as { id: number }).id;
}

// The first play day for `day` on or after `fromDate` — a synced session if
// there is one, otherwise the next date that falls on that weekday.
export async function firstMembershipDayOnOrAfter(
  fromDate: string,
  day: MembershipDay,
): Promise<string> {
  const dow = MEMBERSHIP_DAY_TO_DOW[day];
  const { rows } = await sql.query(
    `SELECT MIN(date)::text AS date FROM sessions
     WHERE google_event_id IS NOT NULL
       AND EXTRACT(DOW FROM date) = $2
       AND date >= $1::date
       AND date < ($1::date + 7);`,
    [fromDate, dow],
  );
  const found = (rows[0] as { date: string | null } | undefined)?.date;
  if (found) return found;
  const start = new Date(`${fromDate}T00:00:00Z`);
  const offset = (dow - start.getUTCDay() + 7) % 7;
  return addDays(fromDate, offset);
}
