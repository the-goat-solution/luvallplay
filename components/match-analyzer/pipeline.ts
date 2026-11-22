// Browser glue for the automatic engine: grabs each frame from the phone
// camera, an uploaded video or the simulator, runs person detection (every
// other frame, never more than half the main thread), computes colour
// fingerprints, collects impact sounds, and feeds lib/ma/engine.ts.
import type { ObjectDetector } from "@mediapipe/tasks-vision";
import type { Detection } from "@/lib/match-analyzer";
import { MatchEngine } from "@/lib/ma/engine";
import { OnsetDetector, onsetsFromSamples, type Onset } from "@/lib/ma/audio";
import { partLooks, toGray } from "@/lib/ma/imaging";
import type { MatchSim, SimFrame } from "@/lib/ma/sim";
import { detectPeople } from "./detector";
import { fromCrop, mergeDetections } from "@/lib/ma/detections";
import type { PoseRunner } from "./pose";
import { SimPoseFeed } from "@/lib/ma/simrun";

/** Analysis frame width: enough for a shuttle at the far baseline, light enough for an iPhone 14. */
export const ANALYSIS_W = 640;

export type FrameSource =
  | { kind: "video"; video: HTMLVideoElement; clock: () => number }
  | { kind: "sim"; sim: MatchSim; canvas: HTMLCanvasElement };

export class Pipeline {
  readonly engine: MatchEngine;
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private gray: Uint8Array | null = null;
  private detector: ObjectDetector | null;
  private frameNo = 0;
  private busyUntil = 0;
  private pendingOnsets: Onset[] = [];
  private offlineOnsets: Onset[] = [];
  private offlineIdx = 0;
  /** Live camera: detection gets at most half the main thread. Off for uploads. */
  realtime = true;
  /** Run the person detector on every Nth frame (set by the throttle). */
  detectEvery = 2;
  /** Far half of the court (video px) for the second, closer detector pass; null = no second pass. */
  private farRoi: [number, number, number, number] | null;
  private farCanvas: HTMLCanvasElement | null = null;
  /** AI pose layer (set once the model has loaded; the tracker runs without it until then). */
  pose: PoseRunner | null = null;
  /** Test scenario: the simulator's emulated pose model, fed like the real one. */
  private simPose = new SimPoseFeed();
  /** Last simulator frame (ground truth for the test scenario). */
  lastSimFrame: SimFrame | null = null;
  readonly vw: number;
  readonly vh: number;

  constructor(engine: MatchEngine, vw: number, vh: number, detector: ObjectDetector | null) {
    this.engine = engine;
    this.vw = vw;
    this.vh = vh;
    this.detector = detector;
    const aw = ANALYSIS_W;
    const ah = Math.round((vh / vw) * aw);
    this.canvas.width = aw;
    this.canvas.height = ah;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    this.farRoi = engine.farRoi();
    if (this.farRoi) {
      this.farCanvas = document.createElement("canvas");
      this.farCanvas.width = 640;
      this.farCanvas.height = 360;
    }
  }

  /** Impact sounds from the live microphone (added as they are heard). */
  pushOnset(o: Onset) {
    this.pendingOnsets.push(o);
  }

  /** Impact sounds found in an uploaded video's audio track, delivered as playback reaches them. */
  setOfflineOnsets(list: Onset[]) {
    this.offlineOnsets = [...list].sort((a, b) => a.t - b.t);
    this.offlineIdx = 0;
  }

  /** Short names of the AI models running in this session (shown on the overlay). */
  aiLayers(): string[] {
    const out: string[] = [];
    if (this.detector) out.push(this.farRoi ? "DETECT ×2" : "DETECT");
    if (this.engine.poseCount > 0) out.push("POSE");
    if (this.engine.checker) out.push("SHUTTLE AI");
    if (this.engine.training.trained > 0) out.push(`SELF-TRAIN ${this.engine.training.trained}`);
    return out;
  }

