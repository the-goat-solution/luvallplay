// Match Analyzer: the maths behind /match-analyzer, kept free of browser APIs
// so it can be tested with node --test.
//
// Court coordinates are metres on the floor: x runs across the court
// (0 … 6.1, the doubles width) and y runs along it (0 … 13.4, baseline to
// baseline), so the net sits at y = 6.7. A homography (a 3×3 matrix) maps the
// camera image onto that floor plane once the four outer corners are known.

export type Pt = { x: number; y: number };
/** A 3×3 matrix in row-major order. */
export type Mat3 = number[];

export const COURT = {
  length: 13.4,
  width: 6.1,
  net: 6.7,
  singlesInset: 0.46,
  shortService: 1.98,
  longServiceDoubles: 0.76,
} as const;

/** The four outer corners, in the order the user taps them (going round the court). */
export const COURT_CORNERS: Pt[] = [
  { x: 0, y: 0 },
  { x: COURT.width, y: 0 },
  { x: COURT.width, y: COURT.length },
  { x: 0, y: COURT.length },
];

/**
 * Solves the homography taking each src point to the matching dst point
 * (exactly four of each). Returns null when the points are degenerate
 * (three in a line, or repeated).
 */
export function solveHomography(src: Pt[], dst: Pt[]): Mat3 | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  // Unknowns h0..h7 with h8 = 1. Each pair gives two rows of A·h = b.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [...h, 1];
}

/** Gaussian elimination with partial pivoting. Null when singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function applyHomography(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

export function invertMat3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ];
  return inv.map((v) => v / det);
}

/**
 * Image → court homography from four tapped corners. `rotation` shifts which
 * tapped point is treated as corner 0, so a user who started on a sideline
 * rather than a baseline can fix it with one button.
 */
export function courtHomography(taps: Pt[], rotation = 0): { toCourt: Mat3; toImage: Mat3 } | null {
  if (taps.length !== 4) return null;
  const corners = taps.map((_, i) => COURT_CORNERS[(i + rotation) % 4]);
  const toCourt = solveHomography(taps, corners);
  if (!toCourt) return null;
  const toImage = invertMat3(toCourt);
  if (!toImage) return null;
  return { toCourt, toImage };
}

export type Segment = { a: Pt; b: Pt; dashed?: boolean };

/** Every painted line of a doubles court, plus the net, in court metres. */
export function courtLines(): Segment[] {
  const { width: W, length: L, net, singlesInset: s, shortService: ss, longServiceDoubles: ld } = COURT;
  const h = (y: number, x0 = 0, x1: number = W): Segment => ({ a: { x: x0, y }, b: { x: x1, y } });
  const v = (x: number, y0 = 0, y1: number = L): Segment => ({ a: { x, y: y0 }, b: { x, y: y1 } });
  return [
    h(0), h(L), v(0), v(W),
    v(s), v(W - s),
    h(ld), h(L - ld),
    h(net - ss), h(net + ss),
    v(W / 2, 0, net - ss), v(W / 2, net + ss, L),
    { ...h(net), dashed: true },
  ];
}

/** A circle of `radius` metres on the floor, as an image-space polygon. */
export function floorCircle(toImage: Mat3, centre: Pt, radius: number, steps = 40): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push(applyHomography(toImage, { x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius }));
  }
  return out;
}

// ── Detection and tracking ────────────────────────────────────────────────

/** Image-space box: [x, y, width, height] in video pixels. */
export type Box = [number, number, number, number];
export type Detection = { box: Box; score: number };
/** One analysed frame: its time and the people the detector found. */
export type Sample = { t: number; dets: Detection[] };
export type TrackPoint = { p: Pt; box: Box };
/** tracks[player][sampleIndex] — null where the player was not seen. */
export type Tracks = (TrackPoint | null)[][];

/** The floor point under a detected person: the bottom-centre of the box. */
export function footPoint(box: Box): Pt {
  return { x: box[0] + box[2] / 2, y: box[1] + box[3] };
}

/** How far outside the lines a player can still be (lunges, deep clears). */
const COURT_MARGIN = { side: 1.2, end: 2.0 };

export function onCourt(p: Pt): boolean {
  return (
    p.x >= -COURT_MARGIN.side &&
    p.x <= COURT.width + COURT_MARGIN.side &&
    p.y >= -COURT_MARGIN.end &&
    p.y <= COURT.length + COURT_MARGIN.end
  );
}

/** Detections whose feet land on (or just around) the court, with court positions. */
export function courtDetections(dets: Detection[], toCourt: Mat3): (Detection & { p: Pt })[] {
  return dets
    .map((d) => ({ ...d, p: applyHomography(toCourt, footPoint(d.box)) }))
    .filter((d) => Number.isFinite(d.p.x) && Number.isFinite(d.p.y) && onCourt(d.p));
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** First sample with at least `count` people on court; -1 if none. */
export function findSeedIndex(samples: Sample[], toCourt: Mat3, count: number): number {
  return samples.findIndex((s) => courtDetections(s.dets, toCourt).length >= count);
}

/** Seed positions: the `count` most confident on-court people, left side of the image first. */
export function seedPlayers(sample: Sample, toCourt: Mat3, count: number): TrackPoint[] {
  return courtDetections(sample.dets, toCourt)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.box[0] - b.box[0])
    .map((d) => ({ p: d.p, box: d.box }));
}

