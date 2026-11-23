// 3D shuttle flights from one camera (the idea behind MonoTrack, Liu & Wang
// 2022, simplified for a phone). A flat image cannot tell a near player's
// overhead shot from a far player's contact at head height: both land on the
// same pixels. Physics can: the shuttle falls with g = 9.81 m/s² and is
// slowed by air drag (terminal speed ≈ 6.8 m/s), so how fast it accelerates
// on screen depends on how far away it is (a_px ≈ f·g / depth). Fitting a
// drag-ballistic flight to the tracked image points recovers the 3D path, and
// with it where on the court each hit happened.
//
// The camera's focal length, height and tilt come from the court homography
// (Zhang's method with square pixels and the principal point at the centre).

import type { Mat3, Pt } from "../match-analyzer.ts";
import { distort, type CourtCamera } from "./lens.ts";

export type V3 = [number, number, number];
export type Camera3D = { f: number; cx: number; cy: number; R: number[]; t: V3; C: V3 };

/** Typical horizontal field of view of iPhone video (16:9), degrees: 1× wide and 0.5× ultra-wide. */
export const HFOV_PRIOR = { wide: 66, ultrawide: 104 } as const;

/**
 * Full camera from the floor homography (court metres → undistorted pixels).
 * The focal length from one homography alone is very sensitive to tapping
 * error, so it is chosen within ±20% of the lens's known field of view, where
 * the rotation constraints (r1 ⟂ r2, |r1| = |r2|) fit best; the rotation is then
 * made exactly orthonormal.
 */
export function cameraFromHomography(H: Mat3, w: number, h: number, hfovDeg: number = HFOV_PRIOR.wide): Camera3D | null {
  const cx = w / 2, cy = h / 2;
  // Shift the principal point to the origin: H' = T·H.
  const Hc = [H[0] - cx * H[6], H[1] - cx * H[7], H[2] - cx * H[8], H[3] - cy * H[6], H[4] - cy * H[7], H[5] - cy * H[8], H[6], H[7], H[8]];
  const h1 = [Hc[0], Hc[3], Hc[6]];
  const h2 = [Hc[1], Hc[4], Hc[7]];
  const h3 = [Hc[2], Hc[5], Hc[8]];
  const f0 = w / 2 / Math.tan((hfovDeg * Math.PI) / 360);
  const cost = (f: number) => {
    const a = [h1[0] / f, h1[1] / f, h1[2]];
    const b = [h2[0] / f, h2[1] / f, h2[2]];
    const na = Math.hypot(a[0], a[1], a[2]), nb = Math.hypot(b[0], b[1], b[2]);
    const cosAB = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
    const ratio = Math.log(na / nb);
    return cosAB * cosAB + ratio * ratio + 0.5 * ((f - f0) / f0) ** 2;
  };
  let f = f0;
  let best = cost(f0);
  for (let k = 0.8; k <= 1.2001; k += 0.01) {
    const c = cost(f0 * k);
    if (c < best) {
      best = c;
      f = f0 * k;
    }
  }
  const kinv = (v: number[]) => [v[0] / f, v[1] / f, v[2]];
  const a = kinv(h1);
  const b = kinv(h2);
  const lam = 2 / (Math.hypot(a[0], a[1], a[2]) + Math.hypot(b[0], b[1], b[2]));
  let r1 = a.map((v) => v * lam);
  let r2 = b.map((v) => v * lam);
  let t = kinv(h3).map((v) => v * lam);
  if (t[2] < 0) {
    // The court must be in front of the camera.
    r1 = r1.map((v) => -v);
    r2 = r2.map((v) => -v);
    t = t.map((v) => -v);
  }
  // Gram–Schmidt: exact rotation closest to the measured columns.
  const n1 = Math.hypot(r1[0], r1[1], r1[2]);
  r1 = r1.map((v) => v / n1);
  const d12 = r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2];
  r2 = r2.map((v, i) => v - d12 * r1[i]);
  const n2 = Math.hypot(r2[0], r2[1], r2[2]);
  r2 = r2.map((v) => v / n2);
  let r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  // Columns r1 r2 r3 (world x, y, z → camera). World z must point up (camera above the floor).
  let R = [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]];
  let C = cameraCentre(R, t as V3);
  if (C[2] < 0) {
    r3 = r3.map((v) => -v);
    R = [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]];
    C = cameraCentre(R, t as V3);
  }
  return { f, cx, cy, R, t: t as V3, C };
}