  /** Processes one frame from the source at time t (seconds). */
  step(src: FrameSource, t: number): { ms: number; detected: boolean } {
    const began0 = performance.now();
    const aw = this.canvas.width, ah = this.canvas.height;
    let persons: Detection[] | undefined;
    let onsets: Onset[] = [];
    if (src.kind === "sim") {
      const f = src.sim.step();
      this.lastSimFrame = f;
      // Show it big, analyse it small (as with a real camera).
      const big = src.canvas.getContext("2d")!;
      const img = new ImageData(new Uint8ClampedArray(f.rgba), src.sim.W, src.sim.H);
      big.putImageData(img, 0, 0);
      this.ctx.drawImage(src.canvas, 0, 0, aw, ah);
      t = f.t;
      if (this.frameNo % this.detectEvery === 0) {
        persons = f.persons;
        this.simPose.feed(this.engine, f);
      }
      onsets = f.onsets;
    } else {
      this.ctx.drawImage(src.video, 0, 0, aw, ah);
    }
    const rgba = this.ctx.getImageData(0, 0, aw, ah).data;
    this.gray = toGray(rgba, aw, ah, this.gray ?? undefined);
    const sx = aw / this.vw, sy = ah / this.vh;
    // Live: keep half the main thread free. Uploads: every other frame, always
    // (playback slows down instead, so results don't depend on the device).
    if (src.kind === "video" && this.detector && this.frameNo % this.detectEvery === 0 && (!this.realtime || performance.now() >= this.busyUntil)) {
      const began = performance.now();
      persons = detectPeople(this.detector, this.canvas).map((d) => ({ ...d, box: [d.box[0] / sx, d.box[1] / sy, d.box[2] / sx, d.box[3] / sy] as Detection["box"] }));
      // Second, closer pass on the far half of the court, from the full-resolution frame.
      if (this.farRoi && this.farCanvas) {
        const [rx, ry, rw, rh] = this.farRoi;
        const fc = this.farCanvas.getContext("2d")!;
        fc.drawImage(src.video, rx, ry, rw, rh, 0, 0, this.farCanvas.width, this.farCanvas.height);
        const far = fromCrop(detectPeople(this.detector, this.farCanvas), this.farRoi, this.farCanvas.width, this.farCanvas.height);
        persons = mergeDetections(persons, far, this.farRoi);
      }
      if (this.pose) {
        for (const r of this.pose.run(src.video, this.vw, this.vh, this.engine.playerBoxes(), 2)) this.engine.addPose(r.player, t, r.kp);
      }
      // Keep half the main thread free (taps and drawing stay smooth on slower phones).
      this.busyUntil = performance.now() + (performance.now() - began);
    }
    if (persons) {
      persons = persons.map((d) => ({ ...d, look: partLooks(rgba, aw, ah, [d.box[0] * sx, d.box[1] * sy, d.box[2] * sx, d.box[3] * sy]) }));
    }
    while (this.offlineIdx < this.offlineOnsets.length && this.offlineOnsets[this.offlineIdx].t <= t) onsets.push(this.offlineOnsets[this.offlineIdx++]);
    if (this.pendingOnsets.length) {
      onsets.push(...this.pendingOnsets);
      this.pendingOnsets = [];
    }
    this.engine.process({ t, gray: this.gray, gw: aw, gh: ah, persons, onsets });
    this.frameNo++;
    return { ms: performance.now() - began0, detected: !!persons };
  }
}

/** Live microphone → impact onsets, timed on the same clock as the camera. */
export class MicListener {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  ok = false;

  async start(onOnset: (o: Onset) => void, clock: () => number): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const src = this.ctx.createMediaStreamSource(this.stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0;
      src.connect(an);
      const det = new OnsetDetector(this.ctx.sampleRate, an.fftSize);
      const db = new Float32Array(an.frequencyBinCount);
      const mags = new Float32Array(an.frequencyBinCount);
      const loop = () => {
        this.raf = requestAnimationFrame(loop);
        an.getFloatFrequencyData(db);
        for (let k = 0; k < db.length; k++) mags[k] = Math.pow(10, db[k] / 20);
        const o = det.push(clock(), mags);
        if (o) onOnset(o);
      };
      loop();
      this.ok = true;
      return true;
    } catch {
      this.ok = false;
      return false;
    }
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.ok = false;
  }
}

/** Impact onsets from an uploaded file's audio track (decoded once, before analysis). */
export async function onsetsFromFile(file: File): Promise<Onset[] | null> {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const ch = buf.getChannelData(0);
    // 16 kHz mono is plenty for 1.5–7 kHz impacts.
    const factor = Math.max(1, Math.floor(buf.sampleRate / 16000));
    const mono = new Float32Array(Math.floor(ch.length / factor));
    for (let i = 0; i < mono.length; i++) mono[i] = ch[i * factor];
    ctx.close().catch(() => {});
    return onsetsFromSamples(mono, buf.sampleRate / factor);
  } catch {
    return null;
  }
}
