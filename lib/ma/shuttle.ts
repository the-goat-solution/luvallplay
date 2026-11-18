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

export type ShuttlePoint = { t: number; x: number; y: number; inZone?: boolean };
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

type Track = { id: number; pts: ShuttlePoint[]; miss: number; confirmed: boolean; lastCueT: number };

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
 * Which motion blobs could be the shuttle: small, compact, and not on a
 * player's legs or torso (the lower two thirds of the box). The racket zone
 * (head height and to the sides) stays allowed: that is where hits happen.
 */
export function shuttleCandidates(blobs: Blob[], scale: number, players: Box[], frameArea: number): { x: number; y: number; score: number }[] {
  const maxArea = Math.max(6, frameArea * 0.00045);
  const out: { x: number; y: number; score: number }[] = [];
  for (const b of blobs) {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    if (b.area > maxArea || bw > 16 || bh > 16) continue;
    if (Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) > 6) continue;
    const x = b.x / scale;
    const y = b.y / scale;
    let onBody = false;
    for (const p of players) {
      // Head, torso and legs (not the space beside the shoulders, where the racket meets the shuttle).
      if (x > p[0] + p[2] * 0.12 && x < p[0] + p[2] * 0.88 && y > p[1] - p[3] * 0.02 && y < p[1] + p[3]) {
        onBody = true;
        break;
      }
    }
    if (onBody) continue;
    // Brighter and more compact blobs look more like a white shuttle.
    const score = Math.min(1, 0.4 + b.bright / 400) * (b.area <= 2 ? 0.8 : 1);
    out.push({ x, y, score });
  }
  // Too many candidates means noise or a moving background: keep the best.
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 30);
}

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
  update(t: number, cands: { x: number; y: number; score: number }[], players: Box[]): TrajCue[] {
    const cues: TrajCue[] = [];
    // Around each player (racket reach): rackets and arms move here all the time. A real
    // flight leaves these zones, so a track only counts once it has points outside them.
    const inZone = (x: number, y: number) =>
      players.some((b) => x > b[0] - 0.6 * b[2] && x < b[0] + 1.6 * b[2] && y > b[1] - 0.5 * b[3] && y < b[1] + 0.65 * b[3]);
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
      const gate = this.w * 0.03 + 0.5 * v * dt + (n < 2 ? this.w * 0.06 : 0);
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
        tr.pts.push({ t, x: cands[best].x, y: cands[best].y, inZone: inZone(cands[best].x, cands[best].y) });
        if (tr.pts.length > 90) tr.pts.shift();
        tr.miss = 0;
        if (!tr.confirmed && this.isFlight(tr, minSpeed, players)) {
          tr.confirmed = true;
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
    // Ended tracks are remembered briefly, to spot a relaunch.
    for (const tr of this.tracks) {
      if (tr.miss > this.maxMiss) {
        if (tr.confirmed) this.ended.push(tr);
      }
    }
    this.tracks = this.tracks.filter((tr) => tr.miss <= this.maxMiss);
    this.ended = this.ended.filter((tr) => t - tr.pts[tr.pts.length - 1].t < 0.6);
    // New tentative tracks from unused candidates.
    cands.forEach((c, j) => {
      if (used.has(j)) return;
      if (this.tracks.length >= 10) return;
      this.tracks.push({ id: this.nextId++, pts: [{ t, x: c.x, y: c.y, inZone: inZone(c.x, c.y) }], miss: 0, confirmed: false, lastCueT: -Infinity });
    });
    // Drop tentative tracks that never confirm.
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
    return span / Math.max(1e-3, b.t - a.t) > minSpeed;
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
