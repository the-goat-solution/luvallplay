// Wolf Vision: fine-tunes the AI shuttle checker (lib/ma/checker.ts) on
// simulated games with exact labels, under the conditions the stress test
// covers (doubles and singles, dim, shaky, 0.5× lens, matching kit, a busy
// court next door, the worst case together).
//
//   node scripts/wolf-vision-train.ts [seconds=30] [--write] [--l2=0.2] [--epochs=2] [--data=file]
//
// --data caches the generated candidates in a file (reused when it exists).
//
// Starts from the bundled weights and stays anchored to them (L2 towards
// them), because those also learned from real matches whose footage is not in
// the repository: training from scratch on the simulator alone would forget
// that. Training games and held-out games use different seeds. With --write
// the new weights replace lib/ma/models/shuttle-checker.ts, but only when the
// held-out AUC improves.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { MatchEngine } from "../lib/ma/engine.ts";
import { fitCamera, LENS_PRIOR } from "../lib/ma/lens.ts";
import { MatchSim, type SimOptions } from "../lib/ma/sim.ts";
import { engineInput, SimPoseFeed } from "../lib/ma/simrun.ts";
import { DOUBLES_SLOTS, SINGLES_SLOTS } from "../lib/ma/identity.ts";
import { N_FEATURES, ShuttleChecker } from "../lib/ma/checker.ts";
import { SHUTTLE_CHECKER } from "../lib/ma/models/shuttle-checker.ts";

type Sample = { f: Float32Array; y: 0 | 1; cond: string };

const CONDS: [string, Partial<SimOptions>][] = [
  ["doubles", {}],
  ["singles", { singles: true }],
  ["dim", { light: 0.45, noise: 6 }],
  ["shaky", { shake: 2.5 }],
  ["ultra-wide", { lens: "ultrawide" }],
  ["next court", { neighbourGap: 1.0, pose: true }],
  ["singles next court", { singles: true, neighbourGap: 1.0, pose: true }],
  ["worst", { light: 0.5, noise: 5, shake: 1.5, sameShorts: true, neighbourGap: 1.2, detectorMiss: 0.1, pose: true }],
];

/** Exact labels: a candidate within 4 px (at 640 wide) of where the shuttle really was is a shuttle; beyond 12 px it is not; in between it is left out. */
function games(seeds: number[], seconds: number): Sample[] {
  const out: Sample[] = [];
  for (const [cond, o] of CONDS) {
    for (const seed of seeds) {
      const w = 640, h = 360;
      const sim = new MatchSim({ w, h, seed, ...o });
      const cam = fitCamera(sim.taps(6), w, h, LENS_PRIOR[o.lens ?? "wide"])!;
      const engine = new MatchEngine({ cam, videoW: w, videoH: h, courtPoints: 6, lens: o.lens ?? "wide", slots: o.singles ? SINGLES_SLOTS : DOUBLES_SLOTS });
      const truth = new Map<number, { x: number; y: number } | null>();
      engine.onCandidates = (t, list) => {
        const s = truth.get(Math.round(t * 1000));
        if (s === undefined) return;
        for (const c of list) {
          const d = s ? Math.hypot(c.x - s.x, c.y - s.y) : Infinity;
          if (d <= 4) out.push({ f: Float32Array.from(c.f), y: 1, cond });
          else if (d > 12) out.push({ f: Float32Array.from(c.f), y: 0, cond });
        }
      };
      const feed = new SimPoseFeed();
      const g = new Uint8Array(w * h);
      for (let k = 0; k < seconds * 30; k++) {
        const f = sim.step();
        const sh = f.truth.shuttle;
        truth.set(Math.round(f.t * 1000), sh ? sim.project(sh) : null);
        const inp = engineInput(f, w, h, g);
        if (k % 2 === 0) feed.feed(engine, f);
        engine.process({ ...inp, persons: k % 2 === 0 ? inp.persons : undefined });
      }
    }
  }
  return out;
}

function auc(model: ShuttleChecker, data: Sample[]): number {
  const s = data.map((d) => ({ p: model.predict(d.f), y: d.y })).sort((a, b) => a.p - b.p);
  let pos = 0, neg = 0, rankSum = 0;
  s.forEach((d, i) => {
    if (d.y) {
      pos++;
      rankSum += i + 1;
    } else neg++;
  });
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
}

function report(label: string, model: ShuttleChecker, data: Sample[]) {
  const by = CONDS.map(([c]) => `${c} ${auc(model, data.filter((d) => d.cond === c)).toFixed(3)}`).join(" · ");
  console.log(`${label}: AUC ${auc(model, data).toFixed(4)}  (${by})`);
}

