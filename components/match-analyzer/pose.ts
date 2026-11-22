// AI pose layer for Wolf Vision: MediaPipe Pose Landmarker (lite, ~5.8 MB,
// Apache-2.0) run on each player's crop, on the device. It gives the racket
// arm (shoulder, elbow, wrist) so the engine can tell a real stroke from
// footwork and say whose racket was nearest the shuttle at a contact, and the
// feet (heels, toes, ankles), so a player is placed where they stand on the
// court rather than at the bottom edge of their box.
// Two players per detector frame, in turn: each player gets a pose several
// times a second without doubling the phone's load.
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Box } from "@/lib/match-analyzer";
import type { PoseKeypoints } from "@/lib/ma/engine";

const WASM_BASE = "/mediapipe";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

let posePromise: Promise<PoseLandmarker> | null = null;

/** Loads the pose model once per page; null if it cannot load (the tracker carries on without it). */
export function loadPose(useGpu: boolean): Promise<PoseLandmarker> {
  if (!posePromise) {
    posePromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const make = (delegate: "GPU" | "CPU") =>
        PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: "IMAGE", numPoses: 1, minPoseDetectionConfidence: 0.3 });
      if (!useGpu) return make("CPU");
      try {
        return await make("GPU");
      } catch {
        return make("CPU");
      }
    })();
    posePromise.catch(() => {
      posePromise = null;
    });
  }
  return posePromise;
}

const IDX = { shoulders: [11, 12], elbows: [13, 14], wrists: [15, 16], hips: [23, 24], ankles: [27, 28], heels: [29, 30], toes: [31, 32] } as const;

/** Runs the pose model on crops of the players' boxes and returns keypoints in video pixels. */
export class PoseRunner {
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private turn = 0;
  private readonly model: PoseLandmarker;

  constructor(model: PoseLandmarker) {
    this.model = model;
    this.canvas.width = 192;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext("2d")!;
  }

  /** Poses for up to `count` players this frame (taking turns). */
  run(source: CanvasImageSource, srcW: number, srcH: number, boxes: (Box | null)[], count = 2): { player: number; kp: PoseKeypoints }[] {
    const out: { player: number; kp: PoseKeypoints }[] = [];
    const n = boxes.length;
    for (let k = 0; k < n && out.length < count; k++) {
      const i = (this.turn + k) % n;
      const b = boxes[i];
      if (!b || b[3] < 24) continue;
      // Box grown by a quarter (raised arms and the racket stick out), 3:4 like the model's input.
      const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
      const h = b[3] * 1.3, w = Math.max(b[2] * 1.5, h * 0.75);
      const x0 = cx - w / 2, y0 = cy - h / 2;
      this.ctx.fillStyle = "#000";
      this.ctx.fillRect(0, 0, 192, 256);
      try {
        // Clamp the source rectangle to the picture (Safari draws nothing for one that runs past the edge).
        const sx0 = Math.max(0, x0), sy0 = Math.max(0, y0), sx1 = Math.min(srcW, x0 + w), sy1 = Math.min(srcH, y0 + h);
        if (sx1 - sx0 < 8 || sy1 - sy0 < 8) continue;
        const kx = 192 / w, ky = 256 / h;
        this.ctx.drawImage(source, sx0, sy0, sx1 - sx0, sy1 - sy0, (sx0 - x0) * kx, (sy0 - y0) * ky, (sx1 - sx0) * kx, (sy1 - sy0) * ky);
        const res = this.model.detect(this.canvas);
        const lm = res.landmarks[0];
        if (!lm) continue;
        const pick = (ids: readonly number[]) => ids.map((j) => [x0 + lm[j].x * w, y0 + lm[j].y * h, lm[j].visibility ?? 1] as [number, number, number]);
        out.push({
          player: i,
          kp: { shoulders: pick(IDX.shoulders), elbows: pick(IDX.elbows), wrists: pick(IDX.wrists), hips: pick(IDX.hips), ankles: pick(IDX.ankles), heels: pick(IDX.heels), toes: pick(IDX.toes) },
        });
      } catch {
        /* a frame the model could not read: skip */
      }
    }
    this.turn = (this.turn + Math.max(1, count)) % Math.max(1, n);
    return out;
  }
}
