// Runs the automatic engine on the simulator and scores it against the
// ground truth. Used by the tests, the evaluation script and (frame by frame)
// by the preview test scenario.

import { MatchEngine } from "./engine.ts";
import { fitCamera, LENS_PRIOR } from "./lens.ts";
import { partLooks, toGray } from "./imaging.ts";
import { MatchSim, type SimFrame, type SimOptions } from "./sim.ts";
import { DOUBLES_SLOTS, SINGLES_SLOTS } from "./identity.ts";
import type { Hit } from "./hits.ts";
import { iou, type Detection } from "../match-analyzer.ts";

export type HitScore = { truth: number; found: number; matched: number; rightPlayer: number; rightSide: number; precision: number; recall: number; attribution: number; side: number };

/** Side of the net of a player index: doubles 0–1 near, 2–3 far; singles 0 near, 1 far. */
export function sideOfIndex(players: number): (p: number) => 0 | 1 {
  return (p) => (p < players / 2 ? 0 : 1);
}

/** Matches found hits to true hits within ±tol seconds (each used once, closest first). */
export function scoreHits(truth: { t: number; player: number }[], found: Hit[], tol = 0.25, sideOf: (p: number) => 0 | 1 = sideOfIndex(4)): HitScore {
  const pairs: { i: number; j: number; d: number }[] = [];
  truth.forEach((g, i) => found.forEach((h, j) => {
    const d = Math.abs(g.t - h.t);
    if (d <= tol) pairs.push({ i, j, d });
  }));
  pairs.sort((a, b) => a.d - b.d);
  const ui = new Set<number>(), uj = new Set<number>();
  let right = 0;
  let side = 0;
  for (const { i, j } of pairs) {
    if (ui.has(i) || uj.has(j)) continue;
    ui.add(i);
    uj.add(j);
    if (truth[i].player === found[j].player) right++;
    if (sideOf(truth[i].player) === sideOf(found[j].player)) side++;
  }
  const m = ui.size;
  return {
    truth: truth.length,
    found: found.length,
    matched: m,
    rightPlayer: right,
    rightSide: side,
    precision: found.length ? m / found.length : 1,
    recall: truth.length ? m / truth.length : 1,
    attribution: m ? right / m : 1,
    side: m ? side / m : 1,
  };
}

/** Glue for one simulated frame: greyscale analysis copy + person boxes with colour fingerprints. */
export function engineInput(f: SimFrame, w: number, h: number, gray?: Uint8Array) {
  const g = toGray(f.rgba, w, h, gray);
  const persons: Detection[] = f.persons.map((d) => ({ ...d, look: partLooks(f.rgba, w, h, d.box) }));
  return { t: f.t, gray: g, gw: w, gh: h, persons, onsets: f.onsets };
}

/**
 * The AI pose layer, emulated on the simulator as the browser runs it: each
 * detection frame, poses for `count` of the engine's players in turn, each
 * from a crop around the box the engine holds for them (so the pose belongs to
 * whoever is really in that box).
 */
export class SimPoseFeed {
  private turn = 0;
  feed(engine: MatchEngine, f: SimFrame, count = 2) {
    if (!f.poses) return;
    const boxes = engine.playerBoxes();
    const n = boxes.length;
    let done = 0;
    for (let k = 0; k < n && done < count; k++) {
      const i = (this.turn + k) % n;
      const b = boxes[i];
      if (!b) continue;
      let best: (typeof f.poses)[number] | null = null;
      let bestO = 0.3;
      for (const p of f.poses) {
        const o = iou(p.box, b);
        if (o > bestO) [best, bestO] = [p, o];
      }
      done++;
      if (best) engine.addPose(i, f.t, best.kp);
    }
    this.turn = (this.turn + Math.max(1, count)) % Math.max(1, n);
  }
}

export type SimRunResult = {
  hits: HitScore;
  /** Fraction of tracked player-frames where the player is within 0.8 m of the right person. */
  identity: number;
  swapsOpen: number;
  quality: number;
  breakdown: Record<Hit["status"], number>;
  distanceError: number;
  /** Mean distance (m) between a correctly identified player's tracked and true position. */
  positionError: number;
  /** Seconds the camera-moved warning was up (whole run). */
  movedFor: number;
  frames: number;
};

/**
 * Simulates `seconds` of a game and runs the engine on it (court set from 6
 * slightly imprecise taps, as an assistant would). Analysis at the render size.
 */
export function runSim(opts: SimOptions & { audio?: boolean }, seconds: number, useTruthCamera = false, collect?: { f: number[]; y: 0 | 1 }[], checker?: import("./checker.ts").CheckerWeights | null): SimRunResult {
  const audio = opts.audio ?? true;
  const sim = new MatchSim(opts);
  const w = opts.w, h = opts.h;
  const cam = useTruthCamera ? sim.cam : fitCamera(sim.taps(6), w, h, LENS_PRIOR[opts.lens ?? "wide"]);
  if (!cam) throw new Error("calibration failed");
  // The 3D camera uses the iPhone field-of-view prior, not the simulator's exact value (69° / 108°).
  const slots = opts.singles ? SINGLES_SLOTS : DOUBLES_SLOTS;
  const engine = new MatchEngine({ cam, videoW: w, videoH: h, courtPoints: 6, lens: opts.lens ?? "wide", audioOn: audio, slots, checker });
  if (collect) engine.collect = collect;
  const n = slots.length;
  const poseFeed = new SimPoseFeed();
  const gray = new Uint8Array(w * h);
  let idOk = 0, idAll = 0, posErr = 0, movedFrames = 0;
  const truthPath: { x: number; y: number }[][] = slots.map(() => []);
  const frames = Math.round(seconds * (opts.fps ?? 30));
  for (let k = 0; k < frames; k++) {
    const f = sim.step();
    // Detector at half the frame rate, like a phone.
    const inp = engineInput(f, w, h, gray);
    // The pose layer runs on detection frames, before the frame is processed (as in the browser).
    if (k % 2 === 0) poseFeed.feed(engine, f);
    engine.process({ ...inp, persons: k % 2 === 0 ? inp.persons : undefined, onsets: audio ? inp.onsets : [] });
    if (engine.cameraMoved) movedFrames++;
    f.truth.players.forEach((p, i) => truthPath[i].push(p));
    if (k % 2 === 0 && engine.identity.ready) {
      engine.view(f.t).players.forEach((pv, i) => {
        if (!pv.pos) return;
        idAll++;
        const d = f.truth.players.map((q) => Math.hypot(q.x - pv.pos!.x, q.y - pv.pos!.y));
        const nearest = d.indexOf(Math.min(...d));
        if (nearest === i && d[i] < 0.8) {
          idOk++;
          posErr += d[i];
        }
      });
    }
  }
  const fin = engine.finish();
  const hits = scoreHits(sim.hits, engine.fusion.hits, 0.25, sideOfIndex(n));
  const truthDist = truthPath.map((path) => path.reduce((a, p, i) => (i ? a + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0));
  const distErr = fin.players.reduce((a, p, i) => a + Math.abs(p.distance - truthDist[i]) / Math.max(1, truthDist[i]), 0) / n;
  return {
    hits,
    identity: idAll ? idOk / idAll : 0,
    swapsOpen: 0,
    quality: fin.quality,
    breakdown: fin.breakdown,
    distanceError: distErr,
    positionError: idOk ? posErr / idOk : 0,
    movedFor: movedFrames / (opts.fps ?? 30),
    frames,
  };
}
