// Wolf Vision stress test: runs the automatic engine on simulated games under
// many conditions (doubles and singles, light, shake, lens, matching kit, no
// sound, the AI pose layer, a neighbouring court, a knocked camera) over
// several seeds, and prints accuracy per condition.
//
//   node scripts/wolf-vision-stress.ts [seconds=40] [seeds=3] [filter]
//
// filter: only conditions whose name contains it (e.g. "singles").
// Pure TypeScript on Node (no browser): the person detector and pose model are
// emulated by the simulator from the true bodies, with noise and misses.

import { runSim, type SimRunResult } from "../lib/ma/simrun.ts";
import type { SimOptions } from "../lib/ma/sim.ts";

type Cond = { name: string; opts: Partial<SimOptions> & { audio?: boolean } };

const base: Cond[] = [
  { name: "baseline (1x, same shirts)", opts: {} },
  { name: "0.5x ultra-wide", opts: { lens: "ultrawide" } },
  { name: "dim + noisy", opts: { light: 0.45, noise: 6 } },
  { name: "shaky (2.5 px)", opts: { shake: 2.5 } },
  { name: "same shirts and shorts", opts: { sameShorts: true } },
  { name: "no sound", opts: { audio: false } },
  { name: "detector misses 15%", opts: { detectorMiss: 0.15 } },
  { name: "loud hall (2 false sounds/s)", opts: { crowdNoise: 2 } },
  { name: "pose layer", opts: { pose: true } },
  { name: "neighbouring court 1.2 m", opts: { neighbourGap: 1.2 } },
  { name: "neighbouring court 0.8 m", opts: { neighbourGap: 0.8 } },
  { name: "camera knocked at 15 s", opts: { bumpAt: 15, bump: { x: 30, y: 12 } } },
  { name: "worst case", opts: { light: 0.5, noise: 5, shake: 1.5, sameShorts: true, neighbourGap: 1.2, detectorMiss: 0.1, crowdNoise: 1, pose: true } },
];
const conds: Cond[] = [
  ...base.map((c) => ({ name: `doubles · ${c.name}`, opts: c.opts })),
  ...base.map((c) => ({ name: `singles · ${c.name}`, opts: { ...c.opts, singles: true } })),
];

const seconds = Number(process.argv[2] ?? 40);
const seeds = Number(process.argv[3] ?? 3);
const filter = process.argv[4] ?? "";

const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(5);
const cols = ["precision", "recall", "hitter", "side", "identity", "pos err", "dist err", "moved", "Q"];
console.log(`Wolf Vision stress test: ${seconds} s × ${seeds} seeds per condition (640×360 analysis)\n`);
console.log(`${"condition".padEnd(44)}${cols.map((c) => c.padStart(10)).join("")}`);
for (const c of conds) {
  if (filter && !c.name.includes(filter)) continue;
  const rs: SimRunResult[] = [];
  for (let s = 0; s < seeds; s++) rs.push(runSim({ w: 640, h: 360, seed: 21 + s, ...c.opts }, seconds));
  const m = (f: (r: SimRunResult) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  const row = [
    pct(m((r) => r.hits.precision)),
    pct(m((r) => r.hits.recall)),
    pct(m((r) => r.hits.attribution)),
    pct(m((r) => r.hits.side)),
    pct(m((r) => r.identity)),
    `${m((r) => r.positionError).toFixed(2)} m`,
    `${m((r) => r.distanceError * 100).toFixed(0)}%`,
    `${m((r) => r.movedFor).toFixed(1)} s`,
    m((r) => r.quality).toFixed(2),
  ];
  console.log(`${c.name.padEnd(44)}${row.map((v) => v.padStart(10)).join("")}`);
}
