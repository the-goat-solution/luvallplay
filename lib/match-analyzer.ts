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

/**
 * Least-squares homography from four or more matching points (DLT with
 * h8 = 1). With exactly four it is the exact solution; extra points average
 * out tapping errors. Null when the points are degenerate.
 */
export function fitHomography(src: Pt[], dst: Pt[]): Mat3 | null {
  const n = Math.min(src.length, dst.length);
  if (n < 4) return null;
  if (n === 4) return solveHomography(src, dst);
  // Normalise both point sets for a well-conditioned solve.
  const norm = (pts: Pt[]) => {
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const d = pts.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length || 1;
    const k = Math.SQRT2 / d;
    return { T: [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1], pts: pts.map((p) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k })) };
  };
  const a = norm(src.slice(0, n));
  const b = norm(dst.slice(0, n));
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  for (let i = 0; i < n; i++) {
    const { x, y } = a.pts[i];
    const { x: u, y: v } = b.pts[i];
    for (const [row, rhs] of [
      [[x, y, 1, 0, 0, 0, -u * x, -u * y], u],
      [[0, 0, 0, x, y, 1, -v * x, -v * y], v],
    ] as [number[], number][]) {
      for (let r = 0; r < 8; r++) {
        Atb[r] += row[r] * rhs;
        for (let c = 0; c < 8; c++) AtA[r][c] += row[r] * row[c];
      }
    }
  }
  const h = solveLinear(AtA, Atb);
  if (!h) return null;
  const Hn = [...h, 1];
  const TbInv = invertMat3(b.T);
  if (!TbInv) return null;
  return normaliseH(mul3(TbInv, mul3(Hn, a.T)));
}

function mul3(A: Mat3, B: Mat3): Mat3 {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return out;
}

function normaliseH(H: Mat3): Mat3 {
  return Math.abs(H[8]) > 1e-12 ? H.map((v) => v / H[8]) : H;
}

/** A court point the assistant can tap: a line crossing or a net post foot. */
export type Landmark = { id: string; p: Pt };

/**
 * Every place two painted lines cross, plus the feet of the net posts (which
 * stand on the doubles sidelines). Ids are "x,y" in metres.
 */
export function courtLandmarks(): Landmark[] {
  const { width: W, length: L, net, singlesInset: si, shortService: ss, longServiceDoubles: ld } = COURT;
  const xs = [0, si, W / 2, W - si, W];
  const ys = [0, ld, net - ss, net + ss, L - ld, L];
  const out: Landmark[] = [];
  for (const y of ys) for (const x of xs) out.push({ id: landmarkId({ x, y }), p: { x, y } });
  out.push({ id: landmarkId({ x: 0, y: net }), p: { x: 0, y: net } });
  out.push({ id: landmarkId({ x: W, y: net }), p: { x: W, y: net } });
  return out;
}

export function landmarkId(p: Pt): string {
  return `${round(p.x, 2)},${round(p.y, 2)}`;
}

/** A calibration tap: where on the image, and which court point it is. */
export type CourtTap = { image: Pt; court: Pt };

