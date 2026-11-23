// The automatic Match Analyzer engine: one object that takes every camera
// frame (a small greyscale copy), the person detections when the detector
// ran, and audio onsets, and keeps players, shuttle, hits, rallies and
// quality up to date. Pure TypeScript: the browser feeds it from the phone
// camera, the tests and the preview "test scenario" feed it from the
// simulator (lib/ma/sim.ts).

import {
  COURT,
  MotionTracker,
  computeMotion,
  groupRallies,
  motionAt,
  movementBetween,
  onCourt,
  rallyReadout,
  summarise,
  type Box,
  type Detection,
  type MatchSummary,
  type Motion,
  type Pt,
  type RallyReadout,
  type TrackPoint,
} from "../match-analyzer.ts";
import { HitFusion, acceptThreshold, expectedRecall, type Cue, type FusionContext, type Hit } from "./hits.ts";
import { DOUBLES_SLOTS, IdentityTracker, type PersonObs, type Slot } from "./identity.ts";
import { brightness, estimateShift, findBlobs, maskCount, motionMask, noiseSigma, projections } from "./imaging.ts";
import { courtToImage, imageToCourt, metresPerPixel, type CourtCamera } from "./lens.ts";
import type { Onset } from "./audio.ts";
import { QualityMeter, courtFactor, resolutionFactor, type QualityFactors } from "./quality.ts";
import { ShuttleChecker, patchFeatures, type CheckerWeights } from "./checker.ts";
import { SHUTTLE_CHECKER } from "./models/shuttle-checker.ts";
import { BackgroundActivity, ShuttleTracker, shuttleCandidates, type ShuttlePoint, type TrajCue } from "./shuttle.ts";
import { HFOV_PRIOR, cameraFromHomography, fitFromPoint, project3, rayNearPlayer, type Camera3D } from "./flight.ts";
import type { LensPreset } from "./lens.ts";

export type EngineFrame = {
  /** Seconds (camera clock). */
  t: number;
  /** Small greyscale analysis frame. */
  gray: Uint8Array;
  gw: number;
  gh: number;
  /** People found in this frame (video pixels), or undefined when the detector did not run. */
  persons?: Detection[];
  /** Impact sounds heard since the last frame. */
  onsets?: Onset[];
};

export type EngineOptions = {
  cam: CourtCamera;
  videoW: number;
  videoH: number;
  slots?: Slot[];
  /** Taps used for the court (for the court quality factor). */
  courtPoints?: number;
  /** Impact sounds are being listened to. */
  audioOn?: boolean;
  /** Which iPhone lens (for the field-of-view prior of the 3D camera). */
  lens?: LensPreset;
  /** Horizontal field of view in degrees, when known exactly (overrides the lens prior). */
  hfov?: number;
  /** AI shuttle checker weights (the shared model); undefined = the bundled ones, null = no checker. */
  checker?: CheckerWeights | null;
  /** Auto-training: adapt the checker to this session from the tracker's own labels. Default on. */
  autoTrain?: boolean;
};

/** Body keypoints of one player from the AI pose layer (video px): shoulders, elbows, wrists, hips as [x, y, visibility]. */
export type PoseKeypoints = {
  shoulders: [number, number, number][];
  elbows: [number, number, number][];
  wrists: [number, number, number][];
  hips: [number, number, number][];
};
type PoseSample = { t: number; kp: PoseKeypoints; torso: number; speed: number };

export type PlayerView = { pos: Pt | null; box: Box | null; conf: number; tracked: boolean; speed: number };

export type EngineView = {
  t: number;
  players: PlayerView[];
  shuttle: ShuttlePoint[];
  hits: Hit[];
  rally: RallyReadout | null;
  quality: { q: number; factors: QualityFactors; threshold: number; recall: number; audio: boolean };
  estimate: ReturnType<HitFusion["estimate"]>;
  waiting: number;
  /** Seconds since tracking started. */
  elapsed: number;
};

type SwingState = { hist: { t: number; e: number }[]; peak: { t: number; z: number } | null; lastT: number; events: { t: number; s: number }[] };

const RALLY_GAP = 3.5;


/**
 * Same picture as the previous frame: practically no sampled pixel changed by
 * more than 3 grey levels (a real new frame has sensor or compression noise
 * everywhere, and something moving).
 */