function cameraCentre(R: number[], t: V3): V3 {
  // C = −Rᵀt
  return [-(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]), -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]), -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2])];
}

/** World point (court metres, z up) → video pixel, through the lens and shake offset. */
export function project3(c3: Camera3D, cam: CourtCamera, X: V3): Pt | null {
  const R = c3.R;
  const xc = R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + c3.t[0];
  const yc = R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + c3.t[1];
  const zc = R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + c3.t[2];
  if (zc < 0.3) return null;
  const q = distort(cam.lens, { x: c3.cx + (c3.f * xc) / zc, y: c3.cy + (c3.f * yc) / zc });
  return { x: q.x + cam.shift.x, y: q.y + cam.shift.y };
}

const G = 9.81;
const K_DRAG = G / (6.8 * 6.8);

/** Positions of a drag-ballistic flight at the given times (t relative to t0). */
export function simulate(p0: V3, v0: V3, times: number[]): V3[] {
  const out: V3[] = [];
  let p: V3 = [...p0];
  let v: V3 = [...v0];
  let t = 0;
  const dt = 1 / 240;
  for (const target of times) {
    while (t + dt <= target) {
      const sp = Math.hypot(v[0], v[1], v[2]);
      v = [v[0] - K_DRAG * sp * v[0] * dt, v[1] - K_DRAG * sp * v[1] * dt, v[2] - (G + K_DRAG * sp * v[2]) * dt];
      p = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
      t += dt;
    }
    const r = target - t;
    out.push([p[0] + v[0] * r, p[1] + v[1] * r, p[2] + v[2] * r]);
  }
  return out;
}

export type Flight = { t0: number; p0: V3; v0: V3; rms: number; at: (t: number) => V3 };

/** Back-projects a pixel to the point at a given distance along its viewing ray. */
function rayPoint(c3: Camera3D, u: number, v: number, depth: number): V3 {
  const d = [(u - c3.cx) / c3.f, (v - c3.cy) / c3.f, 1];
  const n = Math.hypot(d[0], d[1], d[2]);
  const dc = d.map((x) => (x / n) * depth);
  // camera → world: X = Rᵀ(dc − t) = C + Rᵀ dc
  const R = c3.R;
  return [c3.C[0] + R[0] * dc[0] + R[3] * dc[1] + R[6] * dc[2], c3.C[1] + R[1] * dc[0] + R[4] * dc[1] + R[7] * dc[2], c3.C[2] + R[2] * dc[0] + R[5] * dc[1] + R[8] * dc[2]];
}

/**
 * Fits a 3D flight to tracked points (video pixels, already in the camera's
 * frame of the shake offset). Levenberg–Marquardt on start position and
 * velocity, started from several distances along the first point's ray.
 */
