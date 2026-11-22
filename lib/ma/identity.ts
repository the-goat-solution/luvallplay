// Who is who: keeps the four player identities through a doubles game, even
// when partners wear the same shirt.
//
// Per frame (SORT / OC-SORT family, adapted to a badminton court):
//   1. Each player has a constant-velocity Kalman filter in court metres.
//   2. Detections are matched to players by the Hungarian method on a cost
//      that adds Mahalanobis distance (motion), a three-part colour
//      fingerprint (shirt, shorts, legs/shoes) and body height. Players can
//      never be matched across the net.
//   3. When two partners come close (cross, overlap, one hides the other) the
//      tracker remembers how each looked and moved before. Once they are
//      apart again it compares "kept" against "swapped" over the next ~0.6 s
//      (appearance, height and where each was heading) and, if swapped wins,
//      swaps them back from the moment they met (a SwapEvent lets the engine
//      fix the stats and hits recorded in between).
//   4. Players start on four slots (near/far × left/right as the camera sees
//      them, set before the game) and are picked up automatically once two
//      people stand on each half; a tap can still pin someone.

import { COURT, iou, type Box, type Pt } from "../match-analyzer.ts";
import { hungarian } from "./hungarian.ts";
import { lookDistance3 } from "./imaging.ts";

export type Slot = { side: 0 | 1; lr: 0 | 1 };
export const DOUBLES_SLOTS: Slot[] = [
  { side: 0, lr: 0 },
  { side: 0, lr: 1 },
  { side: 1, lr: 0 },
  { side: 1, lr: 1 },
];
/** Singles: one player a side. */
export const SINGLES_SLOTS: Slot[] = [
  { side: 0, lr: 0 },
  { side: 1, lr: 0 },
];

/** A detected person on court: box (video px), court position, metres per pixel at their feet. */
export type PersonObs = { box: Box; score: number; look?: number[]; p: Pt; mpp: number; h3?: number; edge?: boolean };
export type SwapEvent = { a: number; b: number; from: number };

type KF = { x: number[]; P: number[] };

type PlayerState = {
  slot: Slot;
  kf: KF | null;
  lastT: number;
  lastObsT: number;
  look?: number[];
  heights: number[];
  height: number;
  box: Box | null;
  conf: number;
  /** Where they were last seen (court metres). */
  lastPos: Pt | null;
};

type Interaction = {
  a: number;
  b: number;
  start: number;
  phase: "close" | "resolving";
  pre: { look: (number[] | undefined)[]; h: number[]; pos: Pt[]; vel: Pt[] };
  keep: number;
  swap: number;
  n: number;
  sepT: number;
};

const Q_ACC = 12; // m²/s³: how hard a badminton player can change speed
const C_MISS = 9; // cost of leaving a player unmatched this frame
const GATE_D2 = 16; // Mahalanobis gate (χ², 2 dof, ~99.97%)
const W_APP = 6;
const W_H = 1;
const NET_TOL = 0.4;

const sideOf = (p: Pt): 0 | 1 => (p.y < COURT.net ? 0 : 1);

function kfInit(p: Pt): KF {
  return { x: [p.x, p.y, 0, 0], P: [0.3, 0, 0, 0, 0, 0.3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4] };
}

/** Velocity memory (s): a badminton player changes direction within a second, so an unseen player's velocity fades instead of carrying them off court. */
const V_TAU = 0.6;

function kfPredict(k: KF, dt: number): KF {
  const [x, y, vx, vy] = k.x;
  const P = k.P;
  const fade = Math.exp(-dt / V_TAU);
  const travel = V_TAU * (1 - fade);
  const nx = [x + vx * travel, y + vy * travel, vx * fade, vy * fade];
  // P' = F P Fᵀ + Q, F = [[I, dt·I],[0, I]] (axes independent).
  const out = new Array(16).fill(0);
  for (const [i, j] of [[0, 2], [1, 3]] as const) {
    const pp = P[i * 4 + i], pv = P[i * 4 + j], vv = P[j * 4 + j];
    const q = Q_ACC;
    out[i * 4 + i] = pp + 2 * dt * pv + dt * dt * vv + (q * dt ** 3) / 3;
    out[i * 4 + j] = out[j * 4 + i] = pv + dt * vv + (q * dt ** 2) / 2;
    out[j * 4 + j] = vv + q * dt;
  }
  return { x: nx, P: out };
}

