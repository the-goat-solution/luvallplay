// Folds one player account's Wolf Points into another and retires the duplicate.
//
//   node scripts/merge-player-points.mjs --keep a@x.com --merge b@y.com           (dry run: changes nothing)
//   node scripts/merge-player-points.mjs --keep a@x.com --merge b@y.com --apply   (does it, in one transaction)
//
// Needs POSTGRES_URL (npm: `vercel env pull .env.local`, then
// `node --env-file=.env.local scripts/merge-player-points.mjs ...`).
//
// Wolf Points are never stored; they are worked out from the records
// (lib/arena-db.ts loadWorld), so "merging points" means moving the records:
//   - play days:    attendance rows are keyed by email  -> re-pointed at --keep
//   - round robin:  rr_results are keyed by mini game name, linked through
//                   players.minigame_name               -> renamed to --keep's name
//   - Arena:        pairs/challenges are keyed by player id. Moving those safely
//                   is a separate job, so the script STOPS if --merge has any.
// Not touched: Stripe, memberships, bookings (payment records stay as they are).
// The duplicate account is then retired the same way the site's own "delete
// account" does it (lib/player-db.ts deletePlayerAccount): soft delete, sign-ins
// removed, email freed. Afterwards press "Recalculate points" on /admin/players.

import pg from "pg";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const apply = process.argv.includes("--apply");
const keepEmail = arg("keep")?.trim().toLowerCase();
const mergeEmail = arg("merge")?.trim().toLowerCase();

if (!process.env.POSTGRES_URL) {
  console.error("POSTGRES_URL is required");
  process.exit(1);
}
if (!keepEmail || !mergeEmail || keepEmail === mergeEmail) {
  console.error("Usage: --keep <email to keep> --merge <duplicate email> [--apply]");
  process.exit(1);
}

// node-postgres, like the other operator scripts (Neon over TCP).
const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL, application_name: "merge-player-points" });

async function playerByEmail(q, email) {
  const { rows } = await q(
    `SELECT id, email, first_name, last_name, minigame_name FROM players WHERE email = $1 AND deleted_at IS NULL;`,
    [email],
  );
  return rows[0] ?? null;
}

/** Counted play days (verified, not removed) and round robin points for one account. */
async function totals(q, player, extraDates = []) {
  const { rows: att } = await q(
    `SELECT session_date::text AS d FROM attendance WHERE email = $1 AND verified AND NOT removed;`,
    [player.email],
  );
  const dates = new Set([...att.map((r) => r.d), ...extraDates]);
  let rr = 0;
  if (player.minigame_name) {
    const { rows } = await q(
      `SELECT coalesce(sum(rr_points), 0)::int AS n FROM rr_results WHERE lower(mg_name) = lower($1);`,
      [player.minigame_name],
    );
    rr = rows[0].n;
  }
  return { dates, playDays: dates.size, rr, wp: dates.size + rr };
}

async function arenaActivity(q, id) {
  // Check the tables exist first: a failed query would abort the transaction.
  const { rows: t } = await q(
    `SELECT to_regclass('arena_pairs') IS NOT NULL AND to_regclass('arena_pair_members') IS NOT NULL
        AND to_regclass('arena_challenges') IS NOT NULL AS ok;`,
  );
  if (!t[0].ok) return 0; // Arena tables not created yet
  const count = async (sqlText) => (await q(sqlText, [id])).rows[0].n;
  return (
    (await count(`SELECT count(*)::int AS n FROM arena_pair_members WHERE player_id = $1;`)) +
    (await count(`SELECT count(*)::int AS n FROM arena_pairs WHERE player_low = $1 OR player_high = $1;`)) +
    (await count(`SELECT count(*)::int AS n FROM arena_challenges WHERE $1 IN (p1, p2, a1, a2);`))
  );
}

