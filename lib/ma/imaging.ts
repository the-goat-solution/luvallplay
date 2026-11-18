// Low-level image work for the Match Analyzer, on plain typed arrays so it
// runs the same in the browser (canvas ImageData) and in Node tests (the
// simulator's frames). Frames are small greyscale images (about 480×270).

/** RGBA (canvas layout) → greyscale (Rec. 601 luma). */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, out?: Uint8Array): Uint8Array {
  const g = out && out.length === w * h ? out : new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return g;
}

/** Mean and standard deviation of brightness (sampled every 4th pixel). */
export function brightness(g: Uint8Array): { mean: number; std: number } {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let i = 0; i < g.length; i += 4) {
    s += g[i];
    s2 += g[i] * g[i];
    n++;
  }
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

/**
 * Sensor noise σ (grey levels) from two consecutive frames: the median
 * absolute difference over the image is dominated by static background,
 * where the difference is pure noise (σ_diff = √2·σ; MAD → σ via 1.4826).
 */
export function noiseSigma(a: Uint8Array, b: Uint8Array, dx = 0, dy = 0, w = 0): number {
  const hist = new Uint32Array(256);
  const h = w ? a.length / w : 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 7) {
    let j = i;
    if (w && (dx || dy)) {
      const x = (i % w) - dx;
      const y = Math.floor(i / w) - dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      j = y * w + x;
    }
    hist[Math.abs(a[i] - b[j])]++;
    n++;
  }
  let c = 0;
  let med = 0;
  for (let k = 0; k < 256; k++) {
    c += hist[k];
    if (c >= n / 2) {
      med = k;
      break;
    }
  }
  return (1.4826 * Math.max(0.5, med)) / Math.SQRT2;
}

/** Gradient-magnitude projections, robust to lighting changes, for shift estimation. */
export function projections(g: Uint8Array, w: number, h: number): { px: Float32Array; py: Float32Array } {
  const px = new Float32Array(w);
  const py = new Float32Array(h);
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      px[x] += Math.abs(g[i + 1] - g[i - 1]);
      py[y] += Math.abs(g[i + w] - g[i - w]);
    }
  }
  return { px, py };
}

function bestShift(a: Float32Array, b: Float32Array, max: number): { shift: number; score: number } {
  // b ≈ a shifted by s: b[i] = a[i - s]. Normalised cross-correlation over the overlap.
  let best = 0;
  let bestScore = -Infinity;
  const n = a.length;
  for (let s = -max; s <= max; s++) {
    let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0, c = 0;
    for (let i = Math.max(0, s) + 4; i < Math.min(n, n + s) - 4; i++) {
      const x = a[i - s];
      const y = b[i];
      sa += x;
      sb += y;
      sab += x * y;
      saa += x * x;
      sbb += y * y;
      c++;
    }
    if (c < 10) continue;
    const cov = sab - (sa * sb) / c;
    const den = Math.sqrt((saa - (sa * sa) / c) * (sbb - (sb * sb) / c)) || 1;
    const score = cov / den;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return { shift: best, score: bestScore };
}

/**
 * How far frame b moved relative to frame a (camera shake), in pixels, from
 * gradient projections. Returns the correlation too: low values mean the
 * estimate should not be trusted (big scene change, very dark).
 */
export function estimateShift(
  a: { px: Float32Array; py: Float32Array },
  b: { px: Float32Array; py: Float32Array },
  max = 8,
): { dx: number; dy: number; score: number } {
  const x = bestShift(a.px, b.px, max);
  const y = bestShift(a.py, b.py, max);
  return { dx: x.shift, dy: y.shift, score: Math.min(x.score, y.score) };
}

/**
 * Three-frame difference: pixels that changed both from f0→f1 and f1→f2 are
 * where something moving was at f1's moment (the shuttle, a racket, a limb),
 * without the "ghost" a two-frame difference leaves. Shifts compensate shake
 * (offset of f0 and f2 relative to f1).
 */
export function motionMask(
  f0: Uint8Array,
  f1: Uint8Array,
  f2: Uint8Array,
  w: number,
  h: number,
  thr: number,
  s0: { dx: number; dy: number },
  s2: { dx: number; dy: number },
  out?: Uint8Array,
  edgeGain = 0.3,
): Uint8Array {
  const m = out && out.length === w * h ? out : new Uint8Array(w * h);
  m.fill(0);
  for (let y = 1; y < h - 1; y++) {
    const y0 = y + s0.dy;
    const y2 = y + s2.dy;
    if (y0 < 0 || y0 >= h || y2 < 0 || y2 >= h) continue;
    for (let x = 1; x < w - 1; x++) {
      const x0 = x + s0.dx;
      const x2 = x + s2.dx;
      if (x0 < 0 || x0 >= w || x2 < 0 || x2 >= w) continue;
      const i = y * w + x;
      const v = f1[i];
      // Shake compensation is in whole pixels; the leftover sub-pixel misalignment
      // shows up along strong edges (court lines). Raise the bar there.
      const grad = (Math.abs(f1[i + 1] - f1[i - 1]) + Math.abs(f1[i + w] - f1[i - w])) * 0.5;
      const t = thr + edgeGain * grad;
      if (Math.abs(v - f0[y0 * w + x0]) > t && Math.abs(v - f2[y2 * w + x2]) > t) m[i] = 1;
    }
  }
  return m;
}

export type Blob = { x: number; y: number; area: number; minX: number; maxX: number; minY: number; maxY: number; bright: number };

/**
 * Connected regions of a mask (4-neighbour flood fill). Gives up (returns
 * null) past `maxBlobs`: the frame is too noisy or the camera moved.
 */
export function findBlobs(mask: Uint8Array, w: number, h: number, gray: Uint8Array, maxBlobs = 600, maxArea = 4000): Blob[] | null {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const out: Blob[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0, sx = 0, sy = 0, sb = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      area++;
      sx += x;
      sy += y;
      sb += gray[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (area > maxArea) continue;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[sp++] = i + w; }
    }
    out.push({ x: sx / area, y: sy / area, area, minX, maxX, minY, maxY, bright: sb / area });
    if (out.length > maxBlobs) return null;
  }
  return out;
}