/** Squared Mahalanobis distance of a position measurement, and the innovation covariance. */
function kfD2(k: KF, z: Pt, r: number): number {
  const sx = k.P[0] + r * r;
  const sy = k.P[5] + r * r;
  const dx = z.x - k.x[0];
  const dy = z.y - k.x[1];
  return (dx * dx) / sx + (dy * dy) / sy;
}

function kfUpdate(k: KF, z: Pt, r: number): KF {
  const x = [...k.x];
  const P = [...k.P];
  for (const [i, j] of [[0, 2], [1, 3]] as const) {
    const s = P[i * 4 + i] + r * r;
    const kp = P[i * 4 + i] / s;
    const kv = P[j * 4 + i] / s;
    const innov = (i === 0 ? z.x : z.y) - x[i];
    x[i] += kp * innov;
    x[j] += kv * innov;
    const pp = P[i * 4 + i], pv = P[i * 4 + j], vv = P[j * 4 + j];
    P[i * 4 + i] = (1 - kp) * pp;
    P[i * 4 + j] = P[j * 4 + i] = (1 - kp) * pv;
    P[j * 4 + j] = vv - kv * pv;
  }
  // Players do not run faster than ~7 m/s: clamp runaway velocities from bad matches.
  const sp = Math.hypot(x[2], x[3]);
  if (sp > 7) {
    x[2] *= 7 / sp;
    x[3] *= 7 / sp;
  }
  return { x, P };
}

function heightOf(o: PersonObs): number | null {
  // Only standing poses: crouches and jumps would add noise.
  if (o.box[3] / Math.max(1, o.box[2]) < 1.7) return null;
  // Real height from the 3D camera when there is one (box height × floor scale is badly
  // off when the camera is low: the floor shrinks with depth much faster than people do).
  return o.h3 ?? o.box[3] * o.mpp;
}

function blendLook(old: number[] | undefined, next: number[] | undefined, rate: number): number[] | undefined {
  if (!next) return old;
  if (!old || old.length !== next.length) return next;
  return old.map((v, i) => v * (1 - rate) + next[i] * rate);
}

function quantile(a: number[], q: number): number {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length * q)] : 0;
}

/** Inside the court lines with a small margin: where players stand, not the spectators beside it. */
function inPlay(p: Pt): boolean {
  return p.x > -0.6 && p.x < COURT.width + 0.6 && p.y > -0.6 && p.y < COURT.length + 0.6;
}

/**
 * Could this be a player rather than someone sitting beside the court? Only
 * checked when (re)acquiring, against the tracked players' own median height
 * (so an uncertain focal length scales both alike): well under it is a seated
 * spectator, a child or a partial box.
 */
function plausibleHeight(o: PersonObs, ref: number | null, min = 0.72): boolean {
  if (!o.h3 || !ref) return true;
  return o.h3 >= min * ref;
}

export class IdentityTracker {
  readonly players: PlayerState[];
  private interactions: Interaction[] = [];
  /** Per slot: where a waiting player is being seen, and how many times in a row. */
  private autoCand: ({ p: Pt; n: number; t: number } | null)[] = [];
  /** Typical time between detection frames (seconds, smoothed). */
  private detGap = 0.1;
  private lastUpdateT: number | null = null;
  /** Image x of the centre line at a court point's depth (to tell left from right as the camera sees it). */
  centreX: ((p: Pt) => number) | null = null;
  /** The last frame's detections and which player took each (for taps). */
  lastObs: PersonObs[] = [];
  lastAssign: (number | null)[] = [];

