// Copies the MediaPipe vision runtime (WebAssembly) out of node_modules into
// an app's public/mediapipe, so the tracker loads it from the app's own
// origin instead of a CDN: node copy-mediapipe.mjs <public dir>. The copies
// are git-ignored. Only the plain and no-SIMD builds are needed: MediaPipe
// picks one depending on what the browser supports.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (!target) {
  console.error("usage: copy-mediapipe.mjs <public dir>");
  process.exit(1);
}
// In this package's node_modules or, hoisted, a parent's: look upwards as Node does.
function findWasm() {
  for (let dir = dirname(fileURLToPath(import.meta.url)); dirname(dir) !== dir; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules/@mediapipe/tasks-vision/wasm");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
const from = findWasm();
if (!from) {
  console.warn("copy-mediapipe: @mediapipe/tasks-vision is not installed; skipping");
  process.exit(0);
}
const to = join(resolve(target), "mediapipe");
const files = ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];
mkdirSync(to, { recursive: true });
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(`copy-mediapipe: ${files.length} files -> ${to}`);
