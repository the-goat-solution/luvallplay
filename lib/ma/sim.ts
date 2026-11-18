// A doubles game simulator: the ground truth for testing the automatic
// Match Analyzer, and the preview "test scenario".
//
// It renders real pixels through a phone-camera model (pinhole + the same
// division lens model as lib/ma/lens.ts, so the 0.5× ultra-wide bends lines),
// with shake, dim light and sensor noise, so the engine's shuttle and swing
// detection run on the image exactly as they do on a camera feed. Physics:
// the shuttle has gravity and quadratic air drag (terminal speed 6.8 m/s);
// players accelerate to intercept it and swing their rackets through it.
// What it cannot simulate is the neural person detector: person boxes are
// produced from the true bodies with jitter, dropouts and merges instead.

import { COURT, courtLandmarks, solveHomography, invertMat3, type Box, type CourtTap, type Detection, type Pt } from "../match-analyzer.ts";
import { distort, makeLens, undistort, type CourtCamera, type LensPreset } from "./lens.ts";
import type { Onset } from "./audio.ts";

export type SimOptions = {
  seed?: number;
  w: number;
  h: number;
  fps?: number;
  lens?: LensPreset;
  /** 0.25 (dim hall) … 1 (good light). */
  light?: number;
  /** Sensor noise σ in grey levels. */
  noise?: number;
  /** Camera shake RMS in pixels (at this render size). */
  shake?: number;
  /** Partners wear the same shirts (and, with sameShorts, the same shorts). */
  sameShirts?: boolean;
  sameShorts?: boolean;
  /** Chance a player is missed by the person detector in a frame. */
  detectorMiss?: number;
  /** False impact sounds per second (neighbouring courts). */
  crowdNoise?: number;
  /** Long detector dropouts per player per minute (1–4 s each: a far player under the score cut, hidden by a partner). */
  dropouts?: number;
  /** Where the phone stands (see CAMERA_VIEWS). Default: behind the near baseline. */
  view?: CameraView;
  /** Exact camera position and aim point (court metres), overriding `view`. */
  camPos?: [number, number, number];
  camTarget?: [number, number, number];
};

/** Phone positions the engine must cope with (tripod, fence, chair, balcony). */
export type CameraView = "baseline" | "low" | "balcony" | "offcentre" | "side" | "corner";
export const CAMERA_VIEWS: CameraView[] = ["baseline", "low", "balcony", "offcentre", "side", "corner"];

/** Camera position and aim point per view and lens (1×: 69° wide, 0.5×: 108°), all keeping the whole court in shot. */
export function cameraPlacement(view: CameraView, lens: LensPreset): { pos: [number, number, number]; target: [number, number, number] } {
  const u = lens === "ultrawide";
  const centre: [number, number, number] = [3.05, 6.7, 0.3];
  switch (view) {
    case "low":
      return u ? { pos: [3.05, -2.8, 1.25], target: [3.05, 6.7, 0.6] } : { pos: [3.05, -6.8, 1.3], target: [3.05, 6.7, 0.6] };
    case "balcony":
      return u ? { pos: [3.05, -2.5, 6.5], target: [3.05, 5.6, 0] } : { pos: [3.05, -5.5, 7.5], target: [3.05, 5.4, 0] };
    case "offcentre":
      return u ? { pos: [-0.6, -2.6, 2.6], target: [3.4, 6.4, 0.2] } : { pos: [-1.2, -5.6, 3.0], target: [3.3, 6.4, 0.2] };
    case "side":
      return u ? { pos: [-4.3, 6.7, 2.6], target: centre } : { pos: [-10, 6.7, 3.6], target: centre };
    case "corner":
      return u ? { pos: [-2.4, -2.8, 2.8], target: centre } : { pos: [-5.2, -5.6, 3.6], target: centre };
    default:
      return u ? { pos: [3.05, -2.6, 2.6], target: [3.05, 6.2, 0.2] } : { pos: [3.05, -5.6, 3.0], target: [3.05, 6.2, 0.2] };
  }
}

export type SimTruth = { players: Pt[]; shuttle: [number, number, number] | null; rallyLive: boolean };
export type SimFrame = { t: number; rgba: Uint8ClampedArray; persons: Detection[]; onsets: Onset[]; truth: SimTruth };

type V3 = [number, number, number];
type Rgb = [number, number, number];