  constructor(slots: Slot[] = DOUBLES_SLOTS) {
    this.players = slots.map((slot) => ({ slot, kf: null, lastT: 0, lastObsT: -Infinity, heights: [], height: 0, box: null, conf: 0, lastPos: null }));
  }

  get ready(): boolean {
    return this.players.every((p) => p.kf !== null);
  }

  /** Median standing height of the tracked players (3D camera units), once known. */
  private refHeight(): number | null {
    const hs = this.players.filter((p) => p.kf && p.heights.length >= 8).map((p) => p.height);
    if (hs.length < 2) return null;
    return quantile(hs, 0.5);
  }

  /** Current position estimate (Kalman prediction) for drawing between detections. */
  positionAt(i: number, t: number): Pt | null {
    const p = this.players[i];
    if (!p.kf || t - p.lastObsT > 2) return null;
    const k = kfPredict(p.kf, Math.max(0, Math.min(0.3, t - p.lastT)));
    return { x: k.x[0], y: k.x[1] };
  }

  /** Pins a player to a person in the last frame (an assistant's tap). Swaps if that person was someone else. */
  force(player: number, obsIndex: number, t: number): SwapEvent | null {
    const o = this.lastObs[obsIndex];
    if (!o) return null;
    const owner = this.lastAssign.indexOf(obsIndex);
    const me = this.players[player];
    let ev: SwapEvent | null = null;
    if (owner >= 0 && owner !== player) {
      this.swapStates(owner, player);
      ev = { a: owner, b: player, from: t };
    }
    me.kf = kfInit(o.p);
    me.lastT = me.lastObsT = t;
    me.lastPos = o.p;
    me.look = o.look;
    me.box = o.box;
    me.conf = 1;
    this.lastAssign = this.lastAssign.map((j, i) => (i === player ? obsIndex : j === obsIndex ? null : j));
    return ev;
  }

  private swapStates(a: number, b: number) {
    const A = this.players[a];
    const B = this.players[b];
    for (const key of ["kf", "lastT", "lastObsT", "look", "heights", "height", "box", "lastPos"] as const) {
      const tmp = A[key];
      (A as Record<string, unknown>)[key] = B[key];
      (B as Record<string, unknown>)[key] = tmp;
    }
  }