function isRepeat(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let changed = 0, n = 0;
  for (let i = 0; i < a.length; i += 7) {
    if (Math.abs(a[i] - b[i]) > 3) changed++;
    n++;
  }
  return changed < n * 0.0005;
}

export class MatchEngine {
  readonly identity: IdentityTracker;
  readonly fusion = new HitFusion();
  readonly quality = new QualityMeter();
  readonly shuttle: ShuttleTracker;
  private cam: CourtCamera;
  private readonly W: number;
  private readonly H: number;
  private readonly slots: Slot[];
  private frames: { t: number; g: Uint8Array; proj: ReturnType<typeof projections>; shift: { dx: number; dy: number } }[] = [];
  private ref: ReturnType<typeof projections> | null = null;
  private frameNo = 0;
  private mask: Uint8Array | null = null;
  private swings: SwingState[];
  private boxHist: { t: number; box: Box }[][];
  private raw: (TrackPoint | null)[][];
  private times: number[] = [];
  private trackers: MotionTracker[];
  private startT: number | null = null;
  private lastT = 0;
  private breaks: number[] = [];
  private bodies: Box[] = [];
  private background: BackgroundActivity | null = null;
  /** AI layer: probability that a motion blob is the shuttle. */
  readonly checker: ShuttleChecker | null;
  private readonly autoTrain: boolean;
  private nextCid = 1;
  private feats = new Map<number, { t: number; f: Float32Array }>();
  /** Self-labelled samples seen this session (positives, negatives) and those trained on. */
  readonly training = { pos: 0, neg: 0, trained: 0 };
  /** AI pose layer: recent keypoints per player, and swing events found from the racket arm. */
  private poses: PoseSample[][] = [];
  private poseSwing: { hist: number[]; lastT: number; peak: { t: number; s: number } | null }[] = [];
  /** Pose samples received this session (shown as an active AI layer). */
  poseCount = 0;
  /** Labelled feature vectors kept for offline training (harness), when enabled. */
  collect: { f: number[]; y: 0 | 1 }[] | null = null;
  private backgroundW = 0;
  private bodiesT = -Infinity;
  private audioOn: boolean;
  private cam3: Camera3D | null;

  /** Whether impact sounds are being heard (a "no sound" then counts against a hit). Off if the mic or the file's audio fails. */
  setAudio(on: boolean) {
    this.audioOn = on;
  }

  constructor(opts: EngineOptions) {
    this.cam = { ...opts.cam, shift: { x: 0, y: 0 } };
    this.W = opts.videoW;
    this.H = opts.videoH;
    this.slots = opts.slots ?? DOUBLES_SLOTS;
    this.audioOn = opts.audioOn ?? true;
    this.cam3 = cameraFromHomography(opts.cam.toImage, opts.videoW, opts.videoH, opts.hfov ?? HFOV_PRIOR[opts.lens ?? "wide"]);
    this.identity = new IdentityTracker(this.slots);
    this.identity.centreX = (p) => courtToImage(this.cam, { x: COURT.width / 2, y: p.y }).x;
    this.shuttle = new ShuttleTracker({ width: this.W });
    this.poses = this.slots.map(() => []);
    this.poseSwing = this.slots.map(() => ({ hist: [], lastT: -Infinity, peak: null }));
    const w = opts.checker === undefined ? SHUTTLE_CHECKER : opts.checker;
    this.checker = w ? new ShuttleChecker(w) : opts.autoTrain ? new ShuttleChecker(null) : null;
    this.autoTrain = opts.autoTrain ?? true;
    this.swings = this.slots.map(() => ({ hist: [], peak: null, lastT: -Infinity, events: [] }));
    this.boxHist = this.slots.map(() => []);
    this.raw = this.slots.map(() => []);
    this.trackers = this.slots.map(() => new MotionTracker());
    this.quality.court = courtFactor((opts.cam.rms * 1920) / opts.videoW, opts.courtPoints ?? 4);
    // A 7 cm shuttle at the far baseline, in a 480-wide analysis frame.
    const far = courtToImage(this.cam, { x: 3.05, y: 13.4 });
    const mpp = metresPerPixel(this.cam, far);
    this.quality.resolution = resolutionFactor((0.07 / Math.max(1e-6, mpp)) * (480 / this.W));
  }

