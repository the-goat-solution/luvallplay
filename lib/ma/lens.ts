// Lens model for phone cameras. iPhone video from the 1× (wide) camera is
// almost distortion-free; the 0.5× ultra-wide bends straight court lines
// (barrel distortion), more or less depending on whether iOS corrects it.
// One-parameter division model (Fitzgibbon 2001): an undistorted point is
//   u = c + (d − c) / (1 + λ·r²),  r = |d − c| / R  (R = half the diagonal)
// λ < 0 is barrel distortion. λ is estimated together with the court
// homography from the assistant's court taps (needs 6+ points to measure it;
// with fewer, the lens preset's value is used).
import {
  applyHomography,
  fitHomography,
  invertMat3,
  type CourtTap,
  type Mat3,
  type Pt,
} from "../match-analyzer.ts";

export type Lens = { lambda: number; cx: number; cy: number; R: number };

export type LensPreset = "wide" | "ultrawide";

/** Starting λ per iPhone lens (ultra-wide: residual after iOS correction, refined from taps). */
export const LENS_PRIOR: Record<LensPreset, number> = { wide: 0, ultrawide: -0.12 };

export function makeLens(w: number, h: number, lambda = 0): Lens {
  return { lambda, cx: w / 2, cy: h / 2, R: Math.hypot(w, h) / 2 };
}

export function undistort(L: Lens, p: Pt): Pt {
  if (!L.lambda) return p;
  const dx = (p.x - L.cx) / L.R;
  const dy = (p.y - L.cy) / L.R;
  const f = 1 / (1 + L.lambda * (dx * dx + dy * dy));
  return { x: L.cx + dx * f * L.R, y: L.cy + dy * f * L.R };
}

export function distort(L: Lens, p: Pt): Pt {
  if (!L.lambda) return p;
  const ux = (p.x - L.cx) / L.R;
  const uy = (p.y - L.cy) / L.R;
  const ru = Math.hypot(ux, uy);
  if (ru < 1e-9) return p;
  const disc = 1 - 4 * L.lambda * ru * ru;
  if (disc < 0) return p;
  const rd = (1 - Math.sqrt(disc)) / (2 * L.lambda * ru);
  const k = rd / ru;
  return { x: L.cx + ux * k * L.R, y: L.cy + uy * k * L.R };
}

/** Everything needed to go between video pixels and court metres. */
export type CourtCamera = {
  lens: Lens;
  /** Undistorted image → court. */
  toCourt: Mat3;
  /** Court → undistorted image. */
  toImage: Mat3;
  /** Reprojection error of the taps, in video pixels (RMS). */
  rms: number;
  /** Camera shake compensation: current image offset from the calibration frame, in video pixels. */
  shift: Pt;
};

export function imageToCourt(cam: CourtCamera, p: Pt): Pt {
  return applyHomography(cam.toCourt, undistort(cam.lens, { x: p.x - cam.shift.x, y: p.y - cam.shift.y }));
}

export function courtToImage(cam: CourtCamera, p: Pt): Pt {
  const q = distort(cam.lens, applyHomography(cam.toImage, p));
  return { x: q.x + cam.shift.x, y: q.y + cam.shift.y };
}

/** Metres covered by one video pixel at an image point (sideways), for measurement noise and height cues. */
export function metresPerPixel(cam: CourtCamera, p: Pt): number {
  const a = imageToCourt(cam, p);
  const b = imageToCourt(cam, { x: p.x + 1, y: p.y });
  const c = imageToCourt(cam, { x: p.x, y: p.y + 1 });
  return Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y) * 0.5);
}

function fitWithLambda(taps: CourtTap[], w: number, h: number, lambda: number): CourtCamera | null {
  const lens = makeLens(w, h, lambda);
  const und = taps.map((t) => undistort(lens, t.image));
  const toCourt = fitHomography(und, taps.map((t) => t.court));
  if (!toCourt || toCourt.some((v) => !Number.isFinite(v))) return null;
  const toImage = invertMat3(toCourt);
  if (!toImage) return null;
  const cam: CourtCamera = { lens, toCourt, toImage, rms: 0, shift: { x: 0, y: 0 } };
  let sq = 0;
  let worstCourt = 0;
  for (const t of taps) {
    const q = courtToImage(cam, t.court);
    sq += (q.x - t.image.x) ** 2 + (q.y - t.image.y) ** 2;
    const c = imageToCourt(cam, t.image);
    worstCourt = Math.max(worstCourt, Math.hypot(c.x - t.court.x, c.y - t.court.y));
  }
  // Taps in an impossible order fold the court over: reject.
  if (!Number.isFinite(sq) || worstCourt > 1.5) return null;
  cam.rms = Math.sqrt(sq / taps.length);
  return cam;
}

/**
 * Court camera from the assistant's taps. With 6 or more taps the lens
 * distortion is measured (golden-section search on λ minimising the
 * reprojection error); with fewer, the preset's λ is used.
 */
export function fitCamera(taps: CourtTap[], w: number, h: number, lambdaPrior = 0): CourtCamera | null {
  if (taps.length < 4) return null;
  if (taps.length < 6) return fitWithLambda(taps, w, h, lambdaPrior);
  const score = (l: number) => fitWithLambda(taps, w, h, l)?.rms ?? Infinity;
  // Coarse scan, then golden-section refinement around the best value.
  let best = lambdaPrior;
  let bestS = score(best);
  for (let l = -0.5; l <= 0.2001; l += 0.05) {
    const s = score(l);
    if (s < bestS) {
      bestS = s;
      best = l;
    }
  }
  let a = best - 0.05;
  let b = best + 0.05;
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = score(c);
  let fd = score(d);
  for (let i = 0; i < 30; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = score(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = score(d);
    }
  }
  const l = (a + b) / 2;
  // Prefer the prior unless measuring λ clearly helps (guards against over-fitting tap noise).
  const prior = fitWithLambda(taps, w, h, lambdaPrior);
  const fitted = fitWithLambda(taps, w, h, l);
  if (!fitted) return prior;
  if (prior && prior.rms <= fitted.rms * 1.1 + 0.3) return prior;
  return fitted;
}

/** A court line sampled densely enough to follow the lens curvature, in video pixels. */
export function projectSegment(cam: CourtCamera, a: Pt, b: Pt, steps = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    out.push(courtToImage(cam, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }));
  }
  return out;
}