async function run(q) {
  const keep = await playerByEmail(q, keepEmail);
  const dupe = await playerByEmail(q, mergeEmail);
  if (!keep) throw new Error(`No active account for ${keepEmail}`);
  if (!dupe) throw new Error(`No active account for ${mergeEmail}`);

  const arena = await arenaActivity(q, dupe.id);
  if (arena > 0) {
    throw new Error(
      `${mergeEmail} has ${arena} Arena record(s) (pairs/challenges). Not merging: those need moving by player id, ` +
        `which this script doesn't do. Nothing was changed.`,
    );
  }

  const beforeKeep = await totals(q, keep);
  const beforeDupe = await totals(q, dupe);
  const shared = [...beforeDupe.dates].filter((d) => beforeKeep.dates.has(d));

  // Round robin names.
  const keepName = keep.minigame_name;
  const dupeName = dupe.minigame_name;
  let rrPlan = "nothing to move (the duplicate has no round robin name)";
  if (dupeName && !keepName) rrPlan = `${keepEmail} takes the name "${dupeName}"`;
  else if (dupeName && keepName && dupeName.toLowerCase() !== keepName.toLowerCase())
    rrPlan = `results under "${dupeName}" are renamed to "${keepName}"`;
  else if (dupeName) rrPlan = "same name on both, nothing to rename";

  if (dupeName && keepName && dupeName.toLowerCase() !== keepName.toLowerCase()) {
    const { rows: clash } = await q(
      `SELECT a.draw_id FROM rr_results a JOIN rr_results b ON a.draw_id = b.draw_id
       WHERE lower(a.mg_name) = lower($1) AND lower(b.mg_name) = lower($2) ORDER BY a.draw_id;`,
      [dupeName, keepName],
    );
    if (clash.length) {
      throw new Error(
        `Both round robin names ("${keepName}" and "${dupeName}") appear in draw ${clash.map((r) => r.draw_id).join(", ")}. ` +
          `Renaming would collide, so nothing was changed. Check whether those are really the same person in that draw.`,
      );
    }
  }

  const afterDates = new Set([...beforeKeep.dates, ...beforeDupe.dates]);
  const afterRr = beforeKeep.rr + (dupeName && dupeName.toLowerCase() === (keepName ?? "").toLowerCase() ? 0 : beforeDupe.rr);
  const after = { playDays: afterDates.size, rr: afterRr, wp: afterDates.size + afterRr };

  console.log(`Keep:  #${keep.id} ${keep.email} (${keep.first_name} ${keep.last_name})  play days ${beforeKeep.playDays} + round robin ${beforeKeep.rr} = ${beforeKeep.wp} WP`);
  console.log(`Merge: #${dupe.id} ${dupe.email} (${dupe.first_name} ${dupe.last_name})  play days ${beforeDupe.playDays} + round robin ${beforeDupe.rr} = ${beforeDupe.wp} WP`);
  console.log(`Play days on both accounts (counted once): ${shared.length}${shared.length ? " -> " + shared.join(", ") : ""}`);
  console.log(`Round robin: ${rrPlan}`);
  console.log(`After:  play days ${after.playDays} + round robin ${after.rr} = ${after.wp} WP  (Arena challenge points are unchanged)`);

  if (!apply) {
    console.log("\nDry run: nothing changed. Add --apply to do it.");
    return;
  }

  // Play days: one row per date. A day counts if either row counted.
  await q(
    `INSERT INTO attendance (session_date, email, source, verified, removed, recorded_at)
     SELECT session_date, $1, source, verified, removed, recorded_at FROM attendance WHERE email = $2
     ON CONFLICT (tenant_id, session_date, email) DO UPDATE SET
       verified = attendance.verified OR EXCLUDED.verified,
       removed = attendance.removed AND EXCLUDED.removed;`,
    [keepEmail, mergeEmail],
  );
  await q(`DELETE FROM attendance WHERE email = $1;`, [mergeEmail]);
  await q(`UPDATE player_absences SET email = $1 WHERE email = $2 AND NOT EXISTS (
             SELECT 1 FROM player_absences x WHERE x.email = $1 AND x.session_date = player_absences.session_date);`, [keepEmail, mergeEmail]);

  // Round robin.
  if (dupeName) {
    await q(`UPDATE players SET minigame_name = NULL WHERE id = $1;`, [dupe.id]); // frees the unique name
    if (!keepName) {
      await q(`UPDATE players SET minigame_name = $2 WHERE id = $1;`, [keep.id, dupeName]);
    } else if (dupeName.toLowerCase() !== keepName.toLowerCase()) {
      await q(`UPDATE rr_results SET mg_name = $2 WHERE lower(mg_name) = lower($1);`, [dupeName, keepName]);
    }
  }

  // Retire the duplicate (soft delete, like the site's own account deletion).
  await q(`DELETE FROM player_sessions WHERE player_id = $1;`, [dupe.id]);
  await q(
    `UPDATE players SET deleted_at = NOW(), email = 'deleted-' || id || '@deleted.invalid',
       phone = NULL, phone_e164 = NULL, phone_verified_at = NULL, display_name = NULL,
       first_name = '', last_name = '', leaderboard_visible = FALSE
     WHERE id = $1;`,
    [dupe.id],
  );
  console.log(`\nDone. Now open /admin/players and press "Recalculate points".`);
}

async function main() {
  if (!apply) {
    await run((text, params) => pool.query(text, params));
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await run((text, params) => client.query(text, params));
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