/** Weight change relative to the bundled model (the shared-model merge rejects updates over 0.5). */
function relativeChange(a: ShuttleChecker, b: ShuttleChecker): number {
  const v = (m: ShuttleChecker) => [...m.w1, ...m.b1, ...m.w2, m.b2];
  const x = v(a), y = v(b);
  return Math.hypot(...x.map((q, i) => q - y[i])) / Math.hypot(...x);
}

function save(file: string, sets: Sample[][]) {
  const all = sets.flat();
  const buf = new Float32Array(all.length * (N_FEATURES + 1));
  all.forEach((d, i) => {
    buf.set(d.f, i * (N_FEATURES + 1));
    buf[i * (N_FEATURES + 1) + N_FEATURES] = d.y;
  });
  writeFileSync(file, Buffer.from(buf.buffer));
  writeFileSync(`${file}.json`, JSON.stringify({ sizes: sets.map((s) => s.length), conds: all.map((d) => CONDS.findIndex(([c]) => c === d.cond)) }));
}

function load(file: string): Sample[][] {
  const meta = JSON.parse(readFileSync(`${file}.json`, "utf8")) as { sizes: number[]; conds: number[] };
  const raw = readFileSync(file);
  const buf = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const all = meta.conds.map((c, i) => ({ f: buf.slice(i * (N_FEATURES + 1), i * (N_FEATURES + 1) + N_FEATURES), y: buf[i * (N_FEATURES + 1) + N_FEATURES] as 0 | 1, cond: CONDS[c][0] }));
  return [all.slice(0, meta.sizes[0]), all.slice(meta.sizes[0])];
}

const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const seconds = Number(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : 30);
const write = process.argv.includes("--write");
const L2 = Number(arg("l2", "0.2"));
const EPOCHS = Number(arg("epochs", "2"));
const dataFile = arg("data", "");
let train: Sample[], test: Sample[];
if (dataFile && existsSync(dataFile)) {
  [train, test] = load(dataFile);
} else {
  console.log(`Generating training games (${CONDS.length} conditions × 4 seeds × ${seconds} s) and held-out games (× 2 seeds)…`);
  train = games([101, 102, 103, 104], seconds);
  test = games([201, 202], seconds);
  if (dataFile) save(dataFile, [train, test]);
}
const np = train.filter((d) => d.y).length;
console.log(`train: ${train.length} candidates (${np} shuttle) · held out: ${test.length} (${test.filter((d) => d.y).length} shuttle)`);

const before = new ShuttleChecker(SHUTTLE_CHECKER);
report("bundled  ", before, test);

const model = new ShuttleChecker(SHUTTLE_CHECKER);
// Balanced classes; a seeded shuffle each epoch.
const wPos = (train.length - np) / Math.max(1, np);
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const order = train.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const lr = 0.004 / (1 + epoch);
  let loss = 0;
  for (const i of order) loss += model.train(train[i].f, train[i].y, lr, L2, train[i].y ? Math.min(8, wPos) : 1);
  report(`epoch ${epoch + 1}  `, model, test);
  console.log(`  weights moved ${(relativeChange(before, model) * 100).toFixed(1)} % from the bundled model`);
  void loss;
}

const a0 = auc(before, test), a1 = auc(model, test);
const moved = relativeChange(before, model);
// Kept only when better on held-out games and still close to the bundled model (which
// also learned from real matches): at most a 15 % change.
if (write && a1 > a0 + 0.002 && moved <= 0.15) {
  const json = JSON.stringify(model.toJSON());
  writeFileSync(
    new URL("../lib/ma/models/shuttle-checker.ts", import.meta.url),
    `// Trained weights of the tiny shuttle checker (lib/ma/checker.ts): 151 inputs → 16 → 1.
// Trained on 81924 candidates: simulated games (exact labels) and six real matches
// (self-labels at half weight). Fine-tuned (anchored to those weights) on ${train.length}
// candidates from simulated doubles and singles games in dim light, shake, the 0.5× lens,
// matching kit and beside a busy court (scripts/wolf-vision-train.ts), weights within
// ${Math.ceil(moved * 100)} % of before. Held-out simulated games: AUC ${a0.toFixed(3)} before, ${a1.toFixed(3)} after.
import type { CheckerWeights } from "../checker.ts";

export const SHUTTLE_CHECKER: CheckerWeights | null = ${json};
`,
  );
  console.log(`Wrote lib/ma/models/shuttle-checker.ts (AUC ${a0.toFixed(4)} → ${a1.toFixed(4)}).`);
} else console.log(`Held-out AUC ${a0.toFixed(4)} → ${a1.toFixed(4)}, weights moved ${(moved * 100).toFixed(1)} %${write ? ": not kept (needs a better AUC within 15 %), weights unchanged." : " (dry run; --write to save)."}`);
