// Wolf Points (WP), the rank ladder and the challenge rules. Pure functions
// only (no database), so everything here is unit-tested in tests/ranks.test.ts
// and shared by the server and the browser.
//
// Plan: docs/plans/challenges.md §3–§7.

export type Lang = "en" | "vi";
export type League = 1 | 2 | 3 | 4;
export type KitKey = "shoes" | "jersey" | "bag" | "trophy";
export type ItemKey =
  | "plastic"
  | "feather"
  | "tube"
  | "wooden"
  | "steel"
  | "aluminium"
  | "carbon"
  | "pro"
  | "silver"
  | "golden"
  | "platinum"
  | "diamond";

export const LEAGUES: Record<League, { en: string; vi: string }> = {
  1: { en: "Shuttle", vi: "Cầu" },
  2: { en: "Racket", vi: "Vợt" },
  3: { en: "Precious Racket", vi: "Vợt Quý" },
  4: { en: "Diamond", vi: "Kim Cương" },
};

export const ITEMS: Record<ItemKey, { en: string; vi: string; league: League }> = {
  plastic: { en: "Plastic Shuttle", vi: "Cầu Nhựa", league: 1 },
  feather: { en: "Feather Shuttle", vi: "Cầu Lông", league: 1 },
  tube: { en: "Shuttle Tube", vi: "Ống Cầu", league: 1 },
  wooden: { en: "Wooden Racket", vi: "Vợt Gỗ", league: 2 },
  steel: { en: "Steel Racket", vi: "Vợt Thép", league: 2 },
  aluminium: { en: "Aluminium Racket", vi: "Vợt Nhôm", league: 2 },
  carbon: { en: "Carbon Fibre Racket", vi: "Vợt Sợi Carbon", league: 2 },
  pro: { en: "Pro Racket", vi: "Vợt Đỉnh", league: 2 },
  silver: { en: "Silver-plated Racket", vi: "Vợt Bạc", league: 3 },
  golden: { en: "Golden Racket", vi: "Vợt Vàng", league: 3 },
  platinum: { en: "Platinum Racket", vi: "Vợt Bạch Kim", league: 3 },
  diamond: { en: "Diamond Racket", vi: "Vợt Kim Cương", league: 4 },
};

export const KIT: Record<KitKey, { en: string; vi: string; short: { en: string; vi: string } }> = {
  shoes: { en: "Court Shoes", vi: "Giày Thi Đấu", short: { en: "Shoes", vi: "Giày" } },
  jersey: { en: "Club Jersey", vi: "Áo Club", short: { en: "Jersey", vi: "Áo Club" } },
  bag: { en: "Racket Bag", vi: "Túi Vợt", short: { en: "Bag", vi: "Túi Vợt" } },
  trophy: { en: "Champion's Trophy", vi: "Cúp Vàng", short: { en: "Trophy", vi: "Cúp Vàng" } },
};

export type Rank = {
  /** 0-based position on the ladder. */
  index: number;
  item: ItemKey;
  /** Kit add-ons collected on top of the item, in order. */
  kit: KitKey[];
  league: League;
  /** Total WP needed. */
  wp: number;
  /** 1-based step within the league, and the league's step count. */
  step: number;
  steps: number;
};

// Thresholds: the Racket league collects shoes then a jersey before the
// next racket; the Precious league adds a bag; Diamond ends with the trophy.
const LADDER_SPEC: [ItemKey, number[]][] = [
  ["plastic", [0]],
  ["feather", [8]],
  ["tube", [18]],
  ["wooden", [30, 45, 60]],
  ["steel", [75, 95, 115]],
  ["aluminium", [135, 155, 175]],
  ["carbon", [200, 225, 250]],
  ["pro", [275, 300, 325]],
  ["silver", [355, 390, 425, 460]],
  ["golden", [500, 540, 580, 620]],
  ["platinum", [665, 710, 755, 800]],
  ["diamond", [870, 950, 1030, 1110, 1200]],
];
const KIT_ORDER: KitKey[] = ["shoes", "jersey", "bag", "trophy"];

export const LADDER: Rank[] = (() => {
  const out: Omit<Rank, "step" | "steps">[] = [];
  for (const [item, wps] of LADDER_SPEC) {
    wps.forEach((wp, i) => out.push({ index: out.length, item, kit: KIT_ORDER.slice(0, i), league: ITEMS[item].league, wp }));
  }
  return out.map((r) => {
    const inLeague = out.filter((x) => x.league === r.league);
    return { ...r, step: inLeague.indexOf(r) + 1, steps: inLeague.length };
  });
})();

