import type { Team } from "./mini-game";

// Tiers are internal: they only steer the draw and are never sent to the
// browser. Only import this file from server code (API routes).
// Pairing is tier 1 + tier 4 and tier 2 + tier 3.
type Tier = 1 | 2 | 3 | 4;

const ROSTER: { name: string; tier: Tier }[] = [
  { name: "Hòa", tier: 1 },
  { name: "Khoai Lang", tier: 1 },
  { name: "Sơn", tier: 1 },
  { name: "Huy", tier: 1 },
  { name: "Quang", tier: 2 },
  { name: "Timba", tier: 2 },
  { name: "Hùng", tier: 2 },
  { name: "Tố Anh", tier: 2 },
  { name: "Jason", tier: 3 },
  { name: "Hiếu", tier: 3 },
  { name: "Ly", tier: 3 },
  { name: "Uyên", tier: 3 },
  { name: "Trang", tier: 4 },
  { name: "Gia Minh", tier: 4 },
  { name: "Tú", tier: 4 },
  { name: "Kelcee", tier: 4 },
];

/** Player names only, in a neutral (alphabetical) order. */
export const PLAYER_NAMES = ROSTER.map((p) => p.name).sort((a, b) =>
  a.localeCompare(b, "vi"),
);

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pairTiers(high: Tier, low: Tier): [string, string][] {
  const highs = shuffle(ROSTER.filter((p) => p.tier === high));
  const lows = shuffle(ROSTER.filter((p) => p.tier === low));
  if (highs.length !== lows.length) {
    throw new Error(`Tier ${high} and tier ${low} need the same number of players`);
  }
  // Randomise which partner is listed first so the order gives nothing away.
  return highs.map((p, i) => shuffle([p.name, lows[i].name]) as [string, string]);
}

export function drawTeams(): Team[] {
  const pairs = shuffle([...pairTiers(1, 4), ...pairTiers(2, 3)]);
  return pairs.map((players, i) => ({ id: i + 1, players }));
}
