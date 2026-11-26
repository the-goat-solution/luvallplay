// Global leaderboard views (build plan §8 item 2): city, country and world,
// each optionally narrowed to an age band or a gender category.
//
// Pure: callers load the ratings and each player's opt-in and profile, this
// decides who appears and in what order.
//
// Who appears:
// - only players who opted in (per profile: off until the player turns it on);
// - never a junior (juniors have no global presence, §6.8 and §8);
// - only settled ratings: enough verified games and a small enough RD. A new
//   player is "provisional" and is listed separately, unranked;
// - only recently active players (RD alone grows too slowly to retire a
//   rating that hasn't been tested in half a year).
//
// "World" means every club in the deployment's region (§6.9): global
// features work within a region at first.

export type GenderCategory = "women" | "men";

export const AGE_BANDS = ["18-34", "35-44", "45-54", "55-64", "65+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Adults only. Age is the age reached during `year`, as sports federations count it. */
export function ageBand(birthYear: number | null | undefined, year: number): AgeBand | null {
  if (!birthYear || !Number.isInteger(birthYear)) return null;
  const age = year - birthYear;
  if (age < 18 || age > 120) return null;
  if (age <= 34) return "18-34";
  if (age <= 44) return "35-44";
  if (age <= 54) return "45-54";
  if (age <= 64) return "55-64";
  return "65+";
}

/** A place name as a comparison key: accents, case and spacing ignored ("Hà Nội" = "ha noi"). */
export function placeKey(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type BoardPlayer = {
  playerId: number;
  rating: number;
  rd: number;
  games: number;
  /** YYYY-MM-DD of the latest verified game. */
  lastPlayed: string;
  /** The player switched global ratings on for this profile. */
  optedIn: boolean;
  junior: boolean;
  city: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  birthYear: number | null;
  gender: GenderCategory | null;
};

export type BoardView = {
  scope: "city" | "country" | "world";
  /** Needed for "city" (with country, so two cities of one name stay apart) and "country". */
  country?: string;
  city?: string;
  ageBand?: AgeBand;
  gender?: GenderCategory;
};

export type BoardOptions = {
  /** Today (YYYY-MM-DD), for age bands and recent activity. */
  today: string;
  /** Verified games before a rating is shown as settled. */
  minGames?: number;
  /** RD above this is provisional. */
  maxRd?: number;
  /** Days without a verified game before a player drops off the board. */
  activeDays?: number;
};

export const BOARD_MIN_GAMES = 5;
export const BOARD_MAX_RD = 110;
export const BOARD_ACTIVE_DAYS = 180;

export type BoardRow = { rank: number; playerId: number; rating: number; rd: number; games: number };

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Whether a rating is settled enough to rank. */
export function isProvisional(p: { rd: number; games: number }, options: { minGames?: number; maxRd?: number } = {}): boolean {
  return p.games < (options.minGames ?? BOARD_MIN_GAMES) || p.rd > (options.maxRd ?? BOARD_MAX_RD);
}

/**
 * One board. `ranked` is ordered best first; players level on the shown
 * (rounded) rating share a rank. `provisional` are opted-in, active players
 * in the view whose rating isn't settled yet, newest-looking first by games.
 */
export function leaderboard(players: readonly BoardPlayer[], view: BoardView, options: BoardOptions): { ranked: BoardRow[]; provisional: BoardRow[] } {
  if ((view.scope === "city" || view.scope === "country") && !view.country) throw new Error("leaderboard: a city or country board needs a country.");
  if (view.scope === "city" && !placeKey(view.city)) throw new Error("leaderboard: a city board needs a city.");
  const year = Number(options.today.slice(0, 4));
  const activeDays = options.activeDays ?? BOARD_ACTIVE_DAYS;
  const country = view.country?.toUpperCase();
  const city = placeKey(view.city);

  const inView = players.filter((p) => {
    if (!p.optedIn || p.junior) return false;
    if (p.games <= 0 || daysBetween(p.lastPlayed, options.today) > activeDays) return false;
    if (view.scope !== "world" && p.country?.toUpperCase() !== country) return false;
    if (view.scope === "city" && placeKey(p.city) !== city) return false;
    if (view.gender && p.gender !== view.gender) return false;
    if (view.ageBand && ageBand(p.birthYear, year) !== view.ageBand) return false;
    return true;
  });

  const order = (a: BoardPlayer, b: BoardPlayer) =>
    Math.round(b.rating) - Math.round(a.rating) || a.rd - b.rd || b.games - a.games || a.playerId - b.playerId;
  const row = (p: BoardPlayer, rank: number): BoardRow => ({ rank, playerId: p.playerId, rating: Math.round(p.rating), rd: Math.round(p.rd), games: p.games });

  const settled = inView.filter((p) => !isProvisional(p, options)).sort(order);
  const ranked: BoardRow[] = [];
  settled.forEach((p, i) => {
    const prev = ranked[i - 1];
    ranked.push(row(p, prev && prev.rating === Math.round(p.rating) ? prev.rank : i + 1));
  });
  const provisional = inView
    .filter((p) => isProvisional(p, options))
    .sort(order)
    .map((p) => row(p, 0));
  return { ranked, provisional };
}