  /** One detection frame. Returns which observation each player took, plus any identity corrections. */
  update(t: number, obs: PersonObs[]): { assign: (number | null)[]; swaps: SwapEvent[] } {
    const swaps: SwapEvent[] = [];
    const P = this.players;
    if (this.lastUpdateT !== null && t > this.lastUpdateT) this.detGap += (Math.min(3, t - this.lastUpdateT) - this.detGap) * 0.3;
    this.lastUpdateT = t;
    // Predict everyone to now.
    for (const p of P) {
      if (p.kf) {
        p.kf = kfPredict(p.kf, Math.max(0, t - p.lastT));
        p.lastT = t;
      }
    }

    const active = P.map((p, i) => (p.kf ? i : -1)).filter((i) => i >= 0);
    const refH = this.refHeight();
    const assign: (number | null)[] = P.map(() => null);
    if (active.length && obs.length) {
      const cost = active.map((i) => {
        const p = P[i];
        const lost = t - p.lastObsT;
        const row = obs.map((o) => {
          if (Math.abs(o.p.y - COURT.net) > NET_TOL && sideOf(o.p) !== p.slot.side) return 1e6;
          // Even mid-lunge a player stands well over half their height; someone seated does not.
          if (!plausibleHeight(o, refH, 0.6)) return 1e6;
          const r = Math.min(1, Math.max(0.08, 4 * o.mpp));
          const app = lookDistance3(p.look, o.look);
          const d2 = kfD2(p.kf!, o.p, r);
          if (lost < 1) {
            if (d2 > GATE_D2) return 1e6;
          } else {
            // Re-acquiring after a gap: near where they were last seen (they can have moved
            // about 3.5 m a second, up to a whole half), and looking like them.
            if (!plausibleHeight(o, refH)) return 1e6;
            const last = p.lastPos ?? { x: p.kf!.x[0], y: p.kf!.x[1] };
            const d = Math.hypot(o.p.x - last.x, o.p.y - last.y);
            if (d > 1.5 + 3.5 * Math.min(2, lost) || app > 0.55) return 1e6;
            return 0.5 * Math.min(GATE_D2, (d / (0.8 + lost)) ** 2) + W_APP * app + 2;
          }
          const h = heightOf(o);
          const hTerm = h && p.height ? Math.min(4, Math.abs(Math.log(h / p.height)) / 0.07) : 0;
          return 0.5 * Math.min(d2, GATE_D2) + W_APP * app + W_H * hTerm;
        });
        // One "stay unmatched" column per player.
        return [...row, ...active.map((_, k) => (k === active.indexOf(i) ? C_MISS : 1e6))];
      });
      const res = hungarian(cost);
      res.forEach((j, k) => {
        if (j >= 0 && j < obs.length) assign[active[k]] = j;
      });
    }

    const interacting = new Set<number>();
    for (const it of this.interactions) {
      interacting.add(it.a);
      interacting.add(it.b);
    }
    assign.forEach((j, i) => {
      if (j === null) return;
      const p = P[i];
      const o = obs[j];
      const r = Math.min(1, Math.max(0.08, 4 * o.mpp));
      p.kf = kfUpdate(p.kf!, o.p, r);
      p.lastObsT = t;
      p.lastPos = o.p;
      p.box = o.box;
      // Learn looks and height only when nobody else overlaps (no mixing two people).
      const clear = !interacting.has(i) && obs.every((q, k) => k === j || iou(q.box, o.box) < 0.1);
      if (clear) {
        p.look = blendLook(p.look, o.look, p.look ? 0.06 : 1);
        const h = heightOf(o);
        if (h) {
          p.heights.push(h);
          if (p.heights.length > 60) p.heights.shift();
          // Lower third: a raised racket arm makes the box (and the estimate) taller, never shorter.
          if (p.heights.length >= 8) p.height = quantile(p.heights, 0.33);
        }
      }
    });

    this.autoAssign(t, obs, assign);
    swaps.push(...this.handleInteractions(t, obs, assign));
    for (const p of P) if (p.kf) p.conf += (1 - p.conf) * 0.03;
    this.lastObs = obs;
    this.lastAssign = assign;
    return { assign, swaps };
  }

