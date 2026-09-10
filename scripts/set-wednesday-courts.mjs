/**
 * One-off migration: lowers the default court count for upcoming Wednesday
 * play days from 2 to 1, effective the next Wednesday onward, matching the
 * new default in lib/constants.ts (MEMBERSHIP_DAY_DEFAULT_COURTS.wednesday).
 * The code-level default only applies to session rows created *after* this
 * change ships — this script fixes the Wednesdays the calendar sync already
 * created at 2 courts before then.
 *
 * Skips any Wednesday that already has more players signed up than 1 court
 * supports (max 6 — see COURTS_TO_MAX_PLAYERS in lib/constants.ts), the same
 * safety check setCourtsForDate applies in the admin UI, so nobody already
 * booked gets stranded — those are reported, not touched.
 *
 * Safe to re-run: only touches rows still at courts <> 1.
 *
 * Run: POSTGRES_URL=postgres://... node scripts/set-wednesday-courts.mjs
 */

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("Set POSTGRES_URL");
  process.exit(1);
}

const { createPool } = await import("@vercel/postgres");
const pool = createPool({ connectionString });

const MAX_PLAYERS_AT_ONE_COURT = 6;

// Mirrors getClubToday() in lib/dates.ts (Pacific/Auckland wall-clock date).
// Duplicated here rather than imported since this plain-JS script runs
// standalone, outside the app's TS build.
function clubTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function main() {
  const today = clubTodayDateKey();

  const { rows: candidates } = await pool.sql`
    SELECT date::text AS date, courts, booked_spots
    FROM sessions
    WHERE EXTRACT(DOW FROM date) = 3
      AND date >= ${today}::date
      AND courts <> 1
    ORDER BY date;
  `;

  if (candidates.length === 0) {
    console.log("No upcoming Wednesday sessions need updating.");
    await pool.end();
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const row of candidates) {
    const { rows: memberRows } = await pool.sql`
      SELECT COUNT(*)::int AS count FROM memberships
      WHERE status = 'active' AND day = 'wednesday'
        AND period_start <= ${row.date} AND period_end >= ${row.date};
    `;
    const activeMembers = memberRows[0].count;
    const totalSignedUp = row.booked_spots + activeMembers;

    if (totalSignedUp > MAX_PLAYERS_AT_ONE_COURT) {
      console.log(
        `SKIP ${row.date}: ${totalSignedUp} players already signed up (max ${MAX_PLAYERS_AT_ONE_COURT} at 1 court) — left at ${row.courts} court${row.courts === 1 ? "" : "s"}.`,
      );
      skipped++;
      continue;
    }

    await pool.sql`UPDATE sessions SET courts = 1 WHERE date = ${row.date};`;
    console.log(
      `Updated ${row.date}: ${row.courts} -> 1 court (${totalSignedUp} player${totalSignedUp === 1 ? "" : "s"} signed up).`,
    );
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
