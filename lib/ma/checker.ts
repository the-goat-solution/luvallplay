// The tiny shuttle checker: an AI layer on top of the motion-based shuttle
// finder. Each candidate blob (see shuttle.ts) is described by a 7×7 patch of
// the two frame differences and the picture around it, plus a few blob
// measurements, and a small neural network (one hidden layer of 16 units,
// ~2,500 weights) gives the probability that it is the shuttle rather than a
// moving shoe, racket, net or spectator.
//
// It is trained in two ways:
//   • offline, on the simulator (exact labels) and on real matches with
//     labels from the tracker itself (self-training: candidates that end up on
//     a confirmed smooth flight are shuttles, short-lived fragments are not);
//   • online, during every session (auto-training): the same self-labels
//     nudge the weights with small SGD steps, so the checker adapts to that
//     hall's floor colour, light and background. The session's weights can be
//     sent (weights only, never images) to be averaged into the shared model.

export const PATCH = 7;
export const N_FEATURES = 3 * PATCH * PATCH + 4;
const HIDDEN = 16;

export type CheckerWeights = { v: 1; w1: number[]; b1: number[]; w2: number[]; b2: number; n: number };

/** Features for a candidate at analysis pixel (x, y) from the three frames a, b, c (b = the frame of the candidate). */
export function patchFeatures(
  a: Uint8Array,
  b: Uint8Array,
  c: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  blob: { area: number; bright: number; isolation: number; background: number },
  out = new Float32Array(N_FEATURES),
  /** The frame's motion threshold (grey levels, from its noise): differences are measured against it, so a dim hall looks like a bright one. */
  thr = 32,
): Float32Array {
  const r = (PATCH - 1) / 2;
  const cx = Math.round(x), cy = Math.round(y);
  let mean = 0;
  let k = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = Math.min(w - 1, Math.max(0, cx + dx));
      const py = Math.min(h - 1, Math.max(0, cy + dy));
      mean += b[py * w + px];
      k++;
    }
  }
  mean /= k;
  let i = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = Math.min(w - 1, Math.max(0, cx + dx));
      const py = Math.min(h - 1, Math.max(0, cy + dy));
      const j = py * w + px;
      out[i] = (b[j] - a[j]) / (2 * thr);
      out[i + PATCH * PATCH] = (b[j] - c[j]) / (2 * thr);
      out[i + 2 * PATCH * PATCH] = (b[j] - mean) / (2 * thr);
      i++;
    }
  }
  const o = 3 * PATCH * PATCH;
  out[o] = Math.min(4, blob.area / 8);
  out[o + 1] = (blob.bright - mean) / (4 * thr);
  out[o + 2] = blob.isolation;
  out[o + 3] = blob.background;
  return out;
}

function rand(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
}

export class ShuttleChecker {
  w1: Float32Array; // HIDDEN × N_FEATURES
  b1: Float32Array;
  w2: Float32Array;
  b2: number;
  /** Training samples behind these weights (for weighted averaging across sessions). */
  n: number;
  private hidden = new Float32Array(HIDDEN);
  /** The shared model this session started from: online steps are pulled back towards it. */
  private anchor: { w1: Float32Array; b1: Float32Array; w2: Float32Array; b2: number } | null = null;

  constructor(weights?: CheckerWeights | null) {
    if (weights && weights.w1.length === HIDDEN * N_FEATURES) {
      this.w1 = Float32Array.from(weights.w1);
      this.b1 = Float32Array.from(weights.b1);
      this.w2 = Float32Array.from(weights.w2);
      this.b2 = weights.b2;
      this.n = weights.n;
      this.anchor = { w1: Float32Array.from(weights.w1), b1: Float32Array.from(weights.b1), w2: Float32Array.from(weights.w2), b2: weights.b2 };
    } else {
      const r = rand(7);
      this.w1 = Float32Array.from({ length: HIDDEN * N_FEATURES }, () => r() * 0.2);
      this.b1 = new Float32Array(HIDDEN);
      this.w2 = Float32Array.from({ length: HIDDEN }, () => r() * 0.2);
      this.b2 = 0;
      this.n = 0;
    }
  }

  /** Probability that the candidate is the shuttle. */
  predict(f: Float32Array): number {
    const H = this.hidden;
    let z = this.b2;
    for (let j = 0; j < HIDDEN; j++) {
      let s = this.b1[j];
      const row = j * N_FEATURES;
      for (let i = 0; i < N_FEATURES; i++) s += this.w1[row + i] * f[i];
      H[j] = s > 0 ? s : 0;
      z += this.w2[j] * H[j];
    }
    return 1 / (1 + Math.exp(-z));
  }

  /**
   * One SGD step on a labelled sample (log-loss) with L2 shrinkage: towards the
   * shared model when there is one (anchored fine-tuning: a session with noisy
   * labels cannot drift far), towards zero when training from scratch.
   */
  train(f: Float32Array, y: 0 | 1, lr = 0.01, l2 = 1e-4, weight = 1): number {
    const p = this.predict(f); // fills hidden
    const H = this.hidden;
    const g = (p - y) * weight;
    const A = this.anchor;
    for (let j = 0; j < HIDDEN; j++) {
      const gh = H[j] > 0 ? g * this.w2[j] : 0;
      this.w2[j] -= lr * (g * H[j] + l2 * (this.w2[j] - (A ? A.w2[j] : 0)));
      if (gh !== 0) {
        const row = j * N_FEATURES;
        for (let i = 0; i < N_FEATURES; i++) this.w1[row + i] -= lr * (gh * f[i] + l2 * (this.w1[row + i] - (A ? A.w1[row + i] : 0)));
        this.b1[j] -= lr * gh;
      }
    }
    this.b2 -= lr * g;
    this.n++;
    const q = Math.min(1 - 1e-7, Math.max(1e-7, p));
    return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
  }

  toJSON(): CheckerWeights {
    const r = (a: Float32Array) => Array.from(a, (v) => Math.round(v * 1e5) / 1e5);
    return { v: 1, w1: r(this.w1), b1: r(this.b1), w2: r(this.w2), b2: Math.round(this.b2 * 1e5) / 1e5, n: this.n };
  }
}

/** Weighted average of several weight sets (federated averaging across sessions), by sample counts. */
export function averageWeights(sets: CheckerWeights[]): CheckerWeights | null {
  const ok = sets.filter((s) => s.w1.length === HIDDEN * N_FEATURES && s.n > 0);
  if (!ok.length) return null;
  const total = ok.reduce((a, s) => a + s.n, 0);
  const avg = (pick: (s: CheckerWeights) => number[]) =>
    pick(ok[0]).map((_, i) => ok.reduce((a, s) => a + pick(s)[i] * s.n, 0) / total);
  return { v: 1, w1: avg((s) => s.w1), b1: avg((s) => s.b1), w2: avg((s) => s.w2), b2: ok.reduce((a, s) => a + s.b2 * s.n, 0) / total, n: total };
}
