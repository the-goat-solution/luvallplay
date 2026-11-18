// Renders a simulated doubles game to an MP4 with sound (racket impacts and
// hall noise), plus the true hits as JSON, to test Wolf Vision end to end in a
// real browser: the upload path, MediaPipe person detection, the sound track.
//
//   node --experimental-strip-types scripts/wolf-vision-render.mts <out.mp4> [seconds] [view] [lens] [seed]
//   views: baseline, low, balcony, offcentre, side, corner · lens: wide, ultrawide
//
// Needs ffmpeg on the PATH.
import { spawn } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { MatchSim, type CameraView } from "../lib/ma/sim.ts";
import type { LensPreset } from "../lib/ma/lens.ts";

const [out, secArg, viewArg, lensArg, seedArg] = process.argv.slice(2);
if (!out) {
  console.error("usage: wolf-vision-render.mts <out.mp4> [seconds] [view] [lens] [seed]");
  process.exit(1);
}
const seconds = Number(secArg ?? 30);
const view = (viewArg ?? "baseline") as CameraView;
const lens = (lensArg ?? "wide") as LensPreset;
const W = 960, H = 540, FPS = 30, SR = 44100;
const sim = new MatchSim({ w: W, h: H, fps: FPS, view, lens, seed: Number(seedArg ?? 5), sameShirts: true, crowdNoise: 0.2 });

// Sound: low hall rumble plus a sharp 3 ms crack per impact.
const audio = new Float32Array(Math.ceil((seconds + 1) * SR));
let rs = 12345;
const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
for (let i = 0; i < audio.length; i++) audio[i] = 0.01 * rnd();
const crack = (t: number, amp: number) => {
  const i0 = Math.round(t * SR);
  let prev = 0;
  for (let k = 0; k < SR * 0.012; k++) {
    if (i0 + k >= audio.length) break;
    const env = Math.exp(-k / (SR * 0.0025));
    const n = rnd();
    const hp = n - prev; // crude high-pass: impacts are bright
    prev = n;
    audio[i0 + k] += amp * env * hp * 0.6;
  }
};

const ff = spawn("ffmpeg", ["-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20", `${out}.video.mp4`], {
  stdio: ["pipe", "inherit", "inherit"],
});
const frames = Math.round(seconds * FPS);
for (let k = 0; k < frames; k++) {
  const f = sim.step();
  for (const o of f.onsets) crack(o.t, 0.25 + 0.6 * o.strength);
  if (!ff.stdin.write(Buffer.from(f.rgba.buffer, f.rgba.byteOffset, f.rgba.byteLength))) await new Promise((r) => ff.stdin.once("drain", r));
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));

// 16-bit WAV.
const pcm = Buffer.alloc(44 + audio.length * 2);
pcm.write("RIFF", 0);
pcm.writeUInt32LE(36 + audio.length * 2, 4);
pcm.write("WAVEfmt ", 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write("data", 36);
pcm.writeUInt32LE(audio.length * 2, 40);
for (let i = 0; i < audio.length; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(audio[i] * 32767))), 44 + i * 2);
writeFileSync(`${out}.wav`, pcm);

await new Promise((r) =>
  spawn("ffmpeg", ["-loglevel", "error", "-y", "-i", `${out}.video.mp4`, "-i", `${out}.wav`, "-c:v", "copy", "-c:a", "aac", "-shortest", out], { stdio: "inherit" }).on("close", r),
);
unlinkSync(`${out}.video.mp4`);
unlinkSync(`${out}.wav`);
writeFileSync(`${out}.json`, JSON.stringify({ view, lens, seconds, taps: sim.taps(10), hits: sim.hits }, null, 1));
console.log(`${out}: ${frames} frames, ${sim.hits.length} true hits`);