export function fitFlight(c3: Camera3D, cam: CourtCamera, pts: { t: number; x: number; y: number }[]): Flight | null {
  if (pts.length < 5) return null;
  const t0 = pts[0].t;
  const times = pts.map((p) => p.t - t0);
  const und = pts.map((p) => ({ x: p.x - cam.shift.x, y: p.y - cam.shift.y }));
  const resid = (x: number[]): number[] => {
    const pos = simulate([x[0], x[1], x[2]], [x[3], x[4], x[5]], times);
    const r: number[] = [];
    pos.forEach((P, i) => {
      const q = project3(c3, { ...cam, shift: { x: 0, y: 0 } }, P);
      if (!q) {
        r.push(200, 200);
        return;
      }
      r.push(q.x - und[i].x, q.y - und[i].y);
    });
    return r;
  };
  const sq = (r: number[]) => r.reduce((a, b) => a + b * b, 0);
  let best: { x: number[]; e: number } | null = null;
  const n = pts.length - 1;
  const span = Math.max(1e-3, times[n]);
  for (const depth of [6, 9, 12, 15, 18, 21]) {
    // Start: first point at this depth; velocity from the last point at a depth nearby.
    const a = rayPoint(c3, und[0].x, und[0].y, depth);
    const b = rayPoint(c3, und[n].x, und[n].y, depth);
    let x = [a[0], a[1], a[2], (b[0] - a[0]) / span, (b[1] - a[1]) / span, (b[2] - a[2]) / span + (G * span) / 2];
    if (x[2] < 0 || x[2] > 8) continue;
    let r = resid(x);
    let e = sq(r);
    let mu = 1e-2;
    for (let it = 0; it < 25; it++) {
      // Numeric Jacobian.
      const J: number[][] = [];
      for (let k = 0; k < 6; k++) {
        const h = k < 3 ? 0.01 : 0.05;
        const xp = [...x];
        xp[k] += h;
        const rp = resid(xp);
        J.push(rp.map((v, i) => (v - r[i]) / h));
      }
      // (JᵀJ + μ·diag) δ = −Jᵀr
      const A = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => J[i].reduce((s, v, k) => s + v * J[j][k], 0)));
      const g = J.map((row) => row.reduce((s, v, k) => s + v * r[k], 0));
      let improved = false;
      for (let tries = 0; tries < 6 && !improved; tries++) {
        const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + mu) + 1e-9 : v)));
        const d = solve6(M, g.map((v) => -v));
        if (!d) {
          mu *= 10;
          continue;
        }
        const xn = x.map((v, i) => v + d[i]);
        if (xn[2] < -0.2 || xn[2] > 9) {
          mu *= 10;
          continue;
        }
        const rn = resid(xn);
        const en = sq(rn);
        if (en < e) {
          x = xn;
          r = rn;
          e = en;
          mu = Math.max(1e-6, mu / 3);
          improved = true;
        } else mu *= 10;
      }
      if (!improved) break;
    }
    if (!best || e < best.e) best = { x, e };
  }
  if (!best) return null;
  const rms = Math.sqrt(best.e / (2 * pts.length));
  const p0: V3 = [best.x[0], best.x[1], best.x[2]];
  const v0: V3 = [best.x[3], best.x[4], best.x[5]];
  return { t0, p0, v0, rms, at: (t: number) => simulate(p0, v0, [Math.max(0, t - t0)])[0] };
}