  /**
   * Before the game (and after someone is lost for good): picks players up on
   * their slots. With as many people as empty slots on a half, they are
   * ordered left to right as the camera sees them; with fewer (someone hidden
   * or out of shot), each goes to the side of the centre line they stand on.
   * Detections flicker (a far player can drop under the score cut for a few
   * frames), so evidence is kept per slot: the same spot (within 1.2 m) seen
   * 4 times, with gaps under a second, acquires that slot. Only people inside
   * the court lines (0.6 m margin) count, not spectators just off court.
   */
  private autoAssign(t: number, obs: PersonObs[], assign: (number | null)[]) {
    const refH = this.refHeight();
    for (const side of [0, 1] as const) {
      const waiting = this.players.map((p, i) => ({ p, i })).filter(({ p }) => p.slot.side === side && !p.kf);
      if (!waiting.length) continue;
      const taken = new Set(assign.filter((j): j is number => j !== null));
      const free = obs
        .map((o, j) => ({ o, j }))
        .filter(({ o, j }) => !taken.has(j) && o.score >= 0.3 && inPlay(o.p) && sideOf(o.p) === side && Math.abs(o.p.y - COURT.net) > NET_TOL && plausibleHeight(o, refH) && !o.edge)
        .sort((a, b) => a.o.box[0] + a.o.box[2] / 2 - (b.o.box[0] + b.o.box[2] / 2));
      if (!free.length) continue;
      if (free.length > waiting.length) {
        // More people than places: keep the most confident ones, still left to right.
        const keep = new Set([...free].sort((a, b) => b.o.score - a.o.score).slice(0, waiting.length).map((f) => f.j));
        for (let k = free.length - 1; k >= 0; k--) if (!keep.has(free[k].j)) free.splice(k, 1);
      }
      waiting.sort((a, b) => a.p.slot.lr - b.p.slot.lr);
      let pairs: { slot: (typeof waiting)[number]; obs: (typeof free)[number] }[];
      if (free.length === waiting.length) {
        pairs = waiting.map((w, k) => ({ slot: w, obs: free[k] }));
      } else {
        // Fewer people than empty slots: left or right of the centre line.
        pairs = [];
        const used = new Set<number>();
        for (const f of free) {
          const fx = f.o.box[0] + f.o.box[2] / 2;
          const lr = this.centreX ? (fx < this.centreX(f.o.p) ? 0 : 1) : f.o.p.x < COURT.width / 2 ? 0 : 1;
          // Someone standing near the centre line keeps the slot they were already building evidence for.
          let near: (typeof waiting)[number] | undefined;
          let best = 1.5;
          for (const x of waiting) {
            const c = this.autoCand[x.i];
            if (!c || used.has(x.i) || t - c.t > Math.max(1, 2.5 * this.detGap)) continue;
            const d = Math.hypot(c.p.x - f.o.p.x, c.p.y - f.o.p.y);
            if (d < best) [best, near] = [d, x];
          }
          const w = near ?? waiting.find((x) => x.p.slot.lr === lr && !used.has(x.i)) ?? waiting.find((x) => !used.has(x.i));
          if (!w) continue;
          used.add(w.i);
          pairs.push({ slot: w, obs: f });
        }
      }
      for (const { slot, obs: f } of pairs) {
        const c = this.autoCand[slot.i];
        // Slow detection (an older phone, or a desktop without a GPU) spaces the
        // looks out: allow for the walking a player can do in between.
        const gap = c ? t - c.t : 0;
        if (c && gap < Math.max(1, 2.5 * this.detGap) && Math.hypot(c.p.x - f.o.p.x, c.p.y - f.o.p.y) < 1.2 + 1.5 * Math.max(0, gap - 0.3)) {
          c.n++;
          c.t = t;
          c.p = f.o.p;
        } else {
          this.autoCand[slot.i] = { p: f.o.p, n: 1, t };
        }
        if (this.autoCand[slot.i]!.n < (this.detGap > 0.5 ? 3 : 4) || assign.includes(f.j)) continue;
        const p = slot.p;
        p.kf = kfInit(f.o.p);
        p.lastT = p.lastObsT = t;
        p.lastPos = f.o.p;
        p.look = f.o.look;
        p.box = f.o.box;
        p.conf = 0.8;
        assign[slot.i] = f.j;
        this.autoCand[slot.i] = null;
      }
    }
  }

