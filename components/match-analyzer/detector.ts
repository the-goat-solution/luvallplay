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

/** WebGL is backed by a software rasteriser (no real GPU for the model). */
function softwareGpu(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r);
  } catch {
    return false;
  }
}

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
      // A "GPU" that is really software rendering (no graphics acceleration in the
      // browser, a VM, some desktops) runs the model several times slower than the CPU
      // path: measured 850 ms vs 120 ms a frame. Use the CPU there.
      if (softwareGpu()) return await ObjectDetector.createFromOptions(fileset, options("CPU"));
      try {
        const gpu = await ObjectDetector.createFromOptions(fileset, options("GPU"));
        // Check the real speed once: a slow GPU path still loses to the CPU.
        const probe = document.createElement("canvas");
        probe.width = 640;
        probe.height = 360;
        probe.getContext("2d")?.fillRect(0, 0, 640, 360);
        gpu.detect(probe); // warm-up (shader compilation)
        const t0 = performance.now();
        gpu.detect(probe);
        if (performance.now() - t0 < 250) return gpu;
        gpu.close();
        return await ObjectDetector.createFromOptions(fileset, options("CPU"));
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