/** Image ↔ court homographies from four or more taps. */
export function courtHomographyFromTaps(taps: CourtTap[]): { toCourt: Mat3; toImage: Mat3 } | null {
  if (taps.length < 4) return null;
  const toCourt = fitHomography(taps.map((t) => t.image), taps.map((t) => t.court));
  if (!toCourt || toCourt.some((v) => !Number.isFinite(v))) return null;
  const toImage = invertMat3(toCourt);
  if (!toImage) return null;
  // Reject fits that fold the court over (taps given in an impossible order).
  const err = taps.reduce((a, t) => {
    const q = applyHomography(toCourt, t.image);
    return Math.max(a, Math.hypot(q.x - t.court.x, q.y - t.court.y));
  }, 0);
  if (!Number.isFinite(err) || err > 1.5) return null;
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
/**
 * A person the detector found. `look` is a small normalised colour histogram
 * of their shirt, used to tell doubles partners apart when they cross.
 */
export type Detection = { box: Box; score: number; look?: number[] };
/** One analysed frame: its time and the people the detector found. */
export type Sample = { t: number; dets: Detection[] };
export type TrackPoint = { p: Pt; box: Box };
/** tracks[player][sampleIndex] — null where the player was not seen. */
export type Tracks = (TrackPoint | null)[][];
export type CourtDetection = Detection & { p: Pt };

/** The floor point under a detected person: the bottom-centre of the box. */
export function footPoint(box: Box): Pt {
  return { x: box[0] + box[2] / 2, y: box[1] + box[3] };
}

/** How far outside the lines a player can still be (lunges, deep clears). */
const COURT_MARGIN = { side: 1.0, end: 2.0 };

export function onCourt(p: Pt): boolean {
  return (
    p.x >= -COURT_MARGIN.side &&
    p.x <= COURT.width + COURT_MARGIN.side &&
    p.y >= -COURT_MARGIN.end &&
    p.y <= COURT.length + COURT_MARGIN.end
  );
}

export type FrameSize = { w: number; h: number };

/**
 * Detections whose feet land on (or just around) the court, with court
 * positions. With the frame size, people whose feet are cut off by the bottom
 * edge (the camera operator, someone walking past the lens) are dropped:
 * without their feet there is no telling where they stand.
 */
export function courtDetections(dets: Detection[], toCourt: Mat3, frame?: FrameSize): CourtDetection[] {
  return dets
    .filter((d) => !frame || (d.box[1] + d.box[3] < frame.h * 0.985 && d.box[3] < frame.h * 0.9))
    .map((d) => ({ ...d, p: applyHomography(toCourt, footPoint(d.box)) }))
    .filter((d) => Number.isFinite(d.p.x) && Number.isFinite(d.p.y) && onCourt(d.p));
}

/** Detector confidence below which an untagged person is not offered for tagging (spectators, shadows). */
export const TAG_MIN_SCORE = 0.4;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** The detection a tap lands on: inside its box, smallest box first (the nearer person when two overlap). */
export function detectionAtPoint<D extends Detection>(dets: D[], at: Pt, slack = 0): D | null {
  const hits = dets.filter(
    (d) => at.x >= d.box[0] - slack && at.x <= d.box[0] + d.box[2] + slack && at.y >= d.box[1] - slack && at.y <= d.box[1] + d.box[3] + slack,
  );
  hits.sort((a, b) => a.box[2] * a.box[3] - b.box[2] * b.box[3]);
  return hits[0] ?? null;
}

export function iou(a: Box, b: Box): number {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** 0 when two colour histograms are identical, 1 when they share nothing (Hellinger distance). */
export function lookDistance(a?: number[], b?: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let bc = 0;
  for (let i = 0; i < a.length; i++) bc += Math.sqrt(a[i] * b[i]);
  return Math.sqrt(Math.max(0, 1 - bc));
}

/** Fastest a player's feet can plausibly move, in m/s (sprint lunge). */
const MAX_PLAYER_SPEED = 8;
/** Base allowance for detector jitter on top of movement, in metres. */
const GATE_BASE = 0.8;
/** The search radius stops growing here: further than this is a different person. */
const GATE_MAX = 4;
/** How much a shirt-colour mismatch counts, in metres of extra distance. */
const LOOK_WEIGHT = 1.5;
/** Shirt colours this different are never the same player (unless they barely moved). */
const LOOK_REJECT = 0.6;
/** After losing a player for a moment, only take back someone who looks like them. */
const LOOK_REACQUIRE = 0.45;
/** Within this distance of the net a foot position could be either side. */
const NET_TOLERANCE = 0.4;
/** Running average rate for a player's shirt colour. */
const LOOK_RATE = 0.1;

/**
 * What the tracker remembers about one player: where and when they were last
 * seen, their shirt colour and which half of the court they play on (players
 * never cross the net during a game; when ends change, the assistant re-tags).
 */
export type PlayerMemory = { p: Pt; t: number; look?: number[]; tagLook?: number[]; side?: 0 | 1 } | null;

function blendLook(old: number[] | undefined, next: number[] | undefined): number[] | undefined {
  if (!next) return old;
  if (!old || old.length !== next.length) return next;
  return old.map((v, i) => v * (1 - LOOK_RATE) + next[i] * LOOK_RATE);
}

/**
 * One tracking step: matches this frame's on-court detections to the players
 * the tracker already knows. Pairs are taken closest first (court distance
 * plus a shirt-colour penalty), and only within the distance a player could
 * have covered since last seen. `forced` pins a player to a detection (a tap
 * from the court assistant) before anyone else is matched. `taken` marks
 * detections already used (by the other pass of an upload analysis).
 * Updates `memory` in place and returns the detection index per player.
 */
export function trackStep(
  memory: PlayerMemory[],
  dets: CourtDetection[],
  t: number,
  forced: Map<number, number> = new Map(),
  taken: Set<number> = new Set(),
  active: (i: number) => boolean = () => true,
): (number | null)[] {
  const out: (number | null)[] = memory.map(() => null);
  const usedI = new Set<number>();
  const usedJ = new Set<number>(taken);
  for (const [i, j] of forced) {
    if (j < 0 || j >= dets.length) continue;
    out[i] = j;
    usedI.add(i);
    usedJ.add(j);
    const look = dets[j].look ?? memory[i]?.look;
    memory[i] = { p: dets[j].p, t, look, tagLook: look, side: sideOf(dets[j].p) };
  }
  const pairs: { i: number; j: number; c: number }[] = [];
  memory.forEach((m, i) => {
    if (!m || usedI.has(i) || !active(i)) return;
    const lost = Math.abs(t - m.t);
    const gate = Math.min(GATE_MAX, GATE_BASE + MAX_PLAYER_SPEED * lost);
    dets.forEach((det, j) => {
      if (usedJ.has(j)) return;
      const d = dist(m.p, det.p);
      if (d > gate) return;
      if (m.side !== undefined && Math.abs(det.p.y - COURT.net) > NET_TOLERANCE && sideOf(det.p) !== m.side) return;
      const look = lookDistance(m.look, det.look);
      // Gates compare with the shirt seen when the player was tagged, so a
      // run of near-misses cannot slowly turn a player into a spectator.
      const vsTag = m.tagLook ? lookDistance(m.tagLook, det.look) : look;
      if (Math.max(look, vsTag) > LOOK_REJECT && d > 0.6) return;
      if (lost > 0.5 && vsTag > LOOK_REACQUIRE) return;
      pairs.push({ i, j, c: d + LOOK_WEIGHT * look });
    });
  });
  pairs.sort((a, b) => a.c - b.c);
  for (const { i, j } of pairs) {
    if (usedI.has(i) || usedJ.has(j)) continue;
    usedI.add(i);
    usedJ.add(j);
    out[i] = j;
    memory[i] = {
      p: dets[j].p,
      t,
      look: blendLook(memory[i]?.look, dets[j].look),
      tagLook: memory[i]?.tagLook,
      side: memory[i]?.side ?? sideOf(dets[j].p),
    };
  }
  return out;
}

/** A court assistant's tap: "at this analysed frame, this box is that player". */
export type Anchor = { sample: number; player: number; box: Box };

/** The detection in a sample that best matches an anchored box (they are usually identical). */
function anchorDetection(dets: CourtDetection[], box: Box): number {
  let best = -1, bestIou = 0.3;
  dets.forEach((d, j) => {
    const v = iou(d.box, box);
    if (v > bestIou) { bestIou = v; best = j; }
  });
  return best;
}

/**
 * Tracks for an uploaded video. Each player is followed forwards from the
 * first frame they were tagged, then backwards to the start. Later tags pin
 * the player again from that frame on, which is how a swapped identity is
 * fixed: tag the right person once and everything after follows.
 */
export function buildTracks(samples: Sample[], toCourt: Mat3, playerCount: number, anchors: Anchor[], frame?: FrameSize): Tracks {
  const tracks: Tracks = Array.from({ length: playerCount }, () => samples.map(() => null));
  const valid = anchors.filter((a) => a.player >= 0 && a.player < playerCount && a.sample >= 0 && a.sample < samples.length);
  if (valid.length === 0) return tracks;
  const bySample = new Map<number, Anchor[]>();
  for (const a of valid) bySample.set(a.sample, [...(bySample.get(a.sample) ?? []), a]);
  const firstTag = Array.from({ length: playerCount }, (_, i) => Math.min(...valid.filter((a) => a.player === i).map((a) => a.sample)));
  const dets = samples.map((s) => courtDetections(s.dets, toCourt, frame));

  const forcedAt = (k: number) => {
    const forced = new Map<number, number>();
    for (const a of bySample.get(k) ?? []) {
      const j = anchorDetection(dets[k], a.box);
      if (j >= 0) forced.set(a.player, j);
    }
    return forced;
  };

  // Forwards: a player joins at their first tag and is followed to the end.
  const memory: PlayerMemory[] = tracks.map(() => null);
  const start = Math.min(...firstTag.filter(Number.isFinite));
  for (let k = start; k < samples.length; k++) {
    const got = trackStep(memory, dets[k], samples[k].t, forcedAt(k));
    got.forEach((j, i) => {
      if (j !== null) tracks[i][k] = { p: dets[k][j].p, box: dets[k][j].box };
    });
  }

  // Backwards: from each player's first tag down to the start, using only
  // detections the forward pass left free.
  const back: PlayerMemory[] = tracks.map(() => null);
  const lastFirst = Math.max(...firstTag.filter(Number.isFinite));
  for (let k = lastFirst; k >= 0; k--) {
    const forced = new Map<number, number>();
    for (const [i, j] of forcedAt(k)) if (k === firstTag[i]) forced.set(i, j);
    const taken = new Set<number>();
    tracks.forEach((tr, i) => {
      if (k >= firstTag[i] && tr[k]) {
        const j = dets[k].findIndex((d) => d.box === tr[k]!.box);
        if (j >= 0) taken.add(j);
      }
    });
    const got = trackStep(back, dets[k], samples[k].t, forced, taken, (i) => k < firstTag[i]);
    got.forEach((j, i) => {
      if (j !== null && k < firstTag[i]) tracks[i][k] = { p: dets[k][j].p, box: dets[k][j].box };
    });
  }
  return tracks;
}

/** Which team (0 or 1) a court position is on: the near half or the far half of the net. */
export function sideOf(p: Pt): 0 | 1 {
  return p.y < COURT.net ? 0 : 1;
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

/**
 * computeMotion for a live feed: frames arrive one at a time and the result
 * is kept up to date without redoing the whole match on every frame. Only a
 * short tail (the part a late detection could still change) is recomputed,
 * so it gives the same numbers as computeMotion over the full track.
 */
export class MotionTracker {
  readonly motion: Motion = { t: [], p: [], box: [], cumDist: [], speed: [] };
  private raw: (TrackPoint | null)[] = [];
  /** Samples before this index can no longer change. */
  private settled = 0;

  push(t: number, tp: TrackPoint | null): void {
    const m = this.motion;
    m.t.push(t);
    this.raw.push(tp);
    const n = m.t.length;
    // Recompute from a window that holds everything the unsettled samples depend on.
    let ws = this.settled;
    const from = this.settled > 0 ? m.t[this.settled] ?? t : t;
    while (ws > 0 && m.t[ws - 1] >= from - (MAX_GAP + 0.2)) ws--;
    ws = Math.max(0, ws - 4);
    const part = computeMotion(m.t.slice(ws), this.raw.slice(ws));
    const anchor = this.settled - 1;
    const base = anchor >= ws ? m.cumDist[anchor] - part.cumDist[anchor - ws] : 0;
    for (let k = Math.max(this.settled, ws); k < n; k++) {
      m.p[k] = part.p[k - ws];
      m.box[k] = part.box[k - ws];
      m.speed[k] = part.speed[k - ws];
      m.cumDist[k] = base + part.cumDist[k - ws];
    }
    // A sample is final once a later point can no longer bridge a gap next to it.
    while (this.settled + 3 < n && m.t[this.settled + 3] < t - (MAX_GAP + 0.1)) this.settled++;
  }
}

// ── Hits and rallies ──────────────────────────────────────────────────────

export type Hit = { t: number; player: number };
export type Rally = { start: number; end: number; hits: Hit[] };

/** How long after the last hit a rally is still counted (shuttle in the air). */
export const RALLY_TAIL = 1.0;

/**
 * Splits hits into rallies: a new rally starts after a pause longer than
 * `gap` seconds, or after a "rally over" marker the court assistant pressed.
 */
export function groupRallies(hits: Hit[], gap = 4, breaks: number[] = []): Rally[] {
  const sorted = [...hits].sort((a, b) => a.t - b.t);
  const marks = [...breaks].sort((a, b) => a - b);
  const rallies: Rally[] = [];
  for (const h of sorted) {
    const cur = rallies[rallies.length - 1];
    const lastT = cur ? cur.hits[cur.hits.length - 1].t : -Infinity;
    const brokenAt = marks.find((b) => b > lastT && b <= h.t);
    if (cur && h.t - lastT <= gap && brokenAt === undefined) {
      cur.hits.push(h);
      cur.end = h.t + RALLY_TAIL;
    } else {
      rallies.push({ start: h.t, end: h.t + RALLY_TAIL, hits: [h] });
    }
  }
  // A marker shortly after the last hit ends that rally there.
  for (const r of rallies) {
    const last = r.hits[r.hits.length - 1].t;
    const b = marks.find((m) => m >= last && m < r.end);
    if (b !== undefined) r.end = b;
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

/** Where each player stood at time t; null when not tracked. */
export type PositionAt = (player: number, t: number) => Pt | null;

/** Estimated speed of each shot in a rally (hit i to hit i+1), in km/h. */
export function rallyShotSpeeds(rally: Rally, positionAt: PositionAt): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i + 1 < rally.hits.length; i++) {
    const a = rally.hits[i];
    const b = rally.hits[i + 1];
    const pa = positionAt(a.player, a.t);
    const pb = positionAt(b.player, b.t);
    // Two taps on the same side are a correction, not a shot over the net.
    out.push(pa && pb && sideOf(pa) !== sideOf(pb) ? shotSpeedKmh(pa, pb, b.t - a.t) : null);
  }
  return out;
}

/** The rally numbers the HUD shows at time t. */
export type RallyReadout = {
  index: number;
  total: number;
  /** Seconds since the serve (frozen once the rally is over). */
  time: number;
  /** Shots so far. */
  count: number;
  /** Speed of the latest finished shot, km/h. */
  shotKmh: number | null;
  live: boolean;
  /** Hits per player within this rally so far. */
  hitsBy: number[];
  start: number;
};

export function rallyReadout(rallies: Rally[], t: number, playerCount: number, positionAt: PositionAt): RallyReadout | null {
  const at = rallyAt(rallies, t);
  if (!at) return null;
  const { rally, index, live } = at;
  const done = rally.hits.filter((h) => h.t <= t);
  const speeds = rallyShotSpeeds(rally, positionAt);
  let shotKmh: number | null = null;
  for (let i = done.length - 2; i >= 0; i--) {
    if (speeds[i] != null) { shotKmh = speeds[i]; break; }
  }
  const hitsBy = new Array(playerCount).fill(0);
  for (const h of done) if (h.player < playerCount) hitsBy[h.player]++;
  return {
    index,
    total: rallies.length,
    time: Math.min(t, rally.end) - rally.start,
    count: done.length,
    shotKmh,
    live,
    hitsBy,
    start: rally.start,
  };
}

export type PlayerSummary = { hits: number; distance: number; topSpeed: number };
export type MatchSummary = {
  /** Seconds covered by the analysis. */
  duration: number;
  rallies: number;
  longestRally: number;
  avgRallyShots: number;
  fastestShotKmh: number | null;
  players: PlayerSummary[];
};

/** Whole-session totals: what is saved to a challenge and shown on the summary screen. */
export function summarise(motions: Motion[], hits: Hit[], rallies: Rally[], t0: number, t1: number, positionAt: PositionAt): MatchSummary {
  const players = motions.map((m, i) => {
    const mv = movementBetween(m, t0, t1);
    return {
      hits: hits.filter((h) => h.player === i).length,
      distance: round(mv.distance, 1),
      topSpeed: round(mv.topSpeed, 1),
    };
  });
  const lengths = rallies.map((r) => r.hits.length);
  const speeds = rallies.flatMap((r) => rallyShotSpeeds(r, positionAt)).filter((v): v is number => v != null);
  return {
    duration: round(Math.max(0, t1 - t0), 1),
    rallies: rallies.length,
    longestRally: lengths.length ? Math.max(...lengths) : 0,
    avgRallyShots: lengths.length ? round(lengths.reduce((a, b) => a + b, 0) / lengths.length, 1) : 0,
    fastestShotKmh: speeds.length ? Math.round(Math.max(...speeds)) : null,
    players,
  };
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