  get camera(): CourtCamera {
    return this.cam;
  }

  get players(): number {
    return this.slots.length;
  }

  /** Feeds one frame. */
  process(f: EngineFrame) {
    if (this.startT === null) this.startT = f.t;
    this.lastT = f.t;
    const scale = f.gw / this.W;
    const prev = this.frames[this.frames.length - 1];
    // A repeated frame (frame-rate conversion, a screen recording, a stalled camera) says
    // nothing about motion and would blank the three-frame difference around it: skip it
    // for motion, keep it for people and sounds.
    if (prev && isRepeat(prev.g, f.gray)) {
      if (f.persons) this.updatePeople(f.t, f.persons);
      for (const o of f.onsets ?? []) this.fusion.addCue({ t: o.t, kind: "audio", strength: o.strength });
      this.fusion.update(f.t, this.context());
      return;
    }
    const proj = projections(f.gray, f.gw, f.gh);
    let shift = { dx: 0, dy: 0 };
    if (prev) {
      const s = estimateShift(prev.proj, proj, 6);
      if (s.score > 0.5) shift = { dx: s.dx, dy: s.dy };
    }
    // Own copy: callers reuse their buffer between frames.
    const recycled = this.frames.length >= 3 ? this.frames.shift()!.g : null;
    const g = recycled && recycled.length === f.gray.length ? recycled : new Uint8Array(f.gray.length);
    g.set(f.gray);
    this.frames.push({ t: f.t, g, proj, shift });
    // Drift against the calibration frame (a bumped tripod): re-measured every half second.
    if (!this.ref) this.ref = proj;
    if (this.frameNo++ % 15 === 0) {
      const d = estimateShift(this.ref, proj, 20);
      if (d.score > 0.6) this.cam = { ...this.cam, shift: { x: d.dx / scale, y: d.dy / scale } };
    }

    // Light and shake.
    const br = brightness(f.gray);
    const noise = prev ? noiseSigma(prev.g, f.gray, shift.dx, shift.dy, f.gw) : 3;
    this.quality.push(br.mean, br.std, noise, Math.hypot(shift.dx, shift.dy));

    // People: positions, identities, motion history.
    if (f.persons) this.updatePeople(f.t, f.persons);

    // Motion between the last three frames: shuttle and swings (at the middle frame's time).
    if (this.frames.length === 3) {
      const [a, b, c] = this.frames;
      const thr = Math.max(12, 3.5 * noise);
      const shake = Math.hypot(b.shift.dx, b.shift.dy) + Math.hypot(c.shift.dx, c.shift.dy);
      const edgeGain = Math.min(1.2, 0.3 + 0.35 * shake);
      this.mask = motionMask(a.g, b.g, c.g, f.gw, f.gh, thr, { dx: -b.shift.dx, dy: -b.shift.dy }, { dx: c.shift.dx, dy: c.shift.dy }, this.mask ?? undefined, edgeGain);
      const boxes = this.currentBoxes();
      const blobs = findBlobs(this.mask, f.gw, f.gh, b.g);
      if (blobs) {
        // Every person's body is masked (bystanders too), the four players' reach zones are not.
        const bodies = f.t - this.bodiesT < 0.5 ? this.bodies : [];
        const allBodies = [...boxes.filter((x): x is Box => !!x), ...bodies];
        if (!this.background || this.backgroundW !== f.gw) {
          this.background = new BackgroundActivity(f.gw, f.gh);
          this.backgroundW = f.gw;
        }
        const cands = shuttleCandidates(blobs, scale, allBodies, f.gw * f.gh, this.background);
        this.background.add(blobs, allBodies, scale);
        // AI layer: the checker scores each candidate; the tracker's outcome later labels it.
        const trusted = this.checker && this.checker.n >= 500;
        const kept: typeof cands = [];
        for (const cd of cands) {
          cd.id = this.nextCid++;
          const fv = patchFeatures(a.g, b.g, c.g, f.gw, f.gh, cd.ax, cd.ay, cd, undefined, thr);
          this.feats.set(cd.id, { t: b.t, f: fv });
          // The checker's verdict travels with the candidate: the tracker uses it to decide
          // whether a track is a real flight (it must not remove candidates: at a contact the
          // shuttle overlaps the racket, and those points make the hit cue).
          if (trusted) cd.p = this.checker!.predict(fv);
          kept.push(cd);
        }
        cands.length = 0;
        cands.push(...kept);
        for (const [id, v] of this.feats) if (b.t - v.t > 4) this.feats.delete(id);
        const cues = this.shuttle.update(b.t, cands, boxes.filter((x): x is Box => !!x));
        this.learnFromTracker();
        for (const cue of cues) {
          this.fusion.addCue({ t: cue.t, kind: "traj", strength: cue.strength, x: cue.x, y: cue.y, playerFit: this.contactFit(cue) });
        }
      }
      this.updateSwings(b.t, boxes, scale, f.gw, f.gh);
    }

    for (const o of f.onsets ?? []) this.fusion.addCue({ t: o.t, kind: "audio", strength: o.strength });

    // Identity confidence feeds the quality score.
    const confs = this.identity.players.map((p) => (p.kf ? p.conf : 0));
    this.quality.identity = this.identity.ready ? confs.reduce((x, y) => x + y, 0) / confs.length : 0.5;
    this.fusion.update(f.t, this.context());
  }