/** Changed pixels inside a rectangle of the mask (for a player's swing energy). */
export function maskCount(mask: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): number {
  const ax = Math.max(0, Math.floor(x0));
  const ay = Math.max(0, Math.floor(y0));
  const bx = Math.min(w - 1, Math.ceil(x1));
  const by = Math.min(h - 1, Math.ceil(y1));
  let c = 0;
  for (let y = ay; y <= by; y++) {
    const row = y * w;
    for (let x = ax; x <= bx; x++) c += mask[row + x];
  }
  return c;
}

const HUE_BINS = 8;
const PART_BINS = HUE_BINS + 3;
/** Body parts used to tell players apart: shirt, shorts, legs/shoes (fractions of the box height). */
export const LOOK_PARTS: [number, number][] = [
  [0.2, 0.48],
  [0.5, 0.66],
  [0.72, 0.98],
];
export const LOOK_LENGTH = PART_BINS * LOOK_PARTS.length;

function histInto(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, out: number[], off: number) {
  const ax = Math.max(0, Math.round(x0));
  const ay = Math.max(0, Math.round(y0));
  const bx = Math.min(w - 1, Math.round(x1));
  const by = Math.min(h - 1, Math.round(y1));
  let total = 0;
  const step = Math.max(1, Math.floor(Math.min(bx - ax, by - ay) / 12));
  for (let y = ay; y <= by; y += step) {
    for (let x = ax; x <= bx; x += step) {
      const j = (y * w + x) * 4;
      const r = rgba[j] / 255, g = rgba[j + 1] / 255, b = rgba[j + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const s = max === 0 ? 0 : (max - min) / max;
      if (s < 0.25 || max < 0.15) {
        out[off + HUE_BINS + (max < 0.3 ? 0 : max < 0.7 ? 1 : 2)]++;
      } else {
        const d = max - min;
        let hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        if (!Number.isFinite(hue)) hue = 0;
        out[off + Math.min(HUE_BINS - 1, Math.floor((hue / 6) * HUE_BINS))]++;
      }
      total++;
    }
  }
  if (total) for (let k = 0; k < PART_BINS; k++) out[off + k] /= total;
}

/**
 * Colour fingerprint of a person: shirt, shorts and legs/shoes histograms
 * side by side (the middle 40% of the box width, to avoid background).
 * Partners in the same shirt usually still differ in shorts, socks or shoes.
 */
export function partLooks(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, box: [number, number, number, number]): number[] | undefined {
  const [bx, by, bw, bh] = box;
  if (bw < 4 || bh < 8) return undefined;
  const out = new Array(LOOK_LENGTH).fill(0);
  LOOK_PARTS.forEach(([a, b], k) => {
    histInto(rgba, w, h, bx + bw * 0.3, by + bh * a, bx + bw * 0.7, by + bh * b, out, k * PART_BINS);
  });
  return out;
}

/** Hellinger distance (0 same … 1 nothing shared) per part, weighted: shirt 0.4, shorts 0.35, legs 0.25. */
export function lookDistance3(a?: number[], b?: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  const parts = a.length / PART_BINS;
  const weights = parts === 3 ? [0.4, 0.35, 0.25] : new Array(parts).fill(1 / parts);
  let d = 0;
  for (let k = 0; k < parts; k++) {
    let bc = 0;
    for (let i = 0; i < PART_BINS; i++) bc += Math.sqrt(a[k * PART_BINS + i] * b[k * PART_BINS + i]);
    d += weights[k] * Math.sqrt(Math.max(0, 1 - bc));
  }
  return d;
}
