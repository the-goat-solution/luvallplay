// Automatic hit detection: fuses three independent cues into one probability,
// accepts hits above a quality-dependent threshold, and repairs the rally
// sequence to recover hits the cameras/microphone missed.
//
// Cues (each 0…1, within ±0.15 s of each other they form one candidate):
//   traj  – the shuttle's track turns sharply / relaunches near a player
//   swing – a burst of arm-and-racket motion around a player's upper body
//   audio – a sharp impact transient (1.5–7 kHz spectral flux onset)
//
// Probability (logistic model):
//   z = β0 + βt·traj + βs·swing + βa·audio + βp·reach + βr·rhythm + βalt·alternation
//   p = 1 / (1 + e^−z)
// rhythm = log-likelihood ratio of the time since the last hit under a
// log-normal shot interval (median 1.05 s, σ_ln 0.5) against "any time";
// alternation = +1 if the hitter is on the other side of the net from the
// last hitter, −1 if on the same side.
//
// Acceptance threshold depends on the capture quality Q ∈ [0,1]:
//   τ(Q) = 0.5 + 0.25·(1 − Q)
// Poor light, shake or a weak court set-up make every cue less reliable, so
// more evidence is required; the hits this rejects are then recovered by the
// sequence model rather than guessed one by one.
//
// Sequence repair (badminton rules): within a rally hits alternate across the
// net. Two accepted hits on the same side in a row mean
//   • a duplicate, if < 0.45 s apart (keep the stronger), or
//   • a missed hit on the other side in between: the best sub-threshold
//     candidate there (p ≥ 0.2) is promoted ("inferred"); if there is none, a
//     hit is "predicted" at the midpoint for the other side's player who was
//     moving their racket most (or nearest the net).
//
// Expected total (reported, not invented): with detection recall R(Q) and
// precision P(Q) fitted on the simulator (see docs/plans/match-analyzer-auto.md),
//   N̂ = N_seen·P(Q) / R(Q),   ± = √(N̂·(1 − R)) / R   (binomial).

export type CueKind = "traj" | "swing" | "audio";
/**
 * One piece of evidence. Trajectory cues carry the image point and, from the
 * 3D check, how plausible it is that each player made the contact
 * (playerFit, 0…1 per player: body-possible height and reach, and a
 * physical flight to/from that point).
 */
export type Cue = { t: number; kind: CueKind; strength: number; player?: number; x?: number; y?: number; playerFit?: number[] };
export type HitStatus = "accepted" | "inferred" | "predicted";
export type Hit = { t: number; player: number; p: number; status: HitStatus; cues: Partial<Record<CueKind, number>>; scores?: number[] };

/** Shortest time for a shot over the net and a reply back (fast drive exchange). */
export const MIN_TWO_SHOTS = 0.8;

export const FUSION = {
  b0: -4.2,
  traj: 5.0,
  swing: 3.2,
  audio: 3.6,
  reach: 1.2,
  rhythm: 0.6,
  alternation: 1.1,
  /** Added when the microphone is on but no impact was heard. */
  silence: -2.2,
  /** Added when there is no sound to go by (mic off or failed, silent file): visual cues must carry it alone. */
  noAudio: 1.0,
};

/**
 * Detection recall and precision vs capture quality, fitted on the simulator
 * (3 seeds × 60 s per condition; see docs/plans/match-analyzer-auto.md):
 *   R(Q) = 0.76·Q^0.12      P(Q) = 0.8 + 0.18·Q
 */
export const RECALL_MODEL = { rMax: 0.76, gamma: 0.12 };
export const PRECISION_MODEL = { a: 0.8, b: 0.18 };
/**
 * Without sound (mic off or failed, a file with no audio track) the picture
 * alone is much less certain; fitted the same way:
 *   R(Q) = 0.43·Q^0.12      P(Q) = 0.45 + 0.18·Q
 */
export const RECALL_MODEL_SILENT = { rMax: 0.43, gamma: 0.12 };
export const PRECISION_MODEL_SILENT = { a: 0.45, b: 0.18 };

export function expectedPrecision(q: number, audio = true): number {
  const m = audio ? PRECISION_MODEL : PRECISION_MODEL_SILENT;
  return Math.min(0.99, m.a + m.b * Math.max(0, Math.min(1, q)));
}

export function acceptThreshold(q: number): number {
  return 0.5 + 0.25 * (1 - Math.max(0, Math.min(1, q)));
}

