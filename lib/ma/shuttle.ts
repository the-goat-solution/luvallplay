// Shuttle tracking from motion. The shuttle is a small, fast, bright blob in
// the three-frame difference image; rackets, arms and feet also move but stay
// attached to a player. Candidates are linked into flight tracks with a
// constant-acceleration prediction. A hit shows up as either
//   • a turn: the track's direction changes sharply within a few frames, or
//   • a relaunch: a track ends (the shuttle disappears behind a player or
//     the racket) and a new one starts nearby going a different way.
// Both become "trajectory cues" for the hit fusion (lib/ma/hits.ts).
//
// Coordinates are video pixels; `scale` converts the small analysis frame.

import type { Box, Pt } from "../match-analyzer.ts";
import type { Blob } from "./imaging.ts";

export type ShuttlePoint = { t: number; x: number; y: number; inZone?: boolean; p?: number };
/** A hit-like event on a shuttle track, with the flight points before and after it (for 3D fitting). */
export type TrajCue = {
  t: number;
  x: number;
  y: number;
  strength: number;
  kind: "turn" | "relaunch" | "launch";
  before: ShuttlePoint[];
  after: ShuttlePoint[];
};

type Track = { id: number; pts: ShuttlePoint[]; miss: number; confirmed: boolean; lastCueT: number; cids: number[] };

/** A shuttle candidate: video px position and score, plus what the AI checker needs (analysis px, blob measures). */
export type Candidate = { x: number; y: number; score: number; ax: number; ay: number; area: number; bright: number; isolation: number; background: number; id?: number; p?: number };

/** Points of a track after its last hit-like event (one flight), so a 3D fit never mixes two shots. */
function sinceCue(tr: Track, end: number): ShuttlePoint[] {
  return tr.pts.slice(0, end).filter((p) => p.t > tr.lastCueT + 0.02).slice(-16);
}

export type ShuttleOptions = {
  /** Video width in pixels (sets distance scales). */
  width: number;
  /** Frames a track may go unseen before it ends. */
  maxMiss?: number;
};

/**
 * Which motion blobs could be the shuttle: small, compact, away from other
 * motion, and not on a person. Bodies are masked whole, feet included (a
 * moving foot or shoe edge is the commonest false shuttle), except the racket
 * zone: the upper half of the box out to its sides and everything above the
 * head, where contacts happen. Crowded blobs (a body breaking into fragments
 * in the difference image) score low; a shuttle in flight is isolated.
 */
export function shuttleCandidates(blobs: Blob[], scale: number, players: Box[], frameArea: number, background?: BackgroundActivity, others: Box[] = []): Candidate[] {
  const maxArea = Math.max(6, frameArea * 0.00045);
  // Analysis-frame pixel scale (sizes below were set on a 640-wide frame).
  const k = Math.sqrt(frameArea / (640 * 360));
  const maxSide = 16 * k;
  const crowdR = 14 * k;
  const out: Candidate[] = [];
  for (const b of blobs) {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    if (b.area > maxArea || bw > maxSide || bh > maxSide) continue;
    if (Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) > 6) continue;
    const x = b.x / scale;
    const y = b.y / scale;
    let onBody = false;
    for (const p of players) {
      const [px, py, pw, ph] = p;
      if (x < px - 0.08 * pw || x > px + 1.08 * pw || y < py - 0.02 * ph || y > py + 1.06 * ph) continue;
      const upper = y < py + 0.55 * ph;
      const side = x < px + 0.25 * pw || x > px + 0.75 * pw;
      if (upper && side) continue; // racket zone
      onBody = true;
      break;
    }
    if (onBody) continue;
    // Anyone who is not one of our players (the next court, a passer-by) is masked whole:
    // their arms and racket are not where our shuttle is hit.
    if (others.some(([px, py, pw, ph]) => x > px - 0.08 * pw && x < px + 1.08 * pw && y > py - 0.02 * ph && y < py + 1.06 * ph)) continue;
    // Other motion nearby (in analysis pixels): fragments of a moving body or a waving net.
    let crowd = 0;
    for (const o of blobs) {
      if (o === b || o.area < 3) continue; // single-pixel specks are sensor noise, not a body
      if (Math.abs(o.x - b.x) < crowdR && Math.abs(o.y - b.y) < crowdR) crowd += o.area;
    }
    const isolation = crowd <= 2 * b.area ? 1 : crowd <= 8 * b.area ? 0.6 : 0.25;
    // Places that move all the time (crowd, LED boards, a fan, the next court) are background.
    const bg = background ? background.weight(b.x, b.y) : 1;
    // Brighter and more compact blobs look more like a white shuttle.
    const score = Math.min(1, 0.4 + b.bright / 400) * (b.area <= 2 ? 0.8 : 1) * isolation * bg;
    if (score < 0.15) continue;
    out.push({ x, y, score, ax: b.x, ay: b.y, area: b.area, bright: b.bright, isolation, background: bg });
  }
  // Too many candidates means noise or a moving background: keep the best.
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 30);
}