export const TOP_INDEX = LADDER.length - 1;
/** Wooden Racket: where the Wolf seats and the Crown start counting. */
export const WOODEN_INDEX = LADDER.findIndex((r) => r.item === "wooden");
/** First rank of each league. */
export const LEAGUE_START: Record<League, number> = {
  1: 0,
  2: LADDER.findIndex((r) => r.league === 2),
  3: LADDER.findIndex((r) => r.league === 3),
  4: LADDER.findIndex((r) => r.league === 4),
};

export function rankName(rank: Rank, lang: Lang): string {
  const base = ITEMS[rank.item][lang];
  return rank.kit.length ? `${base} + ${rank.kit.map((k) => KIT[k].short[lang]).join(" + ")}` : base;
}

/** The ladder position a WP total has earned. */
export function indexForWp(wp: number): number {
  let i = 0;
  while (i < TOP_INDEX && wp >= LADDER[i + 1].wp) i++;
  return i;
}

export function nextRank(index: number): Rank | null {
  return index < TOP_INDEX ? LADDER[index + 1] : null;
}

/** 0–1 progress from the current rank's threshold to the next one. */
export function progressToNext(wp: number, index: number): number {
  const next = nextRank(index);
  if (!next) return 1;
  const from = LADDER[index].wp;
  return Math.max(0, Math.min(1, (wp - from) / (next.wp - from)));
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

export const WP = {
  playDay: 1,
  rrWin: 2,
  challengeWin: 2,
  giantKiller: 2,
  newRival: 1,
  hotStreak: 1,
  crownBounty: 4,
} as const;
/** Giant-killer: the losers' average rank is at least this many steps above the winners'. */
export const GIANT_KILLER_STEPS = 4;
/** Hot streak: each win after this many wins in a row. */
export const HOT_STREAK_AFTER = 3;

/** Where WP came from: play days, round robin, or challenges (wins and bonuses). */
export type WpSource = "play" | "rr" | "challenge";
/** A dated amount of WP from any source, for windows (60/90 days) and replays. */
export type WpEvent = { date: string; points: number; source?: WpSource };

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** WP earned in the `days` days ending today (inclusive). */
export function wpInWindow(events: WpEvent[], today: string, days: number): number {
  const from = addDays(today, -(days - 1));
  return events.reduce((s, e) => (e.date >= from && e.date <= today ? s + e.points : s), 0);
}

// ---------------------------------------------------------------------------
// Keep it polished (demotion)
// ---------------------------------------------------------------------------

export const UPKEEP_WP = 5;
export const UPKEEP_WINDOW_DAYS = 60;
export const SLIP_EVERY_DAYS = 30;

export type Polish = {
  /** Earned rank (from points, never lower than the stored peak). */
  earned: number;
  /** Rank shown after any tarnish. */
  shown: number;
  tarnishing: boolean;
  /** Days the player has been below the upkeep line (0 when fine). */
  daysBelow: number;
  /** Days left before the next slip, when tarnishing. */
  daysToSlip: number | null;
};

/**
 * Precious Racket and Diamond ranks need UPKEEP_WP in the last 60 days. Below
 * that the rank tarnishes: one rank lower for every 30 days below, never
 * under the start of the league the player has reached. Lower leagues are
 * permanent. Points are never removed, so playing again restores the rank.
 */
export function polish(earned: number, events: WpEvent[], today: string): Polish {
  const league = LADDER[earned].league;
  const ok: Polish = { earned, shown: earned, tarnishing: false, daysBelow: 0, daysToSlip: null };
  if (league < 3) return ok;
  if (wpInWindow(events, today, UPKEEP_WINDOW_DAYS) >= UPKEEP_WP) return ok;
  // Find the last day the window was still at or above the line.
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let lastOk: string | null = null;
  for (let d = 1; d <= 3650; d++) {
    const day = addDays(today, -d);
    if (sorted.length && day < sorted[0].date) break;
    if (wpInWindow(sorted, day, UPKEEP_WINDOW_DAYS) >= UPKEEP_WP) {
      lastOk = day;
      break;
    }
  }
  const daysBelow = lastOk ? daysBetween(lastOk, today) : 3650;
  const slips = Math.floor(daysBelow / SLIP_EVERY_DAYS);
  const shown = Math.max(LEAGUE_START[league], earned - slips);
  const daysToSlip = shown > LEAGUE_START[league] ? SLIP_EVERY_DAYS - (daysBelow % SLIP_EVERY_DAYS) : null;
  return { earned, shown, tarnishing: true, daysBelow, daysToSlip };
}

// ---------------------------------------------------------------------------
// Wolf seats
// ---------------------------------------------------------------------------

export type Seat = "alpha" | "silver";
export const SEAT_WINDOW_DAYS = 90;
export const SILVER_SEATS = 3;

/** Alpha Wolf: 1st on 90-day WP; Silver Wolves: the next three. Anyone with WP in the window. */
export function assignSeats(players: { id: number; earned: number; wp90: number; wpTotal: number }[]): Map<number, Seat> {
  const eligible = players
    .filter((p) => p.wp90 > 0)
    .sort((a, b) => b.wp90 - a.wp90 || b.wpTotal - a.wpTotal || a.id - b.id);
  const seats = new Map<number, Seat>();
  eligible.slice(0, 1 + SILVER_SEATS).forEach((p, i) => seats.set(p.id, i === 0 ? "alpha" : "silver"));
  return seats;
}

// ---------------------------------------------------------------------------
// Scores (one game to 21, BWF scoring)
// ---------------------------------------------------------------------------

/** 21 with the loser on 19 or less; 22–29 leading by 2; or 30 with the loser on 28–29. */
export function isValidGameScore(a: number, b: number): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) return false;
  const win = Math.max(a, b);
  const lose = Math.min(a, b);
  if (win === 21) return lose <= 19;
  if (win >= 22 && win <= 29) return win - lose === 2;
  if (win === 30) return lose === 28 || lose === 29;
  return false;
}