export function expectedRecall(q: number, audio = true): number {
  const m = audio ? RECALL_MODEL : RECALL_MODEL_SILENT;
  return Math.max(0.05, m.rMax * Math.pow(Math.max(0.01, Math.min(1, q)), m.gamma));
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Log-likelihood ratio of a shot interval (s) under a log-normal (median 1.05 s, σ 0.5) vs uniform on 0–3 s. */
export function rhythmScore(dt: number): number {
  if (!(dt > 0)) return -3;
  const mu = Math.log(1.05);
  const s = 0.5;
  const pdf = Math.exp(-((Math.log(dt) - mu) ** 2) / (2 * s * s)) / (dt * s * Math.sqrt(2 * Math.PI));
  return Math.max(-3, Math.min(2, Math.log(pdf / (1 / 3))));
}

export type FusionContext = {
  /** Capture quality 0…1 (lib/ma/quality.ts). */
  quality: number;
  /** Side of the net (0 near / 1 far) a player is on. */
  sideOf: (player: number) => 0 | 1;
  /** All players on a side. */
  playersOn: (side: 0 | 1) => number[];
  /** How far an image point is from a player's racket reach at time t (≤ 1 = within reach); null if unknown. */
  reach: (player: number, x: number, y: number, t: number) => number | null;
  /** Number of players. */
  players: number;
  /** The microphone is on: a hit with no impact sound is then less likely. */
  audioOn: boolean;
  /** Peak swing strength of a player within ±w seconds of t. */
  swingNear: (player: number, t: number, w: number) => number;
};

type Pending = { t: number; cues: Cue[] };
/** scores: each player's log-odds from their own evidence (without the alternation term), for rally decoding. */
type Candidate = { t: number; player: number; p: number; cues: Partial<Record<CueKind, number>>; scores: number[] };

export class HitFusion {
  /** Every finalised candidate (accepted or not), for repair and diagnostics. */
  readonly candidates: Candidate[] = [];
  private accepted: Hit[] = [];
  private lastQuality = 1;
  private lastAudio = true;
  readonly latency = 0.35;

  private cues: Cue[] = [];

  addCue(c: Cue) {
    this.cues.push(c);
  }

  /**
   * Groups cues older than the latency window into candidates and scores them.
   * Impact sounds are the most precise in time (a few ms), so each one anchors
   * a candidate; swings (which peak on the follow-through, ~0.05–0.1 s after
   * contact) and trajectory turns (±0.25 s) attach to the nearest sound.
   * Visual cues with no sound nearby form their own candidates (microphone
   * off, or a hit drowned out by the hall).
   */
  update(now: number, ctx: FusionContext): Hit[] {
    this.lastQuality = ctx.quality;
    this.lastAudio = ctx.audioOn;
    const cutoff = now - this.latency;
    const window = (c: Cue) => (c.kind === "swing" ? [-0.15, 0.3] : [-0.25, 0.25]);
    const groups: Pending[] = [];
    // Sounds old enough: each claims the visual cues in its window (even very recent ones).
    for (const a of this.cues.filter((c) => c.kind === "audio" && c.t <= cutoff).sort((x, y) => x.t - y.t)) {
      if (!this.cues.includes(a)) continue;
      const mine = this.cues.filter((c) => {
        if (c === a) return true;
        if (c.kind === "audio") return false;
        const [lo, hi] = window(c);
        const d = c.t - a.t;
        return d >= lo && d <= hi;
      });
      this.cues = this.cues.filter((c) => !mine.includes(c));
      groups.push({ t: a.t, cues: mine });
    }
    // Visual cues no later sound could still claim: group among themselves.
    const loose = this.cues.filter((c) => c.kind !== "audio" && c.t <= cutoff - 0.25).sort((x, y) => x.t - y.t);
    this.cues = this.cues.filter((c) => !loose.includes(c));
    for (const c of loose) {
      const g = groups.find((x) => !x.cues.some((y) => y.kind === "audio") && Math.abs(x.t - c.t) <= 0.2);
      if (g) {
        g.cues.push(c);
        if (c.kind === "traj") g.t = c.t;
      } else groups.push({ t: c.kind === "swing" ? c.t - 0.07 : c.t, cues: [c] });
    }
    groups.sort((a, b) => a.t - b.t);
    for (const g of groups) this.finalise(g, ctx);
    return this.hits;
  }

  /** Finalises everything (end of the game). */
  flush(ctx: FusionContext): Hit[] {
    return this.update(Infinity, ctx);
  }

  get hits(): Hit[] {
    return this.accepted;
  }

  /**
   * Scores the candidate for every player (their own trajectory proximity and
   * swing, plus the shared sound, rhythm and alternation terms) and keeps the
   * most likely hitter.
   */
  private finalise(pend: Pending, ctx: FusionContext) {
    const audioCue = pend.cues.filter((c) => c.kind === "audio").sort((a, b) => b.strength - a.strength)[0];
    const audio = audioCue?.strength ?? 0;
    // With a sound, the contact time is known to a few ms: visual cues count by how well they line up
    // (trajectory turns within ~±0.1 s, swings peak ~0.07 s after contact on the follow-through).
    const tw = (c: Cue) => {
      if (!audioCue) return 1;
      const d = c.t - audioCue.t - (c.kind === "swing" ? 0.07 : 0);
      return Math.exp(-((d / (c.kind === "swing" ? 0.1 : 0.1)) ** 2));
    };
    const trajCues = pend.cues.filter((c) => c.kind === "traj");
    const last = [...this.accepted].reverse().find((h) => h.t < pend.t);
    const dt = last ? pend.t - last.t : Infinity;
    const rhythm = dt < 4 ? rhythmScore(dt) : 0;
    let best: { player: number; z: number; traj: number; swing: number; reach: number } | null = null;
    const scores: number[] = [];
    for (let pl = 0; pl < ctx.players; pl++) {
      let traj = 0;
      let reach = 0;
      for (const c of trajCues) {
        if (c.x === undefined || c.y === undefined) continue;
        const r = ctx.reach(pl, c.x, c.y, pend.t);
        if (r === null) continue;
        let prox = Math.max(0, 1 - Math.max(0, r - 0.8) / 1.0);
        // The 3D check settles near-vs-far and front-vs-back, which the flat image cannot.
        if (c.playerFit) prox *= 0.1 + 0.9 * c.playerFit[pl];
        if (c.strength * prox * tw(c) > traj) {
          traj = c.strength * prox * tw(c);
          reach = prox;
        }
      }
      const swing = Math.max(
        0,
        ...pend.cues.filter((c) => c.kind === "swing" && c.player === pl).map((c) => c.strength * tw(c)),
        ctx.swingNear(pl, pend.t, 0.2),
      );
      const alternation = dt < 3 ? (ctx.sideOf(last!.player) !== ctx.sideOf(pl) ? 1 : -1) : 0;
      const silent = ctx.audioOn ? (audioCue ? 0 : FUSION.silence) : FUSION.noAudio;
      const own = FUSION.b0 + FUSION.traj * traj + FUSION.swing * swing + FUSION.audio * audio + FUSION.reach * reach + FUSION.rhythm * rhythm + silent;
      scores.push(own);
      const z = own + FUSION.alternation * alternation;
      if (!best || z > best.z) best = { player: pl, z, traj, swing, reach };
    }
    if (!best) return;
    // Without any visual evidence for anyone, a sound alone is not a hit by a known player.
    if (best.traj === 0 && best.swing === 0 && audio < 0.5) return;
    const p = sigmoid(best.z);
    const cues: Partial<Record<CueKind, number>> = {};
    if (best.traj) cues.traj = round2(best.traj);
    if (best.swing) cues.swing = round2(best.swing);
    if (audio) cues.audio = round2(audio);
    const cand: Candidate = { t: pend.t, player: best.player, p, cues, scores };
    this.candidates.push(cand);
    if (p >= acceptThreshold(ctx.quality)) {
      this.accepted.push({ t: cand.t, player: best.player, p, status: "accepted", cues, scores });
      this.accepted.sort((a, b) => a.t - b.t);
    }
    this.repair(ctx);
  }

  /**
   * Re-decides who hit each shot of a rally jointly (Viterbi): every hit's own
   * evidence per player, plus a heavy penalty for two hits on the same side in
   * a row. One early mistake no longer drags the rest of the rally with it.
   */
  private decodeRallies(ctx: FusionContext) {
    const H = this.accepted;
    let start = 0;
    for (let i = 1; i <= H.length; i++) {
      if (i < H.length && H[i].t - H[i - 1].t <= 3.5) continue;
      const seg = H.slice(start, i);
      start = i;
      if (seg.length < 2) continue;
      const n = ctx.players;
      const emit = (h: Hit, pl: number) => {
        if (!h.scores) return pl === h.player ? 0 : -50; // manual or predicted: fixed
        return h.scores[pl] - Math.max(...h.scores);
      };
      const missLog = Math.log(Math.max(0.03, 1 - expectedRecall(this.lastQuality, this.lastAudio)));
      let dp = Array.from({ length: n }, (_, pl) => emit(seg[0], pl));
      const back: number[][] = [];
      for (let k = 1; k < seg.length; k++) {
        const nd: number[] = [];
        const bk: number[] = [];
        for (let pl = 0; pl < n; pl++) {
          let bestV = -Infinity;
          let bestP = 0;
          for (let q = 0; q < n; q++) {
            // Same side twice in a row needs a missed hit in between: impossible if too quick,
            // otherwise as likely as a miss (log(1 − R)).
            const gap = seg[k].t - seg[k - 1].t;
            const same = ctx.sideOf(q) === ctx.sideOf(pl);
            const v = dp[q] + (same ? (gap < MIN_TWO_SHOTS ? -8 : missLog) : 0);
            if (v > bestV) {
              bestV = v;
              bestP = q;
            }
          }
          nd.push(bestV + emit(seg[k], pl));
          bk.push(bestP);
        }
        dp = nd;
        back.push(bk);
      }
      let pl = dp.indexOf(Math.max(...dp));
      for (let k = seg.length - 1; k >= 0; k--) {
        seg[k].player = pl;
        if (k > 0) pl = back[k - 1][pl];
      }
    }
  }

  /** Enforces alternation across the net; promotes or predicts missed hits. */
  private repair(ctx: FusionContext) {
    this.decodeRallies(ctx);
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      const H = this.accepted;
      for (let i = 1; i < H.length; i++) {
        const a = H[i - 1];
        const b = H[i];
        const gap = b.t - a.t;
        if (gap > 3.5) continue; // different rallies
        if (ctx.sideOf(a.player) !== ctx.sideOf(b.player)) continue;
        const weaker = a.p >= b.p ? i : i - 1;
        if (gap < MIN_TWO_SHOTS) {
          // No room for a shot over the net and back: one of the two is not a hit
          // (a duplicate split across two cues, a swing echo, a racket feint).
          H.splice(weaker, 1);
          changed = true;
          break;
        }
        const otherSide = (1 - ctx.sideOf(a.player)) as 0 | 1;
        const between = this.candidates
          .filter((c) => c.t > a.t + 0.2 && c.t < b.t - 0.2 && c.p >= 0.2 && ctx.sideOf(c.player) === otherSide)
          .sort((x, y) => y.p - x.p)[0];
        if (!between && Math.min(a.p, b.p) < 0.85 && gap < 1.6) {
          // Nothing seen on the other side and one of the two is weak: more likely a false hit than two misses.
          H.splice(weaker, 1);
          changed = true;
          break;
        }
        if (between) {
          H.splice(i, 0, { t: between.t, player: between.player, p: between.p, status: "inferred", cues: between.cues, scores: between.scores });
        } else {
          const t = (a.t + b.t) / 2;
          const others = ctx.playersOn(otherSide);
          let pl = others[0];
          let best = -1;
          for (const o of others) {
            const s = ctx.swingNear(o, t, gap / 2);
            if (s > best) {
              best = s;
              pl = o;
            }
          }
          H.splice(i, 0, { t, player: pl, p: 1 - expectedRecall(ctx.quality, ctx.audioOn), status: "predicted", cues: {} });
        }
        changed = true;
        break;
      }
    }
  }

  /** The reported totals with the expected-miss formula applied. */
  estimate(): { seen: number; predicted: number; estimated: number; plusMinus: number; recall: number } {
    const seen = this.accepted.filter((h) => h.status !== "predicted").length;
    const predicted = this.accepted.length - seen;
    const R = expectedRecall(this.lastQuality, this.lastAudio);
    const nHat = (seen * expectedPrecision(this.lastQuality, this.lastAudio)) / R;
    return {
      seen,
      predicted,
      estimated: Math.round(nHat),
      plusMinus: Math.round(Math.sqrt(Math.max(0, nHat * (1 - R))) / R),
      recall: R,
    };
  }

  /** Removes a hit (assistant correction). */
  remove(t: number) {
    const i = this.accepted.findIndex((h) => Math.abs(h.t - t) < 0.01);
    if (i >= 0) this.accepted.splice(i, 1);
  }

  /** Adds a hit by hand (assistant correction). */
  addManual(t: number, player: number) {
    this.accepted.push({ t, player, p: 1, status: "accepted", cues: {} });
    this.accepted.sort((a, b) => a.t - b.t);
  }

  /** After an identity swap was corrected, hits attributed to a/b since `from` belong to the other. */
  swapPlayers(a: number, b: number, from: number) {
    for (const list of [this.accepted, this.candidates]) {
      for (const h of list) {
        if (h.t < from) continue;
        if (h.player === a) h.player = b;
        else if (h.player === b) h.player = a;
      }
    }
  }
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