/** Fastest a player's feet can plausibly move, in m/s (sprint lunge). */
const MAX_PLAYER_SPEED = 8;
/** Base allowance for detector jitter on top of movement, in metres. */
const GATE_BASE = 0.8;

/**
 * Follows `seeds` (one per player, found at `seedIndex`) forwards and
 * backwards through the samples. Each step assigns on-court detections to
 * players greedily, closest pair first, and only within the distance a player
 * could have covered since they were last seen.
 */
export function buildTracks(samples: Sample[], toCourt: Mat3, seedIndex: number, seeds: TrackPoint[]): Tracks {
  const tracks: Tracks = seeds.map(() => samples.map(() => null));
  if (seedIndex < 0 || seedIndex >= samples.length) return tracks;
  seeds.forEach((s, i) => (tracks[i][seedIndex] = s));

  const run = (order: number[]) => {
    const last = seeds.map((s) => ({ p: s.p, t: samples[seedIndex].t }));
    for (const idx of order) {
      const s = samples[idx];
      const dets = courtDetections(s.dets, toCourt);
      const pairs: { i: number; j: number; d: number }[] = [];
      last.forEach((l, i) => {
        const gate = GATE_BASE + MAX_PLAYER_SPEED * Math.abs(s.t - l.t);
        dets.forEach((det, j) => {
          const d = dist(l.p, det.p);
          if (d <= gate) pairs.push({ i, j, d });
        });
      });
      pairs.sort((a, b) => a.d - b.d);
      const usedI = new Set<number>();
      const usedJ = new Set<number>();
      for (const { i, j } of pairs) {
        if (usedI.has(i) || usedJ.has(j)) continue;
        usedI.add(i);
        usedJ.add(j);
        tracks[i][idx] = { p: dets[j].p, box: dets[j].box };
        last[i] = { p: dets[j].p, t: s.t };
      }
    }
  };
  run(range(seedIndex + 1, samples.length));
  run(range(seedIndex - 1, -1));
  return tracks;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  if (from <= to) for (let i = from; i < to; i++) out.push(i);
  else for (let i = from; i > to; i--) out.push(i);
  return out;
}

/** Swaps two players' tracks from sample `fromIndex` onwards (fixes an identity switch). */
export function swapTracks(tracks: Tracks, a: number, b: number, fromIndex: number): Tracks {
  const next = tracks.map((t) => [...t]);
  for (let k = Math.max(0, fromIndex); k < next[a].length; k++) {
    [next[a][k], next[b][k]] = [next[b][k], next[a][k]];
  }
  return next;
}

// ── Movement ──────────────────────────────────────────────────────────────

/** Gaps in a track shorter than this are bridged by interpolation, in seconds. */
const MAX_GAP = 1.0;
/** Speeds above this are detector glitches, not players, in m/s. */
const SPEED_CAP = 9;

/** A player's smoothed path with running distance and speed at each sample. */
export type Motion = {
  t: number[];
  p: (Pt | null)[];
  box: (Box | null)[];
  /** Metres covered since the start of the video. */
  cumDist: number[];
  /** m/s at each sample (0 where unknown). */
  speed: number[];
};

