import { getClubToday } from "./dates";

// Every Wednesday (club-local time) the homepage gallery masonry shows a
// freshly shuffled subset of photos instead of always the same ones.
// 1970-01-01 (Unix day 0) was a Thursday, so day 6 (1970-01-07) is the first
// Wednesday after epoch — subtracting 6 before dividing by 7 makes the week
// index tick over exactly on Wednesdays rather than an arbitrary weekday.
function daysSinceEpoch(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function getWeeklyRotationSeed(now: Date = new Date()): number {
  const { dateKey } = getClubToday(now);
  return Math.floor((daysSinceEpoch(dateKey) - 6) / 7);
}

// Deterministic PRNG (mulberry32) so the same seed always produces the same
// shuffle — everyone viewing the site in the same rotation week sees the
// same selection and order, with nothing to persist server-side.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Picks up to `limit` items, shuffled deterministically by the current
// rotation week — same inputs + same week always produce the same subset
// and order, so it doesn't reshuffle on every page load or differ per
// visitor, only when the week (Wednesday) rolls over.
export function selectWeeklyRotation<T>(
  items: T[],
  limit: number,
  now: Date = new Date(),
): T[] {
  const seed = getWeeklyRotationSeed(now);
  return seededShuffle(items, seed).slice(0, limit);
}
