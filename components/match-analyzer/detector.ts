// Person detection for the Match Analyzer, run entirely in the browser with
// MediaPipe's object detector (EfficientDet-Lite0, COCO "person" class). The
// video never leaves the device: frames are read from a hidden <video> and
// only the boxes are kept.
import type { ObjectDetector } from "@mediapipe/tasks-vision";
import type { Detection, Sample } from "@/lib/match-analyzer";

/** Served from our own domain; copied there by scripts/copy-mediapipe.mjs. */
const WASM_BASE = "/mediapipe";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/latest/efficientdet_lite0.tflite";

let detectorPromise: Promise<ObjectDetector> | null = null;

/** Loads the detector once per page (the model is ~7 MB). Tries the GPU, falls back to the CPU. */
export function loadPersonDetector(): Promise<ObjectDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const options = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "IMAGE" as const,
        categoryAllowlist: ["person"],
        scoreThreshold: 0.25,
        maxResults: 16,
      });
      try {
        return await ObjectDetector.createFromOptions(fileset, options("GPU"));
      } catch {
        return await ObjectDetector.createFromOptions(fileset, options("CPU"));
      }
    })();
    detectorPromise.catch(() => {
      detectorPromise = null; // let a retry start from scratch
    });
  }
  return detectorPromise;
}

/** People in a canvas frame, in the canvas's own pixels, each with a shirt-colour histogram. */
export function detectPeople(detector: ObjectDetector, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Detection[] {
  const result = detector.detect(canvas);
  return result.detections
    .filter((d) => d.boundingBox)
    .map((d) => {
      const b = d.boundingBox!;
      const box = [b.originX, b.originY, b.width, b.height] as Detection["box"];
      return { box, score: d.categories[0]?.score ?? 0, look: shirtLook(ctx, box) };
    });
}

const HUE_BINS = 8;
/** Colour histogram of the torso (the middle of the upper half of the box). */
export function shirtLook(ctx: CanvasRenderingContext2D, box: Detection["box"]): number[] | undefined {
  const x = Math.round(box[0] + box[2] * 0.3);
  const y = Math.round(box[1] + box[3] * 0.2);
  const w = Math.round(box[2] * 0.4);
  const h = Math.round(box[3] * 0.28);
  if (w < 2 || h < 2 || x < 0 || y < 0 || x + w > ctx.canvas.width || y + h > ctx.canvas.height) return undefined;
  const data = ctx.getImageData(x, y, w, h).data;
  // 8 hue bins for coloured pixels + dark / mid / light bins for greys.
  const bins = new Array(HUE_BINS + 3).fill(0);
  let total = 0;
  for (let i = 0; i < data.length; i += 8) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max;
    const s = max === 0 ? 0 : (max - min) / max;
    if (s < 0.25 || v < 0.15) {
      bins[HUE_BINS + (v < 0.3 ? 0 : v < 0.7 ? 1 : 2)]++;
    } else {
      let hue = 0;
      const d = max - min;
      if (max === r) hue = ((g - b) / d + 6) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      bins[Math.min(HUE_BINS - 1, Math.floor((hue / 6) * HUE_BINS))]++;
    }
    total++;
  }
  return total ? bins.map((c) => c / total) : undefined;
}

/** Long side of a live frame handed to the detector: smaller is faster on phones. */
const LIVE_DETECT_SIZE = 640;

/** A reusable scratch canvas for live detection. */
export function makeFrameGrabber() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return {
    /** Detects people in the current video frame; boxes come back in video pixels. */
    detect(detector: ObjectDetector, video: HTMLVideoElement, size = LIVE_DETECT_SIZE): Detection[] {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return [];
      const scale = Math.min(1, size / Math.max(vw, vh));
      const w = Math.round(vw * scale), h = Math.round(vh * scale);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);
      return detectPeople(detector, canvas, ctx).map((d) => ({ ...d, box: d.box.map((v) => v / scale) as Detection["box"] }));
    },
  };
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish);
    // A stuck seek (seen on some mobile browsers) must not hang the whole pass.
    window.setTimeout(finish, 3000);
    video.currentTime = t;
  });
}

/** Long side of the frame handed to the detector; 4K phone video is shrunk first. */
const DETECT_SIZE = 1280;

export type AnalyseProgress = { done: number; total: number };

/**
 * Steps through the video `fps` times a second and records every person the
 * detector sees. Box coordinates are in the video's own pixels. Stops early
 * (returning what it has) when `signal` is aborted.
 */
export async function analyseVideo(
  src: string,
  fps: number,
  onProgress: (p: AnalyseProgress, samples: Sample[]) => void,
  signal: AbortSignal,
): Promise<Sample[]> {
  const detector = await loadPersonDetector();
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("video"));
  });
  // Some browsers only decode frames for seeking after playback has started.
  try {
    await video.play();
    video.pause();
  } catch {
    /* autoplay of a muted video can still be refused; seeking usually works anyway */
  }

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(1, DETECT_SIZE / Math.max(vw, vh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const step = 1 / fps;
  const total = Math.max(1, Math.floor(video.duration / step) + 1);
  const samples: Sample[] = [];
  for (let k = 0; k < total; k++) {
    if (signal.aborted) break;
    const t = Math.min(k * step, Math.max(0, video.duration - 0.01));
    await seek(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dets = detectPeople(detector, canvas, ctx).map((d) => ({
      ...d,
      box: d.box.map((v) => v / scale) as Detection["box"],
    }));
    samples.push({ t, dets });
    onProgress({ done: k + 1, total }, samples);
    // Let the page repaint the progress bar.
    if (k % 3 === 0) await new Promise((r) => window.setTimeout(r, 0));
  }
  video.removeAttribute("src");
  video.load();
  return samples;
}