// ---------------------------------------------------------------------------
// Replay: points, bonuses and crowns from the match history
// ---------------------------------------------------------------------------

export type ReplayChallenge = {
  id: number;
  /** When the result was confirmed (ISO); the replay runs in this order. */
  at: string;
  date: string;
  posting: { pairId: number; players: [number, number] };
  accepting: { pairId: number; players: [number, number] };
  /** Scores; null with `retiredBy` when a pair couldn't finish. */
  postingScore: number | null;
  acceptingScore: number | null;
  retiredBy: "posting" | "accepting" | null;
};

export type ReplayPlayerResult = {
  challengeId: number;
  playerId: number;
  pairId: number;
  won: boolean;
  base: number;
  giantKiller: number;
  newRival: number;
  hotStreak: number;
  crownBounty: number;
  total: number;
  pointsFor: number;
  pointsAgainst: number;
  date: string;
};

export type CrownEvent = "crowned" | "taken" | "defended";
export type CrownState = { pairId: number; players: [number, number]; since: string; defences: number; lastPlayed: string } | null;

export const CROWN_IDLE_DAYS = 14;

/**
 * Replays confirmed challenges in order. `wpBefore(playerId, at)` gives a
 * player's WP before a moment from other sources (play days, round robin);
 * challenge points are added as the replay goes. `endedPairs` maps pair id
 * to the date the pair split up (the crown goes vacant).
 */