/** RMS residual (px) of a quadratic fit in time to x and y. */
function smoothness(pts: ShuttlePoint[]): number {
  const n = pts.length;
  if (n < 4) return Infinity;
  const t0 = pts[0].t;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  const ts = pts.map((p) => p.t - t0);
  for (const t of ts) {
    s0 += 1; s1 += t; s2 += t * t; s3 += t * t * t; s4 += t * t * t * t;
  }
  const fit = (v: number[]) => {
    let b0 = 0, b1 = 0, b2 = 0;
    ts.forEach((t, i) => { b0 += v[i]; b1 += v[i] * t; b2 += v[i] * t * t; });
    // Solve the 3×3 normal equations (Cramer).
    const M = [s0, s1, s2, s1, s2, s3, s2, s3, s4];
    const det = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    const D = det(M);
    if (Math.abs(D) < 1e-12) return Infinity;
    const c0 = det([b0, M[1], M[2], b1, M[4], M[5], b2, M[7], M[8]]) / D;
    const c1 = det([M[0], b0, M[2], M[3], b1, M[5], M[6], b2, M[8]]) / D;
    const c2 = det([M[0], M[1], b0, M[3], M[4], b1, M[6], M[7], b2]) / D;
    return ts.reduce((a, t, i) => a + (v[i] - (c0 + c1 * t + c2 * t * t)) ** 2, 0);
  };
  return Math.sqrt((fit(pts.map((p) => p.x)) + fit(pts.map((p) => p.y))) / n);
}

/**
 * How much each part of the frame moves when no player is there, learned as
 * the game goes on (a coarse grid, decaying over ~10 s). The shuttle crosses
 * any one cell for a few frames; crowds, animated boards and fans keep moving.
 */
export class BackgroundActivity {
  private readonly gw = 32;
  private readonly gh = 18;
  private readonly grid = new Float32Array(32 * 18);
  private frames = 0;
  private readonly w: number;
  private readonly h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  /** Adds one frame's motion blobs (analysis pixels), leaving out those on or around a person. */
  add(blobs: Blob[], bodies: Box[], scale: number) {
    const decay = 0.99;
    for (let i = 0; i < this.grid.length; i++) this.grid[i] *= decay;
    const cellArea = (this.w / this.gw) * (this.h / this.gh);
    for (const b of blobs) {
      const x = b.x / scale, y = b.y / scale;
      if (bodies.some((p) => x > p[0] - 0.5 * p[2] && x < p[0] + 1.5 * p[2] && y > p[1] - 0.5 * p[3] && y < p[1] + 1.1 * p[3])) continue;
      const cx = Math.min(this.gw - 1, Math.floor((b.x / this.w) * this.gw));
      const cy = Math.min(this.gh - 1, Math.floor((b.y / this.h) * this.gh));
      this.grid[cy * this.gw + cx] += Math.min(1, b.area / cellArea) * (1 - decay) * 100;
    }
    this.frames++;
  }