  /**
   * 3D check of who could have made this contact (player-anchored flight
   * hypotheses). For each player: put the contact on the camera ray where it
   * passes their position; it must be at a body-possible height (0.2–3.4 m)
   * and reach (≤ 1.6 m), and a drag-ballistic flight from (and to) that point
   * must explain the tracked shuttle. Returns a 0…1 plausibility per player.
   */
  private contactFit(cue: TrajCue): number[] | undefined {
    if (!this.cam3) return undefined;
    const fits: number[] = [];
    let any = false;
    for (let i = 0; i < this.slots.length; i++) {
      const pos = this.positionAt(i, cue.t);
      if (!pos) {
        fits.push(NaN);
        continue;
      }
      const { P, horiz } = rayNearPlayer(this.cam3, this.cam, { x: cue.x, y: cue.y }, pos);
      if (P[2] < 0.2 || P[2] > 3.4 || horiz > 1.6) {
        fits.push(Infinity);
        any = true;
        continue;
      }
      let e = 0;
      let n = 0;
      if (cue.after.length >= 4) {
        e += fitFromPoint(this.cam3, this.cam, P, cue.t, cue.after.filter((p) => p.t > cue.t).slice(0, 10));
        n++;
      }
      if (cue.before.length >= 4) {
        e += fitFromPoint(this.cam3, this.cam, P, cue.t, cue.before.filter((p) => p.t < cue.t).slice(-10), true);
        n++;
      }
      fits.push(n ? e / n : 1);
      any = true;
    }
    const finite = fits.filter((v) => Number.isFinite(v));
    // Nobody could have made it (the cue point is not the real contact): no information.
    if (!any || finite.length === 0) return undefined;
    const best = finite.length ? Math.min(...finite) : 0;
    const scale = (1.2 * this.W) / 640;
    return fits.map((v) => (Number.isNaN(v) ? 0.5 : !Number.isFinite(v) ? 0.08 : Math.exp(-(((v - best) / scale) ** 2))));
  }

  private context(): FusionContext {
    return {
      quality: this.quality.value(),
      sideOf: (p) => this.slots[p].side,
      playersOn: (side) => this.slots.map((s, i) => (s.side === side ? i : -1)).filter((i) => i >= 0),
      players: this.slots.length,
      audioOn: this.audioOn,
      reach: (pl, x, y, t) => {
        // With the pose layer: distance to the racket head (beyond the wrist, along the forearm), in torso lengths.
        const ps = this.poseNear(pl, t, 0.2);
        if (ps) {
          let best = Infinity;
          ps.kp.wrists.forEach((w, k) => {
            if (w[2] < 0.3) return;
            const e = ps.kp.elbows[k];
            const head = e && e[2] >= 0.3 ? [w[0] + (w[0] - e[0]) * 1.3, w[1] + (w[1] - e[1]) * 1.3] : [w[0], w[1]];
            best = Math.min(best, Math.hypot(x - head[0], y - head[1]), Math.hypot(x - w[0], y - w[1]));
          });
          // ~1.3 torso lengths from wrist/racket head counts as in reach (prox 1 at r ≤ 0.8).
          if (Number.isFinite(best)) return best / (1.6 * ps.torso);
        }
        const box = boxAt(this.boxHist[pl], t);
        if (!box) return null;
        // Reach zone: an ellipse around head height and the racket arm. Kept tight
        // vertically so a near player's zone does not swallow the far players above them.
        const cx = box[0] + box[2] / 2;
        const cy = box[1] + box[3] * 0.15;
        const rx = Math.max(box[3] * 0.75, this.W * 0.015);
        const ry = Math.max(box[3] * 0.5, this.W * 0.012);
        return Math.hypot((x - cx) / rx, (y - cy) / ry);
      },
      swingNear: (p, t, w) => Math.max(0, ...this.swings[p].events.filter((e) => Math.abs(e.t - t) <= w).map((e) => e.s)),
    };
  }

