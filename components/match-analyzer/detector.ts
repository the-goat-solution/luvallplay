// Person detection for Wolf Vision, run entirely on the device with
// MediaPipe's object detector (EfficientDet-Lite0, COCO "person" class, GPU
// where available). Frames never leave the phone; only boxes are kept.
import type { ObjectDetector } from "@mediapipe/tasks-vision";
import type { Detection } from "@/lib/match-analyzer";

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

/** People in a canvas frame, in the canvas's own pixels. */
export function detectPeople(detector: ObjectDetector, canvas: HTMLCanvasElement): Detection[] {
  return detector
    .detect(canvas)
    .detections.filter((d) => d.boundingBox)
    .map((d) => {
      const b = d.boundingBox!;
      return { box: [b.originX, b.originY, b.width, b.height] as Detection["box"], score: d.categories[0]?.score ?? 0 };
    });
}
