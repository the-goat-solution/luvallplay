// Copies the MediaPipe vision runtime (WebAssembly) out of node_modules into
// public/mediapipe, so /match-analyzer loads it from our own domain instead
// of a CDN. Runs before `npm run dev` and `npm run build`; the copies are
// git-ignored. Only the plain and no-SIMD builds are needed: MediaPipe picks
// one depending on what the browser supports.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The package sits in this app's node_modules or, in the monorepo's hoisted
// layout, in a parent's: look upwards like Node does.
function findWasm() {
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules/@mediapipe/tasks-vision/wasm");
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return join(root, "node_modules/@mediapipe/tasks-vision/wasm");
  }
}
const from = findWasm();
const to = join(root, "public/mediapipe");
const files = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

if (!existsSync(from)) {
  console.warn("copy-mediapipe: @mediapipe/tasks-vision is not installed; skipping");
  process.exit(0);
}
mkdirSync(to, { recursive: true });
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(`copy-mediapipe: ${files.length} files -> public/mediapipe`);