  /** 1 for a quiet place, falling towards 0.1 where something moves most of the time. */
  weight(x: number, y: number): number {
    if (this.frames < 30) return 1;
    const cx = Math.min(this.gw - 1, Math.max(0, Math.floor((x / this.w) * this.gw)));
    const cy = Math.min(this.gh - 1, Math.max(0, Math.floor((y / this.h) * this.gh)));
    const a = this.grid[cy * this.gw + cx];
    return Math.max(0.1, Math.exp(-a / 1.5));
  }
}

/**
 * AI checker: mean shuttle probability a flight's points need. Mild on purpose:
 * on the simulator (where the motion tracker is already precise) 0.1–0.15 is
 * neutral and 0.3+ starts to lose dim flights; on real footage it removes
 * tracks that clearly are not a shuttle (feet, rackets, the crowd).
 */
const FLIGHT_MIN_P = 0.15;

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const d = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (d < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / d)));
}

export class ShuttleTracker {
  private tracks: Track[] = [];
  private ended: Track[] = [];
  private nextId = 1;
  private readonly w: number;
  private readonly maxMiss: number;
  private lastLaunchT = -Infinity;

  constructor(opts: ShuttleOptions) {
    this.w = opts.width;
    this.maxMiss = opts.maxMiss ?? 6;
  }

  /** Recent points of the best current track (for drawing the trail). */
  trail(now: number, seconds = 0.6): ShuttlePoint[] {
    const live = this.tracks.filter((t) => t.confirmed).sort((a, b) => b.pts.length - a.pts.length)[0];
    if (!live) return [];
    return live.pts.filter((p) => now - p.t <= seconds);
  }

  /** Feeds one frame's candidates (time t of the middle frame). Returns new trajectory cues. */
  /** Self-labels for the AI checker: candidate id → 1 (became part of a flight) or 0 (a fragment that died). */
  labels: { id: number; y: 0 | 1 }[] = [];