type SimPlayer = {
  team: 0 | 1;
  pos: Pt;
  vel: Pt;
  height: number;
  shirt: Rgb;
  shorts: Rgb;
  skin: Rgb;
  hair: Rgb;
  shoes: Rgb;
  base: Pt;
  target: Pt;
  /** Planned racket contact: time and point. */
  swing: { t: number; at: V3; back: V3; follow: V3 } | null;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const G = 9.81;
const VT = 6.8; // shuttle terminal velocity, m/s
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** One physics step of the shuttle (gravity + quadratic drag). */
function shuttleStep(p: V3, v: V3, dt: number): [V3, V3] {
  const sp = Math.hypot(v[0], v[1], v[2]);
  const k = G / (VT * VT);
  const a: V3 = [-k * sp * v[0], -k * sp * v[1], -G - k * sp * v[2]];
  const nv: V3 = [v[0] + a[0] * dt, v[1] + a[1] * dt, v[2] + a[2] * dt];
  return [[p[0] + nv[0] * dt, p[1] + nv[1] * dt, p[2] + nv[2] * dt], nv];
}

/** Flies a shot until it reaches height z (descending) or the floor. */
function flyUntil(p0: V3, v0: V3, stop: (p: V3, v: V3, t: number) => boolean, maxT = 6): { t: number; p: V3; v: V3; path: { t: number; p: V3 }[] } {
  let p = p0, v = v0, t = 0;
  const dt = 1 / 240;
  const path: { t: number; p: V3 }[] = [{ t: 0, p }];
  while (t < maxT) {
    [p, v] = shuttleStep(p, v, dt);
    t += dt;
    path.push({ t, p });
    if (p[2] <= 0 || stop(p, v, t)) break;
  }
  return { t, p, v, path };
}

/** Initial velocity that sends the shuttle from p0 to land at the ground point g with a given launch angle. */
function aim(p0: V3, g: Pt, angleDeg: number): V3 {
  const dx = g.x - p0[0], dy = g.y - p0[1];
  const dist = Math.hypot(dx, dy);
  const dir = [dx / dist, dy / dist];
  const ang = (angleDeg * Math.PI) / 180;
  let lo = 3, hi = 90;
  for (let i = 0; i < 28; i++) {
    const s = (lo + hi) / 2;
    const v: V3 = [dir[0] * Math.cos(ang) * s, dir[1] * Math.cos(ang) * s, Math.sin(ang) * s];
    const r = flyUntil(p0, v, () => false);
    const d = Math.hypot(r.p[0] - p0[0], r.p[1] - p0[1]);
    if (d < dist) lo = s;
    else hi = s;
  }
  const s = (lo + hi) / 2;
  return [dir[0] * Math.cos(ang) * s, dir[1] * Math.cos(ang) * s, Math.sin(ang) * s];
}

export class MatchSim {
  readonly W: number;
  readonly H: number;
  readonly fps: number;
  readonly opts: Required<Omit<SimOptions, "seed" | "w" | "h" | "fps" | "lens" | "view" | "camPos" | "camTarget">> & { lens: LensPreset; view: CameraView };
  /** The true court camera (for tests that skip tapping). */
  readonly cam: CourtCamera;
  readonly players: SimPlayer[];
  /** Every real hit so far (ground truth). */
  readonly hits: { t: number; player: number }[] = [];
  t = 0;
  private rand: () => number;
  private C: V3;
  private R: V3;
  private U: V3;
  private F: V3;
  private fpx: number;
  private lensL: ReturnType<typeof makeLens>;
  private staticLayer: Uint8ClampedArray;
  private buf: Uint8ClampedArray;
  private noiseTable: Float32Array;
  private shakeX = 0;
  private shakeY = 0;
  private shuttle: { p: V3; v: V3 } | null = null;
  private prevShuttleImg: Pt | null = null;
  private rallyLive = false;
  private nextServe = 1.0;
  private serveTeam: 0 | 1 = 0;
  private shotsLeft = 0;
  private pendingHit: { t: number; player: number; at: V3 } | null = null;
  private lastHitter = -1;
  private onsetQueue: Onset[] = [];
  private dropUntil = [0, 0, 0, 0];
  private spectators: { pos: Pt; color: Rgb; seated: boolean; walk?: { from: Pt; to: Pt; speed: number } }[] = [];

  constructor(o: SimOptions) {
    this.W = o.w;
    this.H = o.h;
    this.fps = o.fps ?? 30;
    this.opts = {
      lens: o.lens ?? "wide",
      light: o.light ?? 1,
      noise: o.noise ?? 2,
      shake: o.shake ?? 0,
      sameShirts: o.sameShirts ?? true,
      sameShorts: o.sameShorts ?? false,
      detectorMiss: o.detectorMiss ?? 0.04,
      crowdNoise: o.crowdNoise ?? 0.3,
      dropouts: o.dropouts ?? 0,
      view: o.view ?? "baseline",
    };
    this.rand = mulberry32(o.seed ?? 7);
    // Camera: a phone on a tripod, fence, chair or balcony (default: behind the near baseline).
    const ultra = this.opts.lens === "ultrawide";
    const place = cameraPlacement(this.opts.view, this.opts.lens);
    this.C = o.camPos ?? place.pos;
    const target: V3 = o.camTarget ?? place.target;
    const hfov = ((ultra ? 108 : 69) * Math.PI) / 180;
    this.F = norm(sub(target, this.C));
    this.R = norm(cross(this.F, [0, 0, 1]));
    this.U = cross(this.R, this.F);
    this.fpx = this.W / 2 / Math.tan(hfov / 2);
    this.lensL = makeLens(this.W, this.H, ultra ? -0.18 : 0);
    // Ground-truth floor homography (pinhole part), plus the lens.
    const corners: Pt[] = [{ x: 0, y: 0 }, { x: COURT.width, y: 0 }, { x: COURT.width, y: COURT.length }, { x: 0, y: COURT.length }];
    const und = corners.map((c) => this.pinhole([c.x, c.y, 0])!);
    const toImage = solveHomography(corners, und)!;
    this.cam = { lens: this.lensL, toImage, toCourt: invertMat3(toImage)!, rms: 0, shift: { x: 0, y: 0 } };

    const r = this.rand;
    const shirtA: Rgb = [235, 90, 70];
    const shirtB: Rgb = [40, 40, 48];
    const pick = (k: number): Rgb => [[40, 70, 160], [230, 230, 235], [30, 30, 30], [150, 30, 40]][k] as Rgb;
    const mk = (team: 0 | 1, k: 0 | 1): SimPlayer => {
      const base = { x: k === 0 ? 1.6 : 4.5, y: team === 0 ? 3.0 : 10.4 };
      const sameShirt = this.opts.sameShirts;
      const shirt = team === 0 ? (sameShirt || k === 0 ? shirtA : ([250, 200, 60] as Rgb)) : sameShirt || k === 0 ? shirtB : ([60, 160, 220] as Rgb);
      const shorts = this.opts.sameShorts ? pick(2) : pick(team * 2 + k);
      return {
        team,
        pos: { ...base },
        vel: { x: 0, y: 0 },
        height: k === 0 ? 1.68 + r() * 0.04 : 1.8 + r() * 0.05,
        shirt,
        shorts,
        skin: [196 - k * 30, 150 - k * 25, 120 - k * 20],
        hair: [25, 20, 18],
        shoes: k === 0 ? [240, 240, 240] : [40, 40, 40],
        base,
        target: { ...base },
        swing: null,
      };
    };
    this.players = [mk(0, 0), mk(0, 1), mk(1, 0), mk(1, 1)];
    for (let i = 0; i < 9; i++) {
      this.spectators.push({ pos: { x: -2 + i * 1.2, y: 15.6 + (i % 2) * 0.4 }, color: [80 + r() * 150, 80 + r() * 150, 80 + r() * 150], seated: true });
    }
    this.spectators.push({ pos: { x: -2.4, y: 2 }, color: [200, 120, 60], seated: false, walk: { from: { x: -2.4, y: 1 }, to: { x: -2.4, y: 12 }, speed: 0.6 } });
    this.staticLayer = new Uint8ClampedArray(this.W * this.H * 4);
    this.buf = new Uint8ClampedArray(this.W * this.H * 4);
    this.noiseTable = new Float32Array(1 << 16);
    for (let i = 0; i < this.noiseTable.length; i++) this.noiseTable[i] = (r() + r() + r() - 1.5) * 2;
    this.renderStatic();
  }

  // ── Camera ────────────────────────────────────────────────────────────

  private pinhole(P: V3): Pt | null {
    const d = sub(P, this.C);
    const zc = dot(d, this.F);
    if (zc < 0.2) return null;
    return { x: this.W / 2 + (this.fpx * dot(d, this.R)) / zc, y: this.H / 2 - (this.fpx * dot(d, this.U)) / zc };
  }

  /** World point → image pixel (lens and shake included). */
  project(P: V3, withShake = true): Pt | null {
    const q = this.pinhole(P);
    if (!q) return null;
    const d = distort(this.lensL, q);
    return withShake ? { x: d.x + this.shakeX, y: d.y + this.shakeY } : d;
  }

  private depth(P: V3) {
    return Math.max(0.2, dot(sub(P, this.C), this.F));
  }

  /** What a careful assistant would tap: visible court points, ±1.5 px. */
  taps(count = 6): CourtTap[] {
    const want = ["0,0", "6.1,0", "6.1,13.4", "0,13.4", "3.05,4.72", "3.05,8.68", "0,6.7", "6.1,6.7", "0.46,0.76", "5.64,12.64"];
    const lms = courtLandmarks();
    const out: CourtTap[] = [];
    for (const id of want) {
      const lm = lms.find((l) => l.id === id);
      if (!lm) continue;
      const q = this.project([lm.p.x, lm.p.y, 0], false);
      if (!q || q.x < 4 || q.y < 4 || q.x > this.W - 4 || q.y > this.H - 4) continue;
      out.push({ court: lm.p, image: { x: q.x + (this.rand() - 0.5) * 3, y: q.y + (this.rand() - 0.5) * 3 } });
      if (out.length >= count) break;
    }
    return out;
  }

  // ── Rasterising ───────────────────────────────────────────────────────

  private fillPoly(buf: Uint8ClampedArray, pts: Pt[], c: Rgb, alpha = 1) {
    if (pts.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const y0 = Math.max(0, Math.ceil(minY));
    const y1 = Math.min(this.H - 1, Math.floor(maxY));
    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]));
        const xb = Math.min(this.W - 1, Math.floor(xs[k + 1]));
        for (let x = xa; x <= xb; x++) this.put(buf, x, y, c, alpha);
      }
    }
  }

  private put(buf: Uint8ClampedArray, x: number, y: number, c: Rgb, alpha: number) {
    const i = (y * this.W + x) * 4;
    if (alpha >= 1) {
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    } else {
      buf[i] += (c[0] - buf[i]) * alpha;
      buf[i + 1] += (c[1] - buf[i + 1]) * alpha;
      buf[i + 2] += (c[2] - buf[i + 2]) * alpha;
    }
    buf[i + 3] = 255;
  }

  private line(buf: Uint8ClampedArray, a: Pt, b: Pt, width: number, c: Rgb, alpha = 1) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    const w = Math.max(0.6, width) / 2;
    if (l < 0.01) return this.disc(buf, a, w, c, alpha);
    const nx = (-dy / l) * w, ny = (dx / l) * w;
    this.fillPoly(buf, [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }], c, alpha);
  }

  private disc(buf: Uint8ClampedArray, p: Pt, r: number, c: Rgb, alpha = 1) {
    const rr = Math.max(0.5, r);
    for (let y = Math.max(0, Math.floor(p.y - rr)); y <= Math.min(this.H - 1, Math.ceil(p.y + rr)); y++) {
      for (let x = Math.max(0, Math.floor(p.x - rr)); x <= Math.min(this.W - 1, Math.ceil(p.x + rr)); x++) {
        if ((x - p.x) ** 2 + (y - p.y) ** 2 <= rr * rr + 0.25) this.put(buf, x, y, c, alpha);
      }
    }
  }

  /** A 3D segment drawn with a width in metres. */
  private seg3(buf: Uint8ClampedArray, a: V3, b: V3, widthM: number, c: Rgb, alpha = 1, shake = true) {
    const pa = this.project(a, shake), pb = this.project(b, shake);
    if (!pa || !pb) return;
    const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    this.line(buf, pa, pb, (widthM * this.fpx) / this.depth(mid), c, alpha);
  }

  private quad3(buf: Uint8ClampedArray, pts: V3[], c: Rgb, alpha = 1, shake = true, steps = 1) {
    // Subdivide edges so the lens can bend them.
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      for (let s = 0; s < steps; s++) {
        const f = s / steps;
        const q = this.project([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], shake);
        if (q) out.push(q);
      }
    }
    this.fillPoly(buf, out, c, alpha);
  }

  /** Unit vector across a person as the camera sees them (their billboard's width direction, on the floor). */
  private across(pos: Pt): [number, number] {
    const dx = pos.x - this.C[0], dy = pos.y - this.C[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l];
  }

  private renderStatic() {
    const b = this.staticLayer;
    // Each pixel's ray: the hall floor where it meets it, walls (blue with a lighter band) elsewhere.
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const u = undistort(this.lensL, { x, y });
        const a = (u.x - this.W / 2) / this.fpx, c = -(u.y - this.H / 2) / this.fpx;
        const d: V3 = [this.F[0] + a * this.R[0] + c * this.U[0], this.F[1] + a * this.R[1] + c * this.U[1], this.F[2] + a * this.R[2] + c * this.U[2]];
        let col: Rgb | null = null;
        if (d[2] < -1e-6) {
          const k = -this.C[2] / d[2];
          const gx = this.C[0] + d[0] * k, gy = this.C[1] + d[1] * k;
          if (gx > -12 && gx < 18 && gy > -12 && gy < 22) col = [38, 105, 82];
        }
        if (!col) {
          const f = y / this.H;
          col = [40 + 60 * f, 90 + 60 * f, 150 + 50 * f];
        }
        this.put(b, x, y, col, 1);
      }
    }
    this.quad3(b, [[0, 0, 0], [COURT.width, 0, 0], [COURT.width, COURT.length, 0], [0, COURT.length, 0]], [44, 128, 98], 1, false, 16);
    const lines: [Pt, Pt][] = [];
    const { width: W, length: L, net, singlesInset: si, shortService: ss, longServiceDoubles: ld } = COURT;
    const h = (y: number, x0 = 0, x1: number = W): [Pt, Pt] => [{ x: x0, y }, { x: x1, y }];
    const v = (x: number, y0 = 0, y1: number = L): [Pt, Pt] => [{ x, y: y0 }, { x, y: y1 }];
    lines.push(h(0), h(L), v(0), v(W), v(si), v(W - si), h(ld), h(L - ld), h(net - ss), h(net + ss), v(W / 2, 0, net - ss), v(W / 2, net + ss, L));
    for (const [a, c] of lines) {
      const n = 24;
      for (let i = 0; i < n; i++) {
        const f0 = i / n, f1 = (i + 1) / n;
        this.seg3(b, [a.x + (c.x - a.x) * f0, a.y + (c.y - a.y) * f0, 0], [a.x + (c.x - a.x) * f1, a.y + (c.y - a.y) * f1, 0], 0.045, [235, 240, 238], 1, false);
      }
    }
    // Net: posts, mesh and tape.
    this.seg3(b, [0, net, 0], [0, net, 1.55], 0.05, [30, 30, 30], 1, false);
    this.seg3(b, [W, net, 0], [W, net, 1.55], 0.05, [30, 30, 30], 1, false);
    this.quad3(b, [[0, net, 0.8], [W, net, 0.8], [W, net, 1.52], [0, net, 1.52]], [20, 20, 25], 0.35, false, 8);
    this.seg3(b, [0, net, 1.53], [W, net, 1.53], 0.05, [245, 245, 245], 1, false);
    for (const s of this.spectators.filter((x) => x.seated)) this.drawPerson(b, { x: s.pos.x, y: s.pos.y }, 1.2, s.color, [50, 50, 60], [200, 160, 130], [20, 20, 20], [60, 60, 60], null, false);
  }

  private drawPerson(buf: Uint8ClampedArray, pos: Pt, height: number, shirt: Rgb, shorts: Rgb, skin: Rgb, hair: Rgb, shoes: Rgb, racket: { head: V3; hand: V3 } | null, shake = true) {
    const H = height;
    // Drawn as a billboard facing the camera: a = across (as seen), b = towards the camera.
    const [ax, ay] = this.across(pos);
    const bx = -ay, by = ax;
    const P = (a: number, z: number, b = 0): V3 => [pos.x + ax * a - bx * b, pos.y + ay * a - by * b, z];
    const lat = 0.13;
    // Legs and shoes.
    for (const s of [-1, 1]) {
      this.seg3(buf, P(s * lat, 0.08), P(s * 0.09, H * 0.5), 0.13, skin, 1, shake);
      this.seg3(buf, P(s * lat - 0.03, 0.03), P(s * lat + 0.05, 0.03, 0.04), 0.11, shoes, 1, shake);
    }
    // Shorts, shirt, head.
    this.quad3(buf, [P(-0.19, H * 0.44), P(0.19, H * 0.44), P(0.2, H * 0.57), P(-0.2, H * 0.57)], shorts, 1, shake);
    this.quad3(buf, [P(-0.21, H * 0.55), P(0.21, H * 0.55), P(0.24, H * 0.82), P(-0.24, H * 0.82)], shirt, 1, shake);
    const head = this.project(P(0, H * 0.91), shake);
    if (head) {
      const r = (0.105 * this.fpx) / this.depth(P(0, H * 0.91));
      this.disc(buf, head, r, skin, 1);
      this.disc(buf, { x: head.x, y: head.y - r * 0.35 }, r * 0.8, hair, 1);
    }
    // Non-racket arm resting, racket arm (from the right shoulder in court space) to the hand, then the racket.
    this.seg3(buf, P(-0.23, H * 0.8), P(-0.3, H * 0.55, 0.05), 0.08, skin, 1, shake);
    if (racket) {
      this.seg3(buf, [pos.x + 0.23, pos.y, H * 0.8], racket.hand, 0.08, skin, 1, shake);
      this.seg3(buf, racket.hand, racket.head, 0.025, [60, 60, 60], 1, shake);
      const hp = this.project(racket.head, shake);
      if (hp) this.disc(buf, hp, (0.11 * this.fpx) / this.depth(racket.head), [210, 210, 210], 0.85);
    }
  }

  // ── Game logic ────────────────────────────────────────────────────────

  private reachOf(p: SimPlayer): V3 {
    return [p.pos.x + 0.35, p.pos.y + (p.team === 0 ? 0.25 : -0.25), p.height + 0.35];
  }

  private startShot(from: V3, team: 0 | 1, hitHeight: number) {
    // Aim at the other half.
    const r = this.rand;
    const otherFar = team === 0;
    const kind = hitHeight > 2.1 ? (r() < 0.45 ? "smash" : r() < 0.6 ? "clear" : "drop") : hitHeight > 1.2 ? (r() < 0.5 ? "drive" : "clear") : r() < 0.5 ? "lift" : "net";
    const depth = kind === "net" || kind === "drop" ? 1.2 + r() * 1.3 : kind === "smash" || kind === "drive" ? 3 + r() * 2.5 : 4.8 + r() * 1.6;
    const target = { x: 0.6 + r() * 4.9, y: otherFar ? COURT.net + depth : COURT.net - depth };
    const angle = { smash: -12, drive: 4, clear: 38, drop: 18, lift: 48, net: 30 }[kind];
    let v = aim(from, target, angle);
    // Make sure it clears the net (1.55 m) with a margin.
    for (let tries = 0; tries < 6; tries++) {
      const r2 = flyUntil(from, v, (p) => (otherFar ? p[1] >= COURT.net : p[1] <= COURT.net));
      if (r2.p[2] > 1.62) break;
      v = aim(from, target, angle + 8 * (tries + 1));
    }
    this.shuttle = { p: from, v };
    this.planInterception(team === 0 ? 1 : 0, kind);
  }

  /** Finds where the receiving team will meet the shuttle; schedules that hit (or nobody, ending the rally). */
  private planInterception(team: 0 | 1, kind: string) {
    this.pendingHit = null;
    if (!this.shuttle || this.shotsLeft <= 0) return;
    const r = this.rand;
    const hitH = kind === "net" || kind === "drop" ? 0.6 + r() * 0.6 : kind === "clear" || kind === "lift" ? 1.8 + r() * 0.9 : 1.0 + r() * 0.8;
    // Players need ~0.35 s to react; the contact comes after that, once it drops to hitting height.
    const fl = flyUntil(this.shuttle.p, this.shuttle.v, (p, v, t) => t > 0.35 && (team === 1 ? p[1] > COURT.net + 0.3 : p[1] < COURT.net - 0.3) && v[2] < 0 && p[2] <= hitH);
    if (fl.p[2] <= 0) return;
    const at = fl.p;
    const cands = this.players.map((p, i) => ({ p, i })).filter(({ p }) => p.team === team);
    let best = cands[0];
    let bestD = Infinity;
    for (const c of cands) {
      const d = Math.hypot(c.p.pos.x - at[0], c.p.pos.y - at[1]);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (bestD - 0.9 > 5.2 * fl.t) return; // can't get there: the shuttle lands
    const t = this.t + fl.t;
    this.pendingHit = { t, player: best.i, at };
    const pl = best.p;
    pl.target = { x: at[0] - 0.35, y: at[1] - (team === 0 ? 0.25 : -0.25) };
    const dirY = team === 0 ? 1 : -1;
    pl.swing = {
      t,
      at,
      back: [at[0] + 0.25, at[1] - dirY * 0.5, at[2] + 0.35],
      follow: [at[0] - 0.35, at[1] + dirY * 0.35, at[2] - 0.6],
    };
    // Partner covers the other side of their half.
    for (const c of cands) if (c.i !== best.i) c.p.target = { x: at[0] < 3.05 ? 4.3 : 1.8, y: c.p.base.y };
  }

  private serveAt: { t: number; player: number; from: V3 } | null = null;
  private nextServer: SimPlayer | null = null;

  /** After a rally: the next server walks to the service line. */
  private chooseServer() {
    const team = this.serveTeam;
    const server = this.players.filter((p) => p.team === team)[this.rand() < 0.5 ? 0 : 1];
    server.target = { x: server.base.x < 3.05 ? 2.5 : 3.6, y: team === 0 ? 4.4 : 9.0 };
    this.nextServer = server;
  }

  /** Server takes position and starts the swing; the shuttle leaves the racket 0.3 s later. */
  private prepareServe() {
    const r = this.rand;
    const team = this.serveTeam;
    this.serveTeam = team === 0 ? 1 : 0;
    const server = this.nextServer ?? this.players.filter((p) => p.team === team)[r() < 0.5 ? 0 : 1];
    this.nextServer = null;
    const sIdx = this.players.indexOf(server);
    server.target = { ...server.pos };
    const from: V3 = [server.pos.x + 0.3, server.pos.y + (team === 0 ? 0.3 : -0.3), 1.05];
    const dirY = team === 0 ? 1 : -1;
    const t = this.t + 0.3;
    server.swing = { t, at: from, back: [from[0] + 0.2, from[1] - dirY * 0.4, from[2] - 0.3], follow: [from[0] - 0.2, from[1] + dirY * 0.3, from[2] + 0.5] };
    this.serveAt = { t, player: sIdx, from };
    this.shotsLeft = 3 + Math.floor(r() * 14);
    this.rallyLive = true;
  }

  private serve() {
    const s = this.serveAt!;
    this.serveAt = null;
    this.recordHit(s.player, s.from);
    this.startShot(s.from, this.players[s.player].team, 1.0);
  }

  private recordHit(player: number, at: V3) {
    this.hits.push({ t: this.t, player });
    this.lastHitter = player;
    this.shotsLeft--;
    const jitter = (this.rand() - 0.5) * 0.024;
    this.onsetQueue.push({ t: this.t + jitter, strength: 0.55 + this.rand() * 0.45 });
    const p = this.players[player];
    if (!p.swing || Math.abs(p.swing.t - this.t) > 0.1) {
      const dirY = p.team === 0 ? 1 : -1;
      p.swing = { t: this.t, at, back: [at[0] + 0.25, at[1] - dirY * 0.5, at[2] + 0.35], follow: [at[0] - 0.35, at[1] + dirY * 0.35, at[2] - 0.6] };
    }
  }

  /** Advances one frame and renders it. */
  step(): SimFrame {
    const dt = 1 / this.fps;
    const r = this.rand;
    this.t += dt;
    // Shuttle physics (sub-stepped) and scheduled hits.
    if (this.shuttle) {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const tNow = this.t - dt + ((i + 1) * dt) / n;
        if (this.pendingHit && tNow >= this.pendingHit.t) {
          const h = this.pendingHit;
          this.recordHit(h.player, this.shuttle.p);
          const hitter = this.players[h.player];
          this.startShot(this.shuttle.p, hitter.team, this.shuttle.p[2]);
          continue;
        }
        [this.shuttle.p, this.shuttle.v] = shuttleStep(this.shuttle.p, this.shuttle.v, dt / n);
        if (this.shuttle.p[2] <= 0) {
          this.shuttle = null;
          this.pendingHit = null;
          this.rallyLive = false;
          this.nextServe = this.t + 2.5 + r() * 2;
          for (const p of this.players) p.target = { ...p.base };
          this.chooseServer();
          break;
        }
      }
    } else if (this.serveAt && this.t >= this.serveAt.t) {
      this.serve();
    } else if (!this.serveAt && this.t >= this.nextServe) {
      if (!this.nextServer) this.chooseServer();
      const sv = this.nextServer!;
      if (Math.hypot(sv.pos.x - sv.target.x, sv.pos.y - sv.target.y) < 0.15 || this.t > this.nextServe + 3) this.prepareServe();
    }
    // Players move toward their targets (acceleration- and speed-limited).
    for (const p of this.players) {
      const dx = p.target.x - p.pos.x, dy = p.target.y - p.pos.y;
      const d = Math.hypot(dx, dy);
      const want = d > 0.05 ? Math.min(5, d * 3) : 0;
      const wx = d > 0 ? (dx / d) * want : 0, wy = d > 0 ? (dy / d) * want : 0;
      const ax = Math.max(-9, Math.min(9, (wx - p.vel.x) / 0.15));
      const ay = Math.max(-9, Math.min(9, (wy - p.vel.y) / 0.15));
      p.vel.x += ax * dt;
      p.vel.y += ay * dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      // Never through the net.
      if (p.team === 0) p.pos.y = Math.min(COURT.net - 0.25, p.pos.y);
      else p.pos.y = Math.max(COURT.net + 0.25, p.pos.y);
      if (!this.rallyLive && d < 0.3 && r() < 0.01) p.target = { x: p.base.x + (r() - 0.5) * 1.2, y: p.base.y + (r() - 0.5) * 1.2 };
    }
    for (const s of this.spectators) {
      if (!s.walk) continue;
      const dirY = Math.sign(s.walk.to.y - s.pos.y) || 1;
      s.pos.y += dirY * s.walk.speed * dt;
      if (Math.abs(s.pos.y - s.walk.to.y) < 0.1) [s.walk.from, s.walk.to] = [s.walk.to, s.walk.from];
    }
    // Camera shake: a smooth random wobble.
    const sh = this.opts.shake;
    this.shakeX = this.shakeX * 0.85 + (r() - 0.5) * sh * 1.1;
    this.shakeY = this.shakeY * 0.85 + (r() - 0.5) * sh * 1.1;

    const rgba = this.render();
    const persons = this.detections();
    const onsets = this.onsetQueue.filter((o) => o.t <= this.t);
    this.onsetQueue = this.onsetQueue.filter((o) => o.t > this.t);
    if (r() < this.opts.crowdNoise * dt) onsets.push({ t: this.t - r() * dt, strength: 0.2 + r() * 0.6 });
    return {
      t: this.t,
      rgba,
      persons,
      onsets,
      truth: { players: this.players.map((p) => ({ ...p.pos })), shuttle: this.shuttle ? [...this.shuttle.p] : null, rallyLive: this.rallyLive },
    };
  }

  private racketFor(p: SimPlayer): { head: V3; hand: V3 } {
    const rest: V3 = [p.pos.x + 0.42, p.pos.y + (p.team === 0 ? 0.2 : -0.2), p.height * 0.95];
    let head = rest;
    const s = p.swing;
    if (s) {
      const t0 = s.t - 0.22, t1 = s.t + 0.15;
      if (this.t >= t0 && this.t <= t1) {
        // Back → contact → follow-through (quadratic Bézier through the contact point at s.t).
        const u = this.t <= s.t ? ((this.t - t0) / (s.t - t0)) * 0.5 : 0.5 + ((this.t - s.t) / (t1 - s.t)) * 0.5;
        const ctrl: V3 = [2 * s.at[0] - (s.back[0] + s.follow[0]) / 2, 2 * s.at[1] - (s.back[1] + s.follow[1]) / 2, 2 * s.at[2] - (s.back[2] + s.follow[2]) / 2];
        const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
        head = [a * s.back[0] + b * ctrl[0] + c * s.follow[0], a * s.back[1] + b * ctrl[1] + c * s.follow[1], a * s.back[2] + b * ctrl[2] + c * s.follow[2]];
      } else if (this.t > t1) p.swing = null;
    }
    const sh: V3 = [p.pos.x + 0.23, p.pos.y, p.height * 0.8];
    const dir = norm(sub(head, sh));
    const reach = Math.min(0.62, Math.hypot(head[0] - sh[0], head[1] - sh[1], head[2] - sh[2]));
    const hand: V3 = [sh[0] + dir[0] * reach * 0.55, sh[1] + dir[1] * reach * 0.55, sh[2] + dir[2] * reach * 0.55];
    return { head, hand };
  }

  private render(): Uint8ClampedArray {
    const W = this.W, H = this.H;
    const b = this.buf;
    // Static layer, shifted by the integer part of the shake.
    const sx = Math.round(this.shakeX), sy = Math.round(this.shakeY);
    for (let y = 0; y < H; y++) {
      const ys = Math.min(H - 1, Math.max(0, y - sy));
      const row = y * W * 4, rowS = ys * W * 4;
      for (let x = 0; x < W; x++) {
        const xs = Math.min(W - 1, Math.max(0, x - sx)) * 4;
        const i = row + x * 4;
        b[i] = this.staticLayer[rowS + xs];
        b[i + 1] = this.staticLayer[rowS + xs + 1];
        b[i + 2] = this.staticLayer[rowS + xs + 2];
        b[i + 3] = 255;
      }
    }
    for (const s of this.spectators.filter((x) => !x.seated)) this.drawPerson(b, s.pos, 1.7, s.color, [40, 40, 40], [200, 160, 130], [20, 20, 20], [50, 50, 50], null);
    // Players far to near (painter's order, by distance from the camera).
    const dist = (q: Pt) => Math.hypot(q.x - this.C[0], q.y - this.C[1]);
    const order = this.players.map((p, i) => ({ p, i })).sort((a, c) => dist(c.p.pos) - dist(a.p.pos));
    const drawShuttle = () => {
      if (!this.shuttle) {
        this.prevShuttleImg = null;
        return;
      }
      const q = this.project(this.shuttle.p);
      if (!q) return;
      const rad = Math.max(0.7, (0.035 * this.fpx) / this.depth(this.shuttle.p));
      if (this.prevShuttleImg) this.line(b, this.prevShuttleImg, q, rad * 1.8, [250, 250, 245], 0.75);
      this.disc(b, q, rad, [255, 255, 250], 1);
      this.prevShuttleImg = q;
    };
    let shuttleDrawn = false;
    for (const { p } of order) {
      if (!shuttleDrawn && this.shuttle && dist({ x: this.shuttle.p[0], y: this.shuttle.p[1] }) > dist(p.pos)) {
        drawShuttle();
        shuttleDrawn = true;
      }
      this.drawPerson(b, p.pos, p.height, p.shirt, p.shorts, p.skin, p.hair, p.shoes, this.racketFor(p));
    }
    if (!shuttleDrawn) drawShuttle();
    // Light, flicker and sensor noise.
    const light = this.opts.light * (1 + 0.02 * Math.sin(this.t * 2 * Math.PI * 3.3));
    const sigma = this.opts.noise;
    const tab = this.noiseTable;
    let k = Math.floor(this.rand() * tab.length);
    for (let i = 0; i < b.length; i += 4) {
      const n = sigma * tab[k++ & 0xffff];
      b[i] = b[i] * light + n;
      b[i + 1] = b[i + 1] * light + n;
      b[i + 2] = b[i + 2] * light + n;
    }
    return b;
  }

  /** Person boxes as a detector would report them (jitter, misses, merged partners). */
  private detections(): Detection[] {
    const r = this.rand;
    const out: Detection[] = [];
    const boxes = this.players.map((p) => {
      const pts: Pt[] = [];
      const [ax, ay] = this.across(p.pos);
      const at = (a: number, z: number): V3 => [p.pos.x + ax * a, p.pos.y + ay * a, z];
      for (const P of [at(-0.25, 0), at(0.25, 0), at(0, p.height + 0.03), at(-0.3, p.height * 0.8), at(0.3, p.height * 0.8), [p.pos.x + 0.23, p.pos.y, p.height * 0.8]] as V3[]) {
        const q = this.project(P);
        if (q) pts.push(q);
      }
      const rk = this.racketFor(p).hand;
      const qh = this.project(rk);
      if (qh) pts.push(qh);
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const box: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      return box;
    });
    const used = new Set<number>();
    boxes.forEach((box, i) => {
      if (used.has(i)) return;
      const p = this.players[i];
      const miss = this.opts.detectorMiss + (1 - this.opts.light) * 0.12;
      if (this.opts.dropouts > 0 && this.t >= this.dropUntil[i] && r() < (this.opts.dropouts / 60) * (2 / this.fps)) this.dropUntil[i] = this.t + 1 + r() * 3;
      if (this.t < this.dropUntil[i]) return;
      if (r() < miss) return;
      // Two partners overlapping heavily are sometimes reported as one person.
      for (let j = i + 1; j < boxes.length; j++) {
        if (this.players[j].team !== p.team || used.has(j)) continue;
        const a = boxes[i], c = boxes[j];
        const ix = Math.max(0, Math.min(a[0] + a[2], c[0] + c[2]) - Math.max(a[0], c[0]));
        const iy = Math.max(0, Math.min(a[1] + a[3], c[1] + c[3]) - Math.max(a[1], c[1]));
        const inter = ix * iy;
        const iou = inter / (a[2] * a[3] + c[2] * c[3] - inter);
        if (iou > 0.45 && r() < 0.6) {
          used.add(j);
          const x0 = Math.min(a[0], c[0]), y0 = Math.min(a[1], c[1]);
          box[0] = x0;
          box[1] = y0;
          box[2] = Math.max(a[0] + a[2], c[0] + c[2]) - x0;
          box[3] = Math.max(a[1] + a[3], c[1] + c[3]) - y0;
        }
      }
      const j = (s: number) => (r() - 0.5) * 2 * s;
      const hh = box[3];
      const dist = Math.hypot(p.pos.x - this.C[0], p.pos.y - this.C[1]);
      out.push({
        box: [box[0] + j(hh * 0.02), box[1] + j(hh * 0.025), box[2] * (1 + j(0.05)), box[3] * (1 + j(0.03))],
        score: Math.max(0.3, (0.97 - dist * 0.012) * (0.75 + 0.25 * this.opts.light) - r() * 0.08),
      });
    });
    // Spectators get detected too (off court: the engine has to ignore them).
    for (const s of this.spectators) {
      if (r() < 0.3) continue;
      const [ax, ay] = this.across(s.pos);
      const a = this.project([s.pos.x - 0.25 * ax, s.pos.y - 0.25 * ay, 0]);
      const c = this.project([s.pos.x + 0.25 * ax, s.pos.y + 0.25 * ay, s.seated ? 1.2 : 1.7]);
      if (!a || !c) continue;
      out.push({ box: [Math.min(a.x, c.x), Math.min(a.y, c.y), Math.abs(c.x - a.x), Math.abs(c.y - a.y)], score: 0.3 + r() * 0.2 });
    }
    return out;
  }
}
