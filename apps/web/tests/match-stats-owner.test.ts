// Who may save a game's match stats (audit H4).
//
// Any signed-in player could save stats for any game, replace a game's
// saved stats with their own numbers, and mark any game as "tracked live".
// These tests run the real functions on a real Postgres: only a player in
// the game can write, and saved (final) stats are never replaced.
//
// Needs Postgres (DATA_GUARD_TEST_URL's server). CI sets
// DATA_GUARD_REQUIRE_DB=1, so it can't be skipped silently.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { migrate } from "../scripts/db/migrate.mjs";

const BASE_URL = process.env.DATA_GUARD_TEST_URL;
const REQUIRE_DB = process.env.DATA_GUARD_REQUIRE_DB === "1";
const NAME = `match_stats_${process.pid}`;
const SEED = readFileSync(new URL("./fixtures/golden/seed.sql", import.meta.url), "utf8");

// The fixture's game 4: players 10 and 11 against 8 and 9. Player 3 isn't in it.
const GAME = 4;
const PLAYERS = [10, 11, 8, 9];
const OUTSIDER = 3;

describe("match stats belong to the game's players", { skip: !BASE_URL && !REQUIRE_DB ? "set DATA_GUARD_TEST_URL" : false }, () => {
  let c: pg.Client;
  let lib: typeof import("../lib/match-stats-db.ts");
  let arena: typeof import("../lib/arena-db.ts");
  let database: typeof import("../lib/database.ts");
  const saved = { driver: process.env.DATABASE_DRIVER, url: process.env.POSTGRES_URL };
  const urlFor = (db: string) => {
    const u = new URL(BASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const stats = (rallies: number) => ({
    challengeId: GAME,
    mode: "live" as const,
    duration: 600,
    rallies,
    longestRally: 12,
    avgRallyShots: 5,
    fastestShotKmh: 180,
    players: PLAYERS.map((playerId, i) => ({ playerId, hits: 20 + i, distance: 800 + i, topSpeed: 5 })),
  });
  const beat = (kind: "start" | "beat" | "end", rallies = 3) => ({ challengeId: GAME, kind, rallies, hits: 10, quality: 0.8 });
  const row = async () => (await c.query(`SELECT recorded_by, status, stats, live, live_at::text, updated_at::text FROM arena_match_stats WHERE challenge_id = $1`, [GAME])).rows[0];
  const refuses = async (work: Promise<unknown>, code: string) => {
    await assert.rejects(work, (err: unknown) => err instanceof arena.ArenaError && err.code === code, `refused with ${code}`);
  };

  before(async () => {
    assert.ok(BASE_URL, "DATA_GUARD_TEST_URL must be set (DATA_GUARD_REQUIRE_DB=1)");
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.end();
    c = new pg.Client({ connectionString: urlFor(NAME) });
    await c.connect();
    await migrate(c, { log: () => {} });
    await c.query(SEED);
    // The game is on court: checked in a few minutes ago.
    await c.query(`UPDATE arena_challenges SET status = 'live', checked_in_at = NOW() - INTERVAL '10 minutes', played_on = CURRENT_DATE WHERE id = $1`, [GAME]);
    process.env.DATABASE_DRIVER = "postgres";
    process.env.POSTGRES_URL = urlFor(NAME);
    database = await import("../lib/database.ts");
    arena = await import("../lib/arena-db.ts");
    lib = await import("../lib/match-stats-db.ts");
    arena.invalidateWorld();
  });
  after(async () => {
    await database?.closeDatabase();
    for (const [k, v] of [["DATABASE_DRIVER", saved.driver], ["POSTGRES_URL", saved.url]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await c?.end();
    const admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
  });

  test("someone who isn't in the game can't mark it as tracked live or save its stats", async () => {
    await refuses(lib.heartbeatTracking({ id: OUTSIDER }, beat("start")), "not_your_game");
    await refuses(lib.saveMatchStats({ id: OUTSIDER }, stats(99)), "not_your_game");
    assert.equal(await row(), undefined, "nothing was written");
    assert.equal(await lib.loadMatchStats(GAME), null);
  });

  test("a player in the game tracks it, then saves it", async () => {
    await lib.heartbeatTracking({ id: 10 }, beat("start"));
    await lib.heartbeatTracking({ id: 11 }, beat("beat", 7)); // their partner's phone can carry on
    const tracking = await row();
    assert.deepEqual([tracking.status, tracking.recorded_by, tracking.live.rallies], ["tracking", 10, 7]);
    assert.equal(await lib.loadMatchStats(GAME), null, "nothing is shown as saved while it is only being tracked");

    const first = await lib.saveMatchStats({ id: 10 }, stats(31));
    assert.equal(first.rallies, 31);
    assert.equal(first.recordedBy.id, 10);
    const final = await row();
    assert.deepEqual([final.status, final.recorded_by, final.stats.rallies], ["final", 10, 31]);
  });

  test("saved stats are kept: another player's save is refused, the same player's repeat gets what was kept, and nobody outside can touch them", async () => {
    const before = await row();
    await refuses(lib.saveMatchStats({ id: 8 }, stats(5)), "already_recorded"); // an opponent, with other numbers
    await refuses(lib.saveMatchStats({ id: OUTSIDER }, stats(1)), "not_your_game");
    const again = await lib.saveMatchStats({ id: 10 }, stats(77)); // a retry, or a second go: the first save stands
    assert.equal(again.rallies, 31);
    assert.equal(again.recordedAt, before.stats.recordedAt);
    assert.deepEqual(await row(), before, "the row is exactly as it was");
    assert.equal((await lib.loadMatchStats(GAME))?.rallies, 31);
  });

  test("a heartbeat after the stats are saved changes nothing (no fake 'live' on a finished game)", async () => {
    const before = await row();
    await lib.heartbeatTracking({ id: 11 }, beat("beat", 500));
    await refuses(lib.heartbeatTracking({ id: OUTSIDER }, beat("beat", 500)), "not_your_game");
    assert.deepEqual(await row(), before);
  });

  test("the other rules still hold for a player: the four players in order, a game that isn't on, a game that isn't there", async () => {
    await c.query(`DELETE FROM arena_match_stats WHERE challenge_id = $1`, [GAME]);
    const swapped = stats(10);
    swapped.players.reverse();
    await refuses(lib.saveMatchStats({ id: 10 }, swapped), "wrong_players");
    await refuses(lib.saveMatchStats({ id: 10 }, { ...stats(10), challengeId: 99_999 }), "not_found");
    await c.query(`UPDATE arena_challenges SET status = 'accepted', checked_in_at = NULL WHERE id = $1`, [GAME]);
    arena.invalidateWorld();
    await refuses(lib.saveMatchStats({ id: 10 }, stats(10)), "not_recordable");
    await refuses(lib.heartbeatTracking({ id: 10 }, beat("start")), "not_recordable");
    assert.equal(await row(), undefined);
  });
});

if (!BASE_URL && REQUIRE_DB) {
  test("the match stats tests are required in CI", () => assert.fail("DATA_GUARD_REQUIRE_DB=1 but DATA_GUARD_TEST_URL is not set"));
}
