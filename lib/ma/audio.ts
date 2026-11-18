// Racket impact sounds. A shuttle hit is a short broadband "tock" (most
// energy 1.5–7 kHz, a few milliseconds). Onsets are found with spectral flux
// (sum of positive log-magnitude increases in that band) against an adaptive
// threshold: median + k·MAD over the last 1.5 s, so a noisy hall or a busy
// neighbouring court raises the bar automatically.

export type Onset = { t: number; strength: number };

export class OnsetDetector {
  private prev: Float32Array | null = null;
  private hist: { t: number; f: number }[] = [];
  private lastT = -Infinity;
  private peak: { t: number; z: number } | null = null;
  private readonly sampleRate: number;
  private readonly fftSize: number;
  private readonly lo: number;
  private readonly hi: number;
  private readonly zMin: number;

  constructor(sampleRate: number, fftSize: number, lo = 1500, hi = 7000, zMin = 5) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.lo = lo;
    this.hi = hi;
    this.zMin = zMin;
  }

  /**
   * One spectrum frame (linear magnitudes, fftSize/2 bins) at time t (s).
   * Returns an onset when the previous frame was a confirmed peak.
   */
  push(t: number, mags: Float32Array): Onset | null {
    const binHz = this.sampleRate / this.fftSize;
    const a = Math.max(1, Math.floor(this.lo / binHz));
    const b = Math.min(mags.length - 1, Math.ceil(this.hi / binHz));
    const cur = new Float32Array(b - a + 1);
    for (let k = a; k <= b; k++) cur[k - a] = Math.log1p(10 * mags[k]);
    let flux = 0;
    if (this.prev) for (let k = 0; k < cur.length; k++) flux += Math.max(0, cur[k] - this.prev[k]);
    this.prev = cur;
    this.hist.push({ t, f: flux });
    while (this.hist.length && t - this.hist[0].t > 1.5) this.hist.shift();
    if (this.hist.length < 10) return null;
    const vals = this.hist.map((h) => h.f).sort((x, y) => x - y);
    const med = vals[Math.floor(vals.length / 2)];
    const mad = vals.map((v) => Math.abs(v - med)).sort((x, y) => x - y)[Math.floor(vals.length / 2)];
    const z = (flux - med) / (1.4826 * mad + 1e-6);
    // Report the peak of a burst once it has passed (one frame of latency).
    let out: Onset | null = null;
    if (this.peak && z < this.peak.z) {
      if (this.peak.z >= this.zMin && this.peak.t - this.lastT > 0.12) {
        out = { t: this.peak.t, strength: Math.min(1, (this.peak.z - this.zMin + 1) / 10) };
        this.lastT = this.peak.t;
      }
      this.peak = null;
    } else if (z >= this.zMin * 0.8 && (!this.peak || z >= this.peak.z)) {
      this.peak = { t, z };
    }
    return out;
  }
}

/** In-place radix-2 FFT (re, im of length 2^k). */
export function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Onsets in a whole recording (mono samples), e.g. an uploaded video's audio track. */
export function onsetsFromSamples(samples: Float32Array, sampleRate: number, fftSize = 512, hopSec = 0.01): Onset[] {
  const det = new OnsetDetector(sampleRate, fftSize);
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const win = new Float32Array(fftSize).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  const mags = new Float32Array(fftSize / 2);
  const out: Onset[] = [];
  for (let s = 0; s + fftSize <= samples.length; s += hop) {
    for (let i = 0; i < fftSize; i++) {
      re[i] = samples[s + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < fftSize / 2; k++) mags[k] = Math.hypot(re[k], im[k]) / fftSize;
    const o = det.push(s / sampleRate, mags);
    if (o) out.push(o);
  }
  return out;
}
