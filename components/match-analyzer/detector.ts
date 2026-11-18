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

export function detectPeople(detector: ObjectDetector, source: HTMLVideoElement | HTMLCanvasElement): Detection[] {
  const result = detector.detect(source);
  return result.detections
    .filter((d) => d.boundingBox)
    .map((d) => {
      const b = d.boundingBox!;
      return {
        box: [b.originX, b.originY, b.width, b.height] as Detection["box"],
        score: d.categories[0]?.score ?? 0,
      };
    });
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
  onProgress: (p: AnalyseProgress) => void,
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
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;

  const step = 1 / fps;
  const total = Math.max(1, Math.floor(video.duration / step) + 1);
  const samples: Sample[] = [];
  for (let k = 0; k < total; k++) {
    if (signal.aborted) break;
    const t = Math.min(k * step, Math.max(0, video.duration - 0.01));
    await seek(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dets = detectPeople(detector, canvas).map((d) => ({
      ...d,
      box: d.box.map((v) => v / scale) as Detection["box"],
    }));
    samples.push({ t, dets });
    onProgress({ done: k + 1, total });
    // Let the page repaint the progress bar.
    if (k % 3 === 0) await new Promise((r) => window.setTimeout(r, 0));
  }
  video.removeAttribute("src");
  video.load();
  return samples;
}