function solve6(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Point on the camera ray through a pixel that passes closest to the vertical line at a court position. */
export function rayNearPlayer(c3: Camera3D, cam: CourtCamera, px: Pt, at: Pt): { P: V3; horiz: number } {
  const u = undistortPixel(cam, px);
  const d0 = [(u.x - c3.cx) / c3.f, (u.y - c3.cy) / c3.f, 1];
  const R = c3.R;
  // Ray direction in world coordinates.
  const dw: V3 = [R[0] * d0[0] + R[3] * d0[1] + R[6] * d0[2], R[1] * d0[0] + R[4] * d0[1] + R[7] * d0[2], R[2] * d0[0] + R[5] * d0[1] + R[8] * d0[2]];
  // Closest approach in the horizontal plane to (at.x, at.y).
  const hx = dw[0], hy = dw[1];
  const s = ((at.x - c3.C[0]) * hx + (at.y - c3.C[1]) * hy) / Math.max(1e-9, hx * hx + hy * hy);
  const P: V3 = [c3.C[0] + dw[0] * s, c3.C[1] + dw[1] * s, c3.C[2] + dw[2] * s];
  return { P, horiz: Math.hypot(P[0] - at.x, P[1] - at.y) };
}

function undistortPixel(cam: CourtCamera, p: Pt): Pt {
  const L = cam.lens;
  const q = { x: p.x - cam.shift.x, y: p.y - cam.shift.y };
  if (!L.lambda) return q;
  const dx = (q.x - L.cx) / L.R, dy = (q.y - L.cy) / L.R;
  const f = 1 / (1 + L.lambda * (dx * dx + dy * dy));
  return { x: L.cx + dx * f * L.R, y: L.cy + dy * f * L.R };
}

/**
 * How well a flight starting (or ending) at a fixed 3D contact point explains
 * tracked points: fits only the velocity (3 unknowns, well conditioned).
 * Returns the RMS reprojection error in pixels.
 */
export function fitFromPoint(c3: Camera3D, cam: CourtCamera, P: V3, tc: number, pts: { t: number; x: number; y: number }[], backward = false): number {
  if (pts.length < 3) return Infinity;
  const und = pts.map((p) => ({ x: p.x - cam.shift.x, y: p.y - cam.shift.y }));
  const camNoShift = { ...cam, shift: { x: 0, y: 0 } };
  const resid = (v: number[]): number[] => {
    // Going backward in time: fly the reversed flight (approximation: drag treated symmetric).
    const times = pts.map((p) => Math.abs(p.t - tc));
    const vv: V3 = backward ? [-v[0], -v[1], -v[2]] : [v[0], v[1], v[2]];
    const pos = backward ? simulateBack(P, vv, times) : simulate(P, vv, times);
    const r: number[] = [];
    pos.forEach((X, i) => {
      const q = project3(c3, camNoShift, X);
      if (!q) r.push(300, 300);
      else r.push(q.x - und[i].x, q.y - und[i].y);
    });
    return r;
  };
  const sq = (r: number[]) => r.reduce((a, b) => a + b * b, 0);
  let bestE = Infinity;
  // Initial guesses: towards the other half at a few speeds and angles.
  for (const sp of [8, 18, 30]) {
    for (const el of [-0.3, 0.3, 0.9]) {
      for (const dirY of [1, -1]) {
        let v = [0, dirY * sp * Math.cos(el), sp * Math.sin(el)];
        let r = resid(v);
        let e = sq(r);
        let mu = 1e-2;
        for (let it = 0; it < 15; it++) {
          const J: number[][] = [];
          for (let k = 0; k < 3; k++) {
            const vp = [...v];
            vp[k] += 0.05;
            const rp = resid(vp);
            J.push(rp.map((x, i) => (x - r[i]) / 0.05));
          }
          const A = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => J[i].reduce((s, x, k) => s + x * J[j][k], 0)));
          const g = J.map((row) => row.reduce((s, x, k) => s + x * r[k], 0));
          let ok = false;
          for (let tries = 0; tries < 5 && !ok; tries++) {
            const M = A.map((row, i) => row.map((x, j) => (i === j ? x * (1 + mu) + 1e-9 : x)));
            const d = solve3(M, g.map((x) => -x));
            if (!d) {
              mu *= 10;
              continue;
            }
            const vn = v.map((x, i) => x + d[i]);
            if (Math.hypot(vn[0], vn[1], vn[2]) > 110) {
              mu *= 10;
              continue;
            }
            const rn = resid(vn);
            const en = sq(rn);
            if (en < e) {
              v = vn;
              r = rn;
              e = en;
              mu = Math.max(1e-6, mu / 3);
              ok = true;
            } else mu *= 10;
          }
          if (!ok) break;
        }
        bestE = Math.min(bestE, e);
      }
    }
  }
  return Math.sqrt(bestE / (2 * pts.length));
}

/** Backward flight from P (velocity given already reversed): gravity and drag act the other way in time. */
function simulateBack(P: V3, vRev: V3, times: number[]): V3[] {
  const out: V3[] = [];
  let p: V3 = [...P];
  let v: V3 = [...vRev];
  let t = 0;
  const dt = 1 / 240;
  for (const target of times) {
    while (t + dt <= target) {
      const sp = Math.hypot(v[0], v[1], v[2]);
      // Reversed time: dv/dτ = +g·ẑ + k|v|v (drag speeds it up going back).
      v = [v[0] + K_DRAG * sp * v[0] * dt, v[1] + K_DRAG * sp * v[1] * dt, v[2] + (G + K_DRAG * sp * v[2]) * dt];
      p = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
      t += dt;
    }
    const r = target - t;
    out.push([p[0] + v[0] * r, p[1] + v[1] * r, p[2] + v[2] * r]);
  }
  return out;
}

function solve3(A: number[][], b: number[]): number[] | null {
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-12) return null;
  return [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
}
