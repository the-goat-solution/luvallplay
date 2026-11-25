// Capture quality: how much the automatic detection can be trusted right now.
// Five factors, each 0…1, combined as a weighted geometric mean
//   Q = L^0.25 · S^0.25 · C^0.2 · I^0.2 · Rz^0.1
//   L  light:       brightness, contrast and sensor noise
//   S  stability:   camera shake (frame-to-frame movement) after compensation
//   C  court set-up: reprojection error of the court points, lens model fit
//   I  identity:    how sure the tracker is about who is who
//   Rz resolution:  how many pixels a shuttle covers at the far baseline
// Q drives the hit acceptance threshold τ(Q) and the expected-recall model
// R(Q) in lib/ma/hits.ts.

export type QualityFactors = { light: number; stability: number; court: number; identity: number; resolution: number };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => {
  const x = clamp01((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};

export const QUALITY_WEIGHTS: QualityFactors = { light: 0.25, stability: 0.25, court: 0.2, identity: 0.2, resolution: 0.1 };

export function combineQuality(f: QualityFactors): number {
  let q = 1;
  for (const k of Object.keys(QUALITY_WEIGHTS) as (keyof QualityFactors)[]) q *= Math.pow(Math.max(0.02, f[k]), QUALITY_WEIGHTS[k]);
  return clamp01(q);
}

/** Light factor from mean brightness, contrast (grey levels) and noise σ. */
export function lightFactor(mean: number, std: number, noise: number): number {
  return smooth(20, 75, mean) * Math.sqrt(smooth(6, 28, std)) * Math.exp(-Math.max(0, noise - 3) / 6);
}

/** Stability factor from RMS frame-to-frame shake (pixels in a 640-wide analysis frame). */
export function stabilityFactor(rmsShake: number): number {
  return Math.exp(-(rmsShake * rmsShake) / (2 * 1.5 * 1.5));
}

/** Court factor from tap reprojection error (pixels, 1920-wide video equivalent) and how many points were tapped. */
export function courtFactor(rmsPx1920: number, points: number): number {
  // A finger on a phone screen lands within ~10 px of a 1920-wide frame.
  return Math.exp(-((rmsPx1920 / 14) ** 2)) * (points >= 6 ? 1 : points >= 5 ? 0.95 : 0.9);
}

/** Resolution factor: pixels a 7 cm shuttle covers at the far baseline in the analysis frame. */
export function resolutionFactor(shuttlePx: number): number {
  // Motion blur stretches a fast shuttle over several pixels, so even ~0.3 px sharp size is still seen.
  return smooth(0.12, 1.2, shuttlePx);
}

/** Running estimate of light and shake over the last ~2 s of frames. */
export class QualityMeter {
  private samples: { mean: number; std: number; noise: number; shake: number }[] = [];
  court = 0.9;
  resolution = 0.8;
  identity = 1;

  push(mean: number, std: number, noise: number, shake: number) {
    this.samples.push({ mean, std, noise, shake });
    if (this.samples.length > 60) this.samples.shift();
  }

  factors(): QualityFactors {
    const n = this.samples.length || 1;
    const avg = (k: "mean" | "std" | "noise") => this.samples.reduce((a, s) => a + s[k], 0) / n;
    const shake = Math.sqrt(this.samples.reduce((a, s) => a + s.shake * s.shake, 0) / n);
    return {
      light: this.samples.length ? lightFactor(avg("mean"), avg("std"), avg("noise")) : 0.8,
      stability: stabilityFactor(shake),
      court: this.court,
      identity: this.identity,
      resolution: this.resolution,
    };
  }

  value(): number {
    return combineQuality(this.factors());
  }
}