export function computeMotion(times: number[], track: (TrackPoint | null)[]): Motion {
  const n = times.length;
  const p: (Pt | null)[] = track.map((tp) => (tp ? tp.p : null));
  const box: (Box | null)[] = track.map((tp) => (tp ? tp.box : null));

  // Bridge short gaps so a missed detection or two does not break the path.
  let prev = -1;
  for (let k = 0; k < n; k++) {
    if (!p[k]) continue;
    if (prev >= 0 && k - prev > 1 && times[k] - times[prev] <= MAX_GAP) {
      for (let m = prev + 1; m < k; m++) {
        const f = (times[m] - times[prev]) / (times[k] - times[prev]);
        p[m] = lerpPt(p[prev]!, p[k]!, f);
        box[m] = lerpBox(box[prev]!, box[k]!, f);
      }
    }
    prev = k;
  }

  // Centred moving average over ±2 samples takes out detector jitter. Points
  // are added in symmetric pairs only, so the ends of a path and steady
  // movement are not pulled off line.
  const smooth: (Pt | null)[] = p.map((pt, k) => {
    if (!pt) return null;
    let sx = pt.x, sy = pt.y, c = 1;
    for (let r = 1; r <= 2; r++) {
      const a = p[k - r];
      const b = p[k + r];
      if (k - r < 0 || k + r >= n || !a || !b) break;
      sx += a.x + b.x; sy += a.y + b.y; c += 2;
    }
    return { x: sx / c, y: sy / c };
  });

  const cumDist: number[] = new Array(n).fill(0);
  const speed: number[] = new Array(n).fill(0);
  for (let k = 1; k < n; k++) {
    cumDist[k] = cumDist[k - 1];
    const a = smooth[k - 1];
    const b = smooth[k];
    const dt = times[k] - times[k - 1];
    if (!a || !b || dt <= 0) continue;
    const d = dist(a, b);
    // Ignore sub-centimetre drift and anything faster than a human.
    if (d >= 0.02 && d / dt <= SPEED_CAP) cumDist[k] += d;
  }
  for (let k = 0; k < n; k++) {
    const a = smooth[k - 1];
    const b = smooth[k + 1];
    if (!a || !b) continue;
    const dt = times[k + 1] - times[k - 1];
    const v = dt > 0 ? dist(a, b) / dt : 0;
    speed[k] = v <= SPEED_CAP ? v : 0;
  }
  return { t: times, p: smooth, box, cumDist, speed };
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const lerpPt = (a: Pt, b: Pt, f: number): Pt => ({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) });
const lerpBox = (a: Box, b: Box, f: number): Box => [0, 1, 2, 3].map((i) => lerp(a[i], b[i], f)) as Box;

/** Index of the last sample at or before t (binary search); -1 before the first. */
export function sampleIndexAt(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Position and box at time t, interpolated between samples. Null when unknown. */
export function motionAt(m: Motion, t: number): { p: Pt; box: Box | null } | null {
  const k = sampleIndexAt(m.t, t);
  if (k < 0) return null;
  const a = m.p[k];
  const b = m.p[k + 1];
  if (a && b && m.t[k + 1] > m.t[k]) {
    const f = Math.min(1, (t - m.t[k]) / (m.t[k + 1] - m.t[k]));
    const ba = m.box[k], bb = m.box[k + 1];
    return { p: lerpPt(a, b, f), box: ba && bb ? lerpBox(ba, bb, f) : ba ?? bb };
  }
  // Hold the last known spot briefly, then let it go.
  if (a && t - m.t[k] <= 0.25) return { p: a, box: m.box[k] };
  return null;
}

/** Distance covered and top speed between t0 and t1. */
export function movementBetween(m: Motion, t0: number, t1: number): { distance: number; topSpeed: number } {
  const k0 = Math.max(0, sampleIndexAt(m.t, t0));
  const k1 = sampleIndexAt(m.t, t1);
  if (k1 < 0 || k1 < k0) return { distance: 0, topSpeed: 0 };
  let top = 0;
  for (let k = k0; k <= k1; k++) top = Math.max(top, m.speed[k]);
  return { distance: m.cumDist[k1] - m.cumDist[k0], topSpeed: top };
}

// ── Hits and rallies ──────────────────────────────────────────────────────

export type Hit = { t: number; player: number };
export type Rally = { start: number; end: number; hits: Hit[] };

/** How long after the last hit a rally is still counted (shuttle in the air). */
export const RALLY_TAIL = 1.0;

/** Splits hits into rallies wherever there is a pause longer than `gap` seconds. */
export function groupRallies(hits: Hit[], gap = 4): Rally[] {
  const sorted = [...hits].sort((a, b) => a.t - b.t);
  const rallies: Rally[] = [];
  for (const h of sorted) {
    const cur = rallies[rallies.length - 1];
    if (cur && h.t - cur.hits[cur.hits.length - 1].t <= gap) {
      cur.hits.push(h);
      cur.end = h.t + RALLY_TAIL;
    } else {
      rallies.push({ start: h.t, end: h.t + RALLY_TAIL, hits: [h] });
    }
  }
  return rallies;
}

/**
 * The rally to show at time t: the one in play, else the one that just ended
 * (its numbers stay on screen until the next serve). Null before the first.
 */
export function rallyAt(rallies: Rally[], t: number): { index: number; rally: Rally; live: boolean } | null {
  let found = -1;
  for (let i = 0; i < rallies.length; i++) {
    if (rallies[i].start <= t) found = i;
    else break;
  }
  if (found < 0) return null;
  const rally = rallies[found];
  return { index: found, rally, live: t <= rally.end };
}

/**
 * Average shuttle speed of one shot in km/h, from where the hitter stood to
 * where the next player hit it. Real shuttles start much faster and slow
 * down, so this reads lower than a radar's peak, but it ranks shots fairly.
 */
export function shotSpeedKmh(from: Pt, to: Pt, seconds: number): number | null {
  if (seconds <= 0.05) return null;
  // The shuttle also rises and falls: add a typical 2 m of height change.
  const ground = dist(from, to);
  const path = Math.hypot(ground, 2);
  return (path / seconds) * 3.6;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}