export function replayChallenges(
  challenges: ReplayChallenge[],
  wpBefore: (playerId: number, date: string) => number,
  endedPairs: Map<number, string> = new Map(),
): { results: ReplayPlayerResult[]; crown: CrownState; crownHistory: { challengeId: number; pairId: number; kind: CrownEvent }[] } {
  const ordered = [...challenges].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const challengeWp = new Map<number, number>();
  const faced = new Map<number, Set<number>>();
  const streak = new Map<number, number>();
  const results: ReplayPlayerResult[] = [];
  const crownHistory: { challengeId: number; pairId: number; kind: CrownEvent }[] = [];
  let crown: CrownState = null;

  const wpOf = (p: number, date: string) => wpBefore(p, date) + (challengeWp.get(p) ?? 0);
  const avgIndex = (players: [number, number], date: string) =>
    (indexForWp(wpOf(players[0], date)) + indexForWp(wpOf(players[1], date))) / 2;
  const crownLapsed = (date: string) => {
    if (!crown) return;
    const ended = endedPairs.get(crown.pairId);
    if ((ended && ended <= date) || daysBetween(crown.lastPlayed, date) > CROWN_IDLE_DAYS) crown = null;
  };

  for (const c of ordered) {
    crownLapsed(c.date);
    const postingWon = c.retiredBy ? c.retiredBy === "accepting" : (c.postingScore ?? 0) > (c.acceptingScore ?? 0);
    const winners = postingWon ? c.posting : c.accepting;
    const losers = postingWon ? c.accepting : c.posting;
    const retired = Boolean(c.retiredBy);

    const gk = !retired && avgIndex(losers.players, c.date) - avgIndex(winners.players, c.date) >= GIANT_KILLER_STEPS;
    const tookCrown = !retired && crown !== null && crown.pairId === losers.pairId;
    const bothWooden =
      avgIndex(winners.players, c.date) >= WOODEN_INDEX && avgIndex(losers.players, c.date) >= WOODEN_INDEX;

    const sideFor = (side: typeof winners, won: boolean, other: typeof winners) => {
      for (const p of side.players) {
        const seen = faced.get(p) ?? new Set<number>();
        const newRival = !retired && !other.players.some((o) => seen.has(o)) ? WP.newRival : 0;
        const before = streak.get(p) ?? 0;
        const hot = won && !retired && before >= HOT_STREAK_AFTER ? WP.hotStreak : 0;
        const base = won ? WP.challengeWin : 0;
        const giantKiller = won && gk ? WP.giantKiller : 0;
        const crownBounty = won && tookCrown ? WP.crownBounty : 0;
        const total = base + giantKiller + newRival + hot + crownBounty;
        const ownScore = side === c.posting ? c.postingScore : c.acceptingScore;
        const otherScore = side === c.posting ? c.acceptingScore : c.postingScore;
        results.push({
          challengeId: c.id,
          playerId: p,
          pairId: side.pairId,
          won,
          base,
          giantKiller,
          newRival,
          hotStreak: hot,
          crownBounty,
          total,
          pointsFor: ownScore ?? 0,
          pointsAgainst: otherScore ?? 0,
          date: c.date,
        });
      }
    };
    sideFor(winners, true, losers);
    sideFor(losers, false, winners);

    // State after the game.
    for (const r of results.filter((x) => x.challengeId === c.id)) {
      challengeWp.set(r.playerId, (challengeWp.get(r.playerId) ?? 0) + r.total);
      if (!retired) streak.set(r.playerId, r.won ? (streak.get(r.playerId) ?? 0) + 1 : 0);
    }
    if (!retired) {
      for (const a of winners.players) for (const b of losers.players) {
        faced.set(a, (faced.get(a) ?? new Set()).add(b));
        faced.set(b, (faced.get(b) ?? new Set()).add(a));
      }
    }
    const held = crown as CrownState;
    if (held && held.pairId === winners.pairId) {
      crown = { ...held, defences: held.defences + 1, lastPlayed: c.date };
      if (!retired) crownHistory.push({ challengeId: c.id, pairId: winners.pairId, kind: "defended" });
    } else if (tookCrown || (!held && bothWooden && !retired)) {
      crown = { pairId: winners.pairId, players: winners.players, since: c.date, defences: 0, lastPlayed: c.date };
      crownHistory.push({ challengeId: c.id, pairId: winners.pairId, kind: tookCrown ? "taken" : "crowned" });
    } else if (held && held.pairId === losers.pairId) {
      crown = { ...held, lastPlayed: c.date };
    }
  }
  return { results, crown, crownHistory };
}

/** Whether the current crown has lapsed by `today` (idle too long or the pair split). */
export function crownStillHeld(crown: CrownState, today: string, endedPairs: Map<number, string>): CrownState {
  if (!crown) return null;
  const ended = endedPairs.get(crown.pairId);
  if (ended && ended <= today) return null;
  if (daysBetween(crown.lastPlayed, today) > CROWN_IDLE_DAYS) return null;
  return crown;
}

// ---------------------------------------------------------------------------
// Achievements (one-off badges, no points)
// ---------------------------------------------------------------------------

export type AchievementKey =
  | "first-blood"
  | "golden-point"
  | "nail-biter"
  | "social-wolf"
  | "loyal-partner"
  | "giant-killer"
  | "crown-taker"
  | "hot-streak"
  | "iron-wolf"
  | "polished";