  private handleInteractions(t: number, obs: PersonObs[], assign: (number | null)[]): SwapEvent[] {
    const P = this.players;
    const swaps: SwapEvent[] = [];
    const pos = (i: number): Pt | null => (P[i].kf ? { x: P[i].kf!.x[0], y: P[i].kf!.x[1] } : null);
    // Start interactions between partners who come close.
    for (let a = 0; a < P.length; a++) {
      for (let b = a + 1; b < P.length; b++) {
        if (P[a].slot.side !== P[b].slot.side) continue;
        const pa = pos(a), pb = pos(b);
        if (!pa || !pb) continue;
        const existing = this.interactions.find((it) => it.a === a && it.b === b);
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        const overlap = P[a].box && P[b].box ? iou(P[a].box!, P[b].box!) : 0;
        const hidden = (assign[a] === null) !== (assign[b] === null) && d < 1.6;
        const close = d < 1.0 || overlap > 0.2 || hidden;
        if (close && !existing) {
          this.interactions.push({
            a,
            b,
            start: t,
            phase: "close",
            pre: {
              look: [P[a].look, P[b].look],
              h: [P[a].height, P[b].height],
              pos: [pa, pb],
              vel: [
                { x: P[a].kf!.x[2], y: P[a].kf!.x[3] },
                { x: P[b].kf!.x[2], y: P[b].kf!.x[3] },
              ],
            },
            keep: 0,
            swap: 0,
            n: 0,
            sepT: 0,
          });
        } else if (existing && close && existing.phase === "resolving") {
          // Came together again before it was settled: keep collecting from the original meeting.
          existing.phase = "close";
          existing.keep = existing.swap = existing.n = 0;
        }
      }
    }
    // Collect evidence once apart, then decide.
    for (const it of [...this.interactions]) {
      const pa = pos(it.a), pb = pos(it.b);
      if (!pa || !pb) continue;
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const ja = assign[it.a], jb = assign[it.b];
      if (it.phase === "close") {
        if (d > 1.4 && ja !== null && jb !== null) {
          it.phase = "resolving";
          it.sepT = t;
        } else if (t - it.start > 8) {
          this.interactions = this.interactions.filter((x) => x !== it);
        }
        continue;
      }
      if (ja === null || jb === null) continue;
      const oa = obs[ja], ob = obs[jb];
      const ha = heightOf(oa), hb = heightOf(ob);
      const hCost = (h: number | null, ref: number) => (h && ref ? Math.min(3, Math.abs(Math.log(h / ref)) / 0.07) : 0);
      it.keep += W_APP * (lookDistance3(oa.look, it.pre.look[0]) + lookDistance3(ob.look, it.pre.look[1])) + hCost(ha, it.pre.h[0]) + hCost(hb, it.pre.h[1]);
      it.swap += W_APP * (lookDistance3(oa.look, it.pre.look[1]) + lookDistance3(ob.look, it.pre.look[0])) + hCost(ha, it.pre.h[1]) + hCost(hb, it.pre.h[0]);
      it.n++;
      if (t - it.sepT < 0.6 && it.n < 10) continue;
      // Where each was heading before they met (observation-centric momentum), at most 1.5 s on.
      const span = Math.min(1.5, it.sepT - it.start);
      const ext = (k: 0 | 1) => ({ x: it.pre.pos[k].x + it.pre.vel[k].x * span * 0.5, y: it.pre.pos[k].y + it.pre.vel[k].y * span * 0.5 });
      const ea = ext(0), eb = ext(1);
      const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
      const keepMom = dist(ea, pa) + dist(eb, pb);
      const swapMom = dist(ea, pb) + dist(eb, pa);
      const keep = it.keep / it.n + 0.4 * keepMom;
      const swap = it.swap / it.n + 0.4 * swapMom;
      const margin = Math.abs(keep - swap);
      const conf = 1 - Math.exp(-margin / 0.8);
      // Frame-to-frame tracking already kept them apart most of the time: overrule it only on
      // decisive evidence, the more so the more alike the two look (identical kit: height and
      // direction alone must be clearly better).
      const sep = lookDistance3(it.pre.look[0], it.pre.look[1]);
      const required = 0.6 + 2 * (1 - Math.min(1, sep / 0.15));
      if (swap + required < keep) {
        this.swapStates(it.a, it.b);
        // The assignments made since the meeting belong to the other player.
        [assign[it.a], assign[it.b]] = [assign[it.b], assign[it.a]];
        swaps.push({ a: it.a, b: it.b, from: it.start });
      }
      P[it.a].conf = P[it.b].conf = Math.min(P[it.a].conf, conf);
      this.interactions = this.interactions.filter((x) => x !== it);
    }
    return swaps;
  }
}