  update(t: number, cands: { x: number; y: number; score: number; id?: number; p?: number }[], players: Box[]): TrajCue[] {
    const cues: TrajCue[] = [];
    // Around each player (racket reach): rackets and arms move here all the time. A real
    // flight leaves these zones, so a track only counts once it has points outside them.
    // Racket reach: beside the shoulders and above the head (not the whole box surroundings:
    // seen from behind a baseline four players' boxes cover most of the court).
    const inZone = (x: number, y: number) =>
      players.some((b) => x > b[0] - 0.35 * b[2] && x < b[0] + 1.35 * b[2] && y > b[1] - 0.4 * b[3] && y < b[1] + 0.55 * b[3]);
    const used = new Set<number>();
    const minSpeed = this.w * 0.06; // px/s: slower than this is not a shuttle in flight
    // Predict and associate, longest tracks first.
    const order = [...this.tracks].sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.pts.length - a.pts.length);
    for (const tr of order) {
      const pred = this.predict(tr, t);
      const n = tr.pts.length;
      const last = tr.pts[n - 1];
      const dt = Math.max(1e-3, t - last.t);
      const v = n >= 2 ? Math.hypot(last.x - tr.pts[n - 2].x, last.y - tr.pts[n - 2].y) / Math.max(1e-3, last.t - tr.pts[n - 2].t) : 0;
      // Prediction error grows with speed and time unseen, but a confirmed flight is
      // predictable: a wide gate lets it jump onto a nearby racket or arm.
      const gate = tr.confirmed ? this.w * 0.02 + 0.35 * v * dt : this.w * 0.03 + 0.5 * v * dt + (n < 2 ? this.w * 0.06 : 0);
      let best = -1;
      let bestD = Infinity;
      cands.forEach((c, j) => {
        if (used.has(j)) return;
        const d = Math.hypot(c.x - pred.x, c.y - pred.y);
        if (d < gate && d < bestD) {
          bestD = d;
          best = j;
        }
      });
      if (best >= 0) {
        used.add(best);
        tr.pts.push({ t, x: cands[best].x, y: cands[best].y, inZone: inZone(cands[best].x, cands[best].y), p: cands[best].p });
        const cid = cands[best].id;
        if (cid !== undefined) {
          // Positive only in clear flight: outside racket reach and moving fast.
          if (tr.confirmed) {
            const q = tr.pts[tr.pts.length - 2];
            const sp = q ? Math.hypot(cands[best].x - q.x, cands[best].y - q.y) / Math.max(1e-3, t - q.t) : 0;
            if (!tr.pts[tr.pts.length - 1].inZone && sp > minSpeed) this.labels.push({ id: cid, y: 1 });
          } else tr.cids.push(cid);
        }
        if (tr.pts.length > 90) tr.pts.shift();
        tr.miss = 0;
        if (!tr.confirmed && this.isFlight(tr, minSpeed, players)) {
          tr.confirmed = true;
          // The points that made it a flight (outside racket reach) are shuttles.
          tr.pts.slice(-tr.cids.length).forEach((p, i) => {
            if (!p.inZone) this.labels.push({ id: tr.cids[i], y: 1 });
          });
          tr.cids = [];
          const c = this.onConfirmed(tr, players);
          if (c) cues.push(c);
        }
        if (tr.confirmed) {
          const c = this.turnAt(tr, minSpeed);
          if (c) cues.push(c);
        }
      } else {
        tr.miss++;
      }
    }
    // A confirmed track that has stopped travelling is no longer a flight (the shuttle
    // landed, or the track slid onto a moving arm): end it.
    for (const tr of this.tracks) {
      if (!tr.confirmed || tr.miss > 0 || tr.pts.length < 5) continue;
      const a = tr.pts[tr.pts.length - 5], b = tr.pts[tr.pts.length - 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1e-3, b.t - a.t) < minSpeed * 0.5) tr.miss = this.maxMiss + 1;
    }
    // Ended tracks are remembered briefly, to spot a relaunch.
    for (const tr of this.tracks) {
      if (tr.miss > this.maxMiss) {
        if (tr.confirmed) this.ended.push(tr);
      }
    }
    for (const tr of this.tracks) {
      // An unconfirmed track that dies young was not a flight: its candidates were not shuttles.
      if (tr.miss > this.maxMiss && !tr.confirmed) for (const id of tr.cids) this.labels.push({ id, y: 0 });
    }
    this.tracks = this.tracks.filter((tr) => tr.miss <= this.maxMiss);
    this.ended = this.ended.filter((tr) => t - tr.pts[tr.pts.length - 1].t < 0.6);
    // New tentative tracks from unused candidates.
    cands.forEach((c, j) => {
      if (used.has(j)) return;
      if (this.tracks.length >= 10) return;
      this.tracks.push({ id: this.nextId++, pts: [{ t, x: c.x, y: c.y, inZone: inZone(c.x, c.y) }], miss: 0, confirmed: false, lastCueT: -Infinity, cids: c.id !== undefined ? [c.id] : [] });
    });
    // Drop tentative tracks that never confirm.
    for (const tr of this.tracks) {
      if (!tr.confirmed && tr.pts.length < 2 && tr.miss > 2) for (const id of tr.cids) this.labels.push({ id, y: 0 });
    }
    this.tracks = this.tracks.filter((tr) => tr.confirmed || tr.pts.length >= 2 || tr.miss <= 2);
    return cues;
  }

  /** Looks like a shuttle in flight: long enough, mostly outside player zones, really travelling. */
  private isFlight(tr: Track, minSpeed: number, players: Box[]): boolean {
    const n = tr.pts.length;
    if (n < 4) return false;
    const out = tr.pts.filter((p) => !p.inZone).length;
    if (out < 3) return false;
    const a = tr.pts[0], b = tr.pts[n - 1];
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    // Farther than a racket can swing: about a player's height at that depth (racket heads
    // move up to ~1.2 m in a stroke; a shuttle in flight covers that in a fraction of a second).
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let h = 0, bestD = Infinity;
    for (const p of players) {
      const d = Math.hypot(p[0] + p[2] / 2 - mx, p[1] + p[3] / 2 - my);
      if (d < bestD) {
        bestD = d;
        h = p[3];
      }
    }
    if (span < Math.max(this.w * 0.03, h * 0.8)) return false;
    if (span / Math.max(1e-3, b.t - a.t) <= minSpeed) return false;
    // AI checker: the points in flight (outside racket reach) must look like a shuttle on average.
    const scored = tr.pts.filter((p) => !p.inZone && p.p !== undefined);
    if (scored.length >= 3 && scored.reduce((s, p) => s + p.p!, 0) / scored.length < FLIGHT_MIN_P) return false;
    // A flight is smooth: a parabola in each image axis fits within a few pixels. Body
    // fragments and noise picked up one after another zig-zag.
    return smoothness(tr.pts.slice(-8)) < this.w * 0.008;
  }

  private velocity(pts: ShuttlePoint[], i: number): Pt {
    const j = Math.max(0, i - 2);
    const k = Math.min(pts.length - 1, Math.max(i, j + 1));
    const a = pts[j], b = pts[k];
    const dt = Math.max(1e-3, b.t - a.t);
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }

  private speed(tr: Track, i: number): number {
    if (i < 1) return 0;
    const a = tr.pts[i - 1];
    const b = tr.pts[i];
    return Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1e-3, b.t - a.t);
  }

  private predict(tr: Track, t: number): Pt {
    const n = tr.pts.length;
    const p = tr.pts[n - 1];
    if (n < 2) return p;
    const q = tr.pts[n - 2];
    const dt1 = Math.max(1e-3, p.t - q.t);
    let vx = (p.x - q.x) / dt1;
    let vy = (p.y - q.y) / dt1;
    let ax = 0;
    let ay = 0;
    if (n >= 3) {
      const r = tr.pts[n - 3];
      const dt0 = Math.max(1e-3, q.t - r.t);
      const vx0 = (q.x - r.x) / dt0;
      const vy0 = (q.y - r.y) / dt0;
      ax = (vx - vx0) / ((dt0 + dt1) / 2);
      ay = (vy - vy0) / ((dt0 + dt1) / 2);
      // Keep the acceleration plausible (gravity and drag, seen in pixels).
      const amax = this.w * 3;
      const am = Math.hypot(ax, ay);
      if (am > amax) {
        ax *= amax / am;
        ay *= amax / am;
      }
    }
    const dt = t - p.t;
    vx += ax * dt * 0.5;
    vy += ay * dt * 0.5;
    return { x: p.x + vx * dt, y: p.y + vy * dt };
  }

  /** A sharp change of direction at the point two samples back (needs a sample either side). */
  private turnAt(tr: Track, minSpeed: number): TrajCue | null {
    const n = tr.pts.length;
    if (n < 5) return null;
    const a = tr.pts[n - 5], b = tr.pts[n - 3], c = tr.pts[n - 1];
    const pivot = tr.pts[n - 3];
    if (pivot.t - tr.lastCueT < 0.3) return null;
    // The incoming flight must have been a real flight (outside the player zones).
    if (tr.pts.slice(0, n - 3).filter((p) => !p.inZone).length < 2) return null;
    const vin = { x: (b.x - a.x) / Math.max(1e-3, b.t - a.t), y: (b.y - a.y) / Math.max(1e-3, b.t - a.t) };
    const vout = { x: (c.x - b.x) / Math.max(1e-3, c.t - b.t), y: (c.y - b.y) / Math.max(1e-3, c.t - b.t) };
    const sIn = Math.hypot(vin.x, vin.y);
    const sOut = Math.hypot(vout.x, vout.y);
    if (sIn < minSpeed || sOut < minSpeed) return null;
    const ang = angleBetween(vin.x, vin.y, vout.x, vout.y);
    if (ang < (65 * Math.PI) / 180) return null;
    const before = sinceCue(tr, n - 2);
    tr.lastCueT = pivot.t;
    const strength = Math.min(1, (ang - (50 * Math.PI) / 180) / ((70 * Math.PI) / 180)) * Math.min(1, sOut / (minSpeed * 2.5));
    return { t: pivot.t, x: pivot.x, y: pivot.y, strength, kind: "turn", before, after: tr.pts.slice(n - 3) };
  }

  /** A newly confirmed track: a relaunch after a recently ended one, or a launch from a player (serve). */
  private onConfirmed(tr: Track, players: Box[]): TrajCue | null {
    const s = tr.pts[0];
    const s2 = tr.pts[Math.min(tr.pts.length - 1, 3)];
    const vNew = { x: s2.x - s.x, y: s2.y - s.y };
    let best: TrajCue | null = null;
    for (const old of this.ended) {
      const e = old.pts[old.pts.length - 1];
      const e0 = old.pts[Math.max(0, old.pts.length - 4)];
      const gap = s.t - e.t;
      if (gap <= 0 || gap > 0.5) continue;
      const dist = Math.hypot(s.x - e.x, s.y - e.y);
      if (dist > this.w * 0.12) continue;
      const ang = angleBetween(e.x - e0.x, e.y - e0.y, vNew.x, vNew.y);
      if (ang < (55 * Math.PI) / 180) continue;
      const strength = Math.min(1, (ang - (40 * Math.PI) / 180) / ((80 * Math.PI) / 180)) * (1 - gap / 0.8) * (1 - dist / (this.w * 0.2));
      // When did the two flights meet? Closest approach of the old one carried forward and the new one carried back.
      const ve = this.velocity(old.pts, old.pts.length - 1);
      const vs = this.velocity(tr.pts, Math.min(2, tr.pts.length - 1));
      const meet = closestApproach(e, ve, s, vs);
      const tm = Math.max(e.t, Math.min(s.t, meet));
      const at = { x: e.x + ve.x * (tm - e.t), y: e.y + ve.y * (tm - e.t) };
      if (!best || strength > best.strength) best = { t: tm, x: at.x, y: at.y, strength, kind: "relaunch", before: sinceCue(old, old.pts.length), after: [...tr.pts] };
    }
    if (best) {
      this.lastLaunchT = best.t;
      return best;
    }
    // A flight that starts next to a player with nothing before it: a serve (weaker evidence).
    if (s.t - this.lastLaunchT > 1.5) {
      for (const p of players) {
        const cx = p[0] + p[2] / 2;
        const cy = p[1] + p[3] * 0.35;
        const d = Math.hypot(s.x - cx, s.y - cy);
        if (d < Math.max(p[3] * 0.8, this.w * 0.04)) {
          // Back-date the launch by how long the shuttle took to get here from the racket.
          const v = this.velocity(tr.pts, Math.min(2, tr.pts.length - 1));
          const sp = Math.hypot(v.x, v.y);
          const back = sp > 1 ? Math.min(0.3, (d * 0.7) / sp) : 0.05;
          this.lastLaunchT = s.t;
          return { t: s.t - back, x: s.x - v.x * back, y: s.y - v.y * back, strength: 0.45, kind: "launch", before: [], after: [...tr.pts] };
        }
      }
    }
    return null;
  }
}

/** Time at which p(t) = e + ve·(t − e.t) and q(t) = s + vs·(t − s.t) are closest (unclamped). */
function closestApproach(e: ShuttlePoint, ve: Pt, s: ShuttlePoint, vs: Pt): number {
  // d(t) = (e − s) + ve·(t − e.t) − vs·(t − s.t) = A + B·t
  const ax = e.x - s.x - ve.x * e.t + vs.x * s.t;
  const ay = e.y - s.y - ve.y * e.t + vs.y * s.t;
  const bx = ve.x - vs.x;
  const by = ve.y - vs.y;
  const bb = bx * bx + by * by;
  if (bb < 1e-9) return (e.t + s.t) / 2;
  return -(ax * bx + ay * by) / bb;
}