export const ACHIEVEMENTS: { key: AchievementKey; en: string; vi: string; how: { en: string; vi: string } }[] = [
  { key: "first-blood", en: "First Blood", vi: "Trận Đầu", how: { en: "Win your first challenge", vi: "Thắng thách đấu đầu tiên" } },
  { key: "golden-point", en: "Golden Point", vi: "Điểm Vàng", how: { en: "Win 30–29", vi: "Thắng 30–29" } },
  { key: "nail-biter", en: "Nail-biter", vi: "Nghẹt Thở", how: { en: "Win 22–20 or closer", vi: "Thắng 22–20 hoặc sát hơn" } },
  { key: "social-wolf", en: "Social Wolf", vi: "Sói Giao Lưu", how: { en: "Play 10 different pairs", vi: "Đấu với 10 cặp khác nhau" } },
  { key: "loyal-partner", en: "Loyal Partner", vi: "Đồng Đội Trung Thành", how: { en: "20 challenges with the same partner", vi: "20 trận cùng một đồng đội" } },
  { key: "giant-killer", en: "Giant-killer", vi: "Hạ Gục Gã Khổng Lồ", how: { en: "Beat a pair 4+ steps above you", vi: "Thắng cặp cao hơn bạn 4 bậc trở lên" } },
  { key: "crown-taker", en: "Crown Taker", vi: "Đoạt Vương Miện", how: { en: "Take the crown", vi: "Giành vương miện" } },
  { key: "hot-streak", en: "Hot Streak", vi: "Chuỗi Nóng", how: { en: "5 challenge wins in a row", vi: "Thắng 5 trận liên tiếp" } },
  { key: "iron-wolf", en: "Iron Wolf", vi: "Sói Thép", how: { en: "10 play days in a row", vi: "10 buổi liên tiếp" } },
  { key: "polished", en: "Polished", vi: "Sáng Bóng", how: { en: "Restore a tarnished rank", vi: "Phục hồi hạng bị xỉn màu" } },
];

export type HistoryGame = {
  challengeId: number;
  date: string;
  won: boolean;
  retired: boolean;
  own: number;
  other: number;
  partnerId: number;
  opponentPairKey: string;
  giantKiller: boolean;
  crownBounty: boolean;
};

/** Achievements earned from a player's challenge history (oldest first), with the date each was earned. */
export function achievementsFrom(
  games: HistoryGame[],
  extra: { ironWolf: string | null; polished: string | null },
): Partial<Record<AchievementKey, string>> {
  const out: Partial<Record<AchievementKey, string>> = {};
  const set = (k: AchievementKey, d: string) => {
    if (!out[k]) out[k] = d;
  };
  const opponents = new Set<string>();
  const partners = new Map<number, number>();
  let run = 0;
  for (const g of games) {
    if (g.retired) continue;
    if (g.won) set("first-blood", g.date);
    if (g.won && g.own === 30 && g.other === 29) set("golden-point", g.date);
    if (g.won && g.own >= 22 && g.own - g.other <= 2) set("nail-biter", g.date);
    if (g.giantKiller) set("giant-killer", g.date);
    if (g.crownBounty) set("crown-taker", g.date);
    opponents.add(g.opponentPairKey);
    if (opponents.size >= 10) set("social-wolf", g.date);
    partners.set(g.partnerId, (partners.get(g.partnerId) ?? 0) + 1);
    if ((partners.get(g.partnerId) ?? 0) >= 20) set("loyal-partner", g.date);
    run = g.won ? run + 1 : 0;
    if (run >= 5) set("hot-streak", g.date);
  }
  if (extra.ironWolf) set("iron-wolf", extra.ironWolf);
  if (extra.polished) set("polished", extra.polished);
  return out;
}

/** Order-independent key for a set of two players. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Order-independent key for four players (the "same four in any split" rule). */
export function foursomeKey(players: number[]): string {
  return [...players].sort((a, b) => a - b).join("-");
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

export const CAPS = {
  sameFourPerDay: 1,
  sameFourPer30Days: 3,
  perPlayerPerDay: 4,
};

export const CODE_TTL_SECONDS = 120;
export const PAIR_REQUEST_TTL_SECONDS = 300;
export const CODE_ATTEMPTS_PER_10_MIN = 5;
export const CHECKIN_MIN_MINUTES_BEFORE_SCORE = 8;
export const SCORE_WINDOW_HOURS = 24;
export const AUTO_CONFIRM_HOURS = 24;
export const ACCEPTED_LAPSE_DAYS = 7;
export const AVAILABILITY_DAYS = [0, 3, 7] as const;

/** Random 5-digit code, 10000–99999. */
export function randomCode(rand: () => number = Math.random): string {
  return String(10000 + Math.floor(rand() * 90000));
}