  /** The pose sample of a player closest to time t (within w seconds). */
  private poseNear(pl: number, t: number, w: number): PoseSample | null {
    let best: PoseSample | null = null;
    for (const s of this.poses[pl] ?? []) if (Math.abs(s.t - t) <= w && (!best || Math.abs(s.t - t) < Math.abs(best.t - t))) best = s;
    return best;
  }

  /**
   * AI pose layer input: one player's keypoints at time t. The racket arm's
   * speed (fastest wrist, in torso lengths per second, so near and far players
   * compare) is watched for peaks: a stroke whips the wrist to ~8–15 torso/s,
   * a split step or walking stays under ~4. A peak becomes a swing cue for the
   * hit fusion, like the motion-based swing detector's.
   */
  addPose(player: number, t: number, kp: PoseKeypoints) {
    const list = this.poses[player];
    if (!list) return;
    const vis = (p: [number, number, number] | undefined) => !!p && p[2] >= 0.3;
    const sh = kp.shoulders.filter(vis), hp = kp.hips.filter(vis);
    if (!sh.length || !hp.length) return;
    const mid = (a: [number, number, number][]) => [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
    const [sx, sy] = mid(sh), [hx, hy] = mid(hp);
    const torso = Math.max(4, Math.hypot(sx - hx, sy - hy));
    const prev = list[list.length - 1];
    let speed = 0;
    if (prev && t > prev.t && t - prev.t < 0.4) {
      kp.wrists.forEach((w, k) => {
        const q = prev.kp.wrists[k];
        if (vis(w) && vis(q)) speed = Math.max(speed, Math.hypot(w[0] - q[0], w[1] - q[1]) / (t - prev.t) / torso);
      });
    }
    list.push({ t, kp, torso, speed });
    while (list.length && t - list[0].t > 3) list.shift();
    this.poseCount++;
    // Peak picking on the wrist speed.
    const st = this.poseSwing[player];
    if (st.peak && speed < st.peak.s * 0.7) {
      const pk = st.peak;
      st.peak = null;
      if (pk.s >= 6 && pk.t - st.lastT > 0.35) {
        st.lastT = pk.t;
        const strength = Math.min(1, (pk.s - 4) / 8);
        this.swings[player].events.push({ t: pk.t, s: strength });
        this.fusion.addCue({ t: pk.t, kind: "swing", strength, player });
      }
    } else if (speed >= 6 && (!st.peak || speed > st.peak.s)) {
      st.peak = { t, s: speed };
    }
  }

  /** Current boxes of the four players (video px), for the pose layer's crops. */
  playerBoxes(): (Box | null)[] {
    return this.currentBoxes();
  }

  /**
   * Auto-training: the tracker's verdicts become labels for the checker. Every
   * positive is used; negatives (far more numerous) one in three, so the two
   * classes stay balanced. Small steps: a session nudges, it does not rewrite.
   */
  private learnFromTracker() {
    const labels = this.shuttle.labels;
    if (!labels.length) return;
    this.shuttle.labels = [];
    for (const { id, y } of labels) {
      const s = this.feats.get(id);
      if (!s) continue;
      this.feats.delete(id);
      if (y) this.training.pos++;
      else {
        this.training.neg++;
        if (this.training.neg % 3) continue;
      }
      this.collect?.push({ f: Array.from(s.f, (v) => Math.round(v * 1000) / 1000), y });
      if (this.checker && this.autoTrain) {
        // Anchored, small steps: self-labels are right ~60% (flights) and ~98% (fragments) of the time.
        this.checker.train(s.f, y, 0.002, 0.02, y ? 0.6 : 1);
        this.training.trained++;
      }
    }
  }

  /**
   * Where to look closer for the far pair: the far half of the court (and a
   * little around it) up to head height, in video pixels. Far players are only
   * ~15 px tall in a 640-wide frame from behind a baseline, too small for the
   * person detector; running it again on this crop makes them 2–3× bigger.
   * Null when the crop would not be much smaller than the frame.
   */
  farRoi(): Box | null {
    if (!this.cam3) return null;
    const pts: Pt[] = [];
    for (const x of [-1, COURT.width + 1])
      for (const y of [COURT.net - 0.5, COURT.length + 1.5])
        for (const z of [0, 2.4]) {
          const q = project3(this.cam3, this.cam, [x, y, z]);
          if (q) pts.push(q);
        }
    if (pts.length < 8) return null;
    let x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
    let y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
    // Margin, then the detector's 16:9 shape, inside the frame.
    const mx = (x1 - x0) * 0.08, my = (y1 - y0) * 0.15;
    x0 = Math.max(0, x0 - mx); x1 = Math.min(this.W, x1 + mx); y0 = Math.max(0, y0 - my); y1 = Math.min(this.H, y1 + my);
    let w = x1 - x0, h = y1 - y0;
    if (w / h > 16 / 9) h = w * 9 / 16; else w = h * 16 / 9;
    w = Math.min(w, this.W); h = Math.min(h, this.H);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const bx = Math.max(0, Math.min(this.W - w, cx - w / 2)), by = Math.max(0, Math.min(this.H - h, cy - h / 2));
    if (w > this.W * 0.6) return null; // not worth a second pass
    return [Math.round(bx), Math.round(by), Math.round(w), Math.round(h)];
  }

  /** Height (m) of a person standing at court point p whose box top is at the given image row, from the 3D camera. */
  private standingHeight(p: Pt, box: Box): number | undefined {
    if (!this.cam3) return undefined;
    let lo = 0, hi = 4;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      const q = project3(this.cam3, this.cam, [p.x, p.y, m]);
      if (!q || q.y < box[1]) hi = m;
      else lo = m;
    }
    const h = (lo + hi) / 2;
    return h > 0.05 && h < 3.9 ? h : undefined;
  }

  private currentBoxes(): (Box | null)[] {
    return this.identity.players.map((p) => (p.box && this.lastT - p.lastObsT < 0.6 ? p.box : null));
  }

  private updatePeople(t: number, persons: Detection[]) {
    this.bodies = persons.map((d) => d.box);
    this.bodiesT = t;
    const obs: PersonObs[] = [];
    for (const d of persons) {
      if (d.box[1] + d.box[3] >= this.H * 0.985 || d.box[3] >= this.H * 0.9) continue;
      const foot = { x: d.box[0] + d.box[2] / 2, y: d.box[1] + d.box[3] };
      const p = imageToCourt(this.cam, foot);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !onCourt(p)) continue;
      const mpp = metresPerPixel(this.cam, foot);
      // Where a pixel covers several centimetres of floor (the far half seen from a low or
      // side-on camera), people on the bench just behind the court project inside its
      // margins: there, only confident detections within the lines count.
      if (mpp * (this.W / 1920) > 0.03 && (d.score < 0.4 || p.x < -0.3 || p.x > COURT.width + 0.3 || p.y < -0.3 || p.y > COURT.length + 0.3)) continue;
      // Cut off by the side of the frame: half a person (never picked up as a player).
      const edge = d.box[0] <= this.W * 0.005 || d.box[0] + d.box[2] >= this.W * 0.995;
      obs.push({ box: d.box, score: d.score, look: d.look, p, mpp, h3: this.standingHeight(p, d.box), edge });
    }
    const { assign, swaps } = this.identity.update(t, obs);
    for (const s of swaps) this.applySwap(s.a, s.b, s.from);
    this.times.push(t);
    assign.forEach((j, i) => {
      const tp = j !== null ? { p: obs[j].p, box: obs[j].box } : null;
      this.raw[i].push(tp);
      this.trackers[i].push(t, tp);
      if (j !== null) {
        this.boxHist[i].push({ t, box: obs[j].box });
        while (this.boxHist[i].length && t - this.boxHist[i][0].t > 4) this.boxHist[i].shift();
      }
    });
  }

  /** An identity correction: positions, boxes, swings and hits of a and b since `from` change hands. */
  private applySwap(a: number, b: number, from: number) {
    const k0 = this.times.findIndex((t) => t >= from);
    if (k0 >= 0) {
      for (let k = k0; k < this.times.length; k++) [this.raw[a][k], this.raw[b][k]] = [this.raw[b][k], this.raw[a][k]];
      for (const i of [a, b]) {
        const tr = new MotionTracker();
        this.times.forEach((t, k) => tr.push(t, this.raw[i][k]));
        this.trackers[i] = tr;
      }
    }
    const split = <T extends { t: number }>(h: T[]): [T[], T[]] => [h.filter((x) => x.t < from), h.filter((x) => x.t >= from)];
    const [ba, ba2] = split(this.boxHist[a]);
    const [bb, bb2] = split(this.boxHist[b]);
    this.boxHist[a] = [...ba, ...bb2];
    this.boxHist[b] = [...bb, ...ba2];
    const [sa, sa2] = split(this.swings[a].events);
    const [sb, sb2] = split(this.swings[b].events);
    this.swings[a].events = [...sa, ...sb2];
    this.swings[b].events = [...sb, ...sa2];
    this.fusion.swapPlayers(a, b, from);
  }

  private updateSwings(t: number, boxes: (Box | null)[], scale: number, gw: number, gh: number) {
    boxes.forEach((box, i) => {
      if (!box || !this.mask) return;
      // Racket swing, not running: motion in the upper zone (racket, arm, head; out to the
      // sides where the racket travels) minus motion in the legs. Running, a split-step or
      // a receiver turning at the opponent's hit move the legs; a stroke moves the top.
      const [x, y, w, h] = box.map((v) => v * scale);
      const ux0 = x - 0.6 * w, ux1 = x + 1.6 * w, uy0 = y - 0.45 * h, uy1 = y + 0.3 * h;
      const upper = maskCount(this.mask, gw, gh, ux0, uy0, ux1, uy1) / Math.max(1, (ux1 - ux0) * (uy1 - uy0));
      const legs = maskCount(this.mask, gw, gh, x, y + 0.6 * h, x + w, y + h) / Math.max(1, w * 0.4 * h);
      const e = Math.max(0, upper - 0.8 * legs);
      const st = this.swings[i];
      st.hist.push({ t, e });
      while (st.hist.length && t - st.hist[0].t > 2.5) st.hist.shift();
      if (st.hist.length < 12) return;
      const vals = st.hist.map((s) => s.e).sort((p, q) => p - q);
      const med = vals[Math.floor(vals.length / 2)];
      const mad = vals.map((v) => Math.abs(v - med)).sort((p, q) => p - q)[Math.floor(vals.length / 2)];
      const z = (e - med) / (1.4826 * mad + 0.004);
      if (st.peak && z < st.peak.z) {
        const pk = st.peak;
        st.peak = null;
        const peakE = st.hist.find((s) => s.t === pk.t)?.e ?? 0;
        if (pk.z >= 3 && peakE >= 0.004 && pk.t - st.lastT > 0.35) {
          st.lastT = pk.t;
          const s = Math.min(1, (pk.z - 2.5) / 6);
          st.events.push({ t: pk.t, s });
          while (st.events.length && t - st.events[0].t > 30) st.events.shift();
          const cue: Cue = { t: pk.t, kind: "swing", strength: s, player: i };
          this.fusion.addCue(cue);
        }
      } else if (z >= 3 && (!st.peak || z >= st.peak.z)) {
        st.peak = { t, z };
      }
    });
  }

  // ── Corrections from the assistant ────────────────────────────────────

  /** Pins the person under an image point (video px) to a player. */
  tag(at: Pt, player: number): boolean {
    const obs = this.identity.lastObs;
    let best = -1;
    let bestA = Infinity;
    obs.forEach((o, j) => {
      const [x, y, w, h] = o.box;
      if (at.x >= x - 10 && at.x <= x + w + 10 && at.y >= y - 10 && at.y <= y + h + 10 && w * h < bestA) {
        bestA = w * h;
        best = j;
      }
    });
    if (best < 0) return false;
    const ev = this.identity.force(player, best, this.lastT);
    if (ev) this.applySwap(ev.a, ev.b, ev.from);
    return true;
  }

  addHit(t: number, player: number) {
    this.fusion.addManual(t, player);
  }

  removeHit(t: number) {
    this.fusion.remove(t);
  }

  rallyOver(t: number) {
    this.breaks.push(t);
  }

  // ── Reading results ───────────────────────────────────────────────────

  motion(i: number): Motion {
    return this.trackers[i].motion;
  }

  positionAt = (player: number, t: number): Pt | null => {
    const m = this.trackers[player]?.motion;
    return m && m.t.length ? motionAt(m, t)?.p ?? null : null;
  };

  view(t = this.lastT): EngineView {
    const hits = this.fusion.hits;
    const rallies = groupRallies(hits, RALLY_GAP, this.breaks);
    const rally = rallyReadout(rallies, t, this.slots.length, this.positionAt);
    const q = this.quality.value();
    const players = this.identity.players.map((p, i) => {
      const recent = p.kf && t - p.lastObsT < 1.2;
      const pos = recent ? this.identity.positionAt(i, t) : null;
      const m = this.trackers[i].motion;
      const speed = m.speed.length ? m.speed[m.speed.length - 1] : 0;
      return { pos, box: recent ? p.box : null, conf: p.kf ? p.conf : 0, tracked: !!p.kf, speed };
    });
    return {
      t,
      players,
      shuttle: this.shuttle.trail(t),
      hits,
      rally,
      quality: { q, factors: this.quality.factors(), threshold: acceptThreshold(q), recall: expectedRecall(q, this.audioOn), audio: this.audioOn },
      estimate: this.fusion.estimate(),
      waiting: this.identity.players.filter((p) => !p.kf).length,
      elapsed: this.startT === null ? 0 : t - this.startT,
    };
  }

  /** Per-rally numbers for the player cards: hits, distance and top speed since the serve. */
  rallyStats(t: number): { hits: number[]; distance: number[]; topSpeed: number[] } {
    const rallies = groupRallies(this.fusion.hits, RALLY_GAP, this.breaks);
    const r = rallyReadout(rallies, t, this.slots.length, this.positionAt);
    const n = this.slots.length;
    if (!r) return { hits: new Array(n).fill(0), distance: new Array(n).fill(0), topSpeed: new Array(n).fill(0) };
    const mv = this.trackers.map((tr) => movementBetween(tr.motion, r.start, r.start + r.time));
    return { hits: r.hitsBy, distance: mv.map((m) => m.distance), topSpeed: mv.map((m) => m.topSpeed) };
  }

  /** Final numbers for the whole session (flushes pending candidates). */
  finish(): MatchSummary & { estimate: ReturnType<HitFusion["estimate"]>; breakdown: Record<Hit["status"], number>; quality: number } {
    return this.totals(this.fusion.flush(this.context()));
  }

  /** The numbers so far, without finalising anything (for autosaves during the game). */
  snapshot(): ReturnType<MatchEngine["finish"]> {
    return this.totals(this.fusion.hits);
  }

  private totals(hits: Hit[]): MatchSummary & { estimate: ReturnType<HitFusion["estimate"]>; breakdown: Record<Hit["status"], number>; quality: number } {
    const rallies = groupRallies(hits, RALLY_GAP, this.breaks);
    const t0 = this.startT ?? 0;
    const motions = this.trackers.map((tr) => (tr.motion.t.length ? tr.motion : computeMotion([], [])));
    const s = summarise(motions, hits, rallies, t0, this.lastT, this.positionAt);
    const breakdown = { accepted: 0, inferred: 0, predicted: 0 };
    for (const h of hits) breakdown[h.status]++;
    return { ...s, estimate: this.fusion.estimate(), breakdown, quality: Math.round(this.quality.value() * 100) / 100 };
  }
}

function boxAt(hist: { t: number; box: Box }[], t: number): Box | null {
  let best: { t: number; box: Box } | null = null;
  for (const h of hist) if (!best || Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
  return best && Math.abs(best.t - t) < 0.5 ? best.box : null;
}
