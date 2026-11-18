// Wolf Vision stress test: runs the automatic engine on simulated doubles
// games across camera positions, lenses and conditions, in parallel, and
// prints an accuracy table (hits found, precision, right hitter, identity).
//
//   node --experimental-strip-types scripts/wolf-vision-eval.mts [seconds] [suite]
//   suites: views (default), stress, all
//
// Each cell averages 3 seeds. Hits count as found within ±0.25 s.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { runSim } from "../lib/ma/simrun.ts";
import { CAMERA_VIEWS, type SimOptions } from "../lib/ma/sim.ts";

type Job = { name: string; opts: SimOptions & { audio?: boolean }; seconds: number };
type Res = { name: string; q: number; precision: number; recall: number; hitter: number; side: number; identity: number; distErr: number; distRatio: number };

if (!isMainThread) {
  const job = workerData as Job;
  const r = runSim(job.opts, job.seconds);
  parentPort!.postMessage({
    name: job.name,
    q: r.quality,
    precision: r.hits.precision,
    recall: r.hits.recall,
    hitter: r.hits.attribution,
    side: r.hits.side,
    identity: r.identity,
    distErr: r.distanceError,
    distRatio: r.distanceRatio,
  } satisfies Res);
} else {
  const seconds = Number(process.argv[2] ?? 60);
  const suite = process.argv[3] ?? "views";
  const base: SimOptions = { w: 640, h: 360, sameShirts: true };
  const cells: { name: string; opts: SimOptions & { audio?: boolean } }[] = [];
  if (suite === "views" || suite === "all") {
    for (const lens of ["wide", "ultrawide"] as const) for (const view of CAMERA_VIEWS) cells.push({ name: `${view} ${lens === "wide" ? "1×" : "0.5×"}`, opts: { ...base, view, lens } });
  }
  if (suite === "stress" || suite === "all") {
    const add = (name: string, o: Partial<SimOptions> & { audio?: boolean }) => cells.push({ name, opts: { ...base, ...o } });
    add("baseline, no sound", { audio: false });
    add("side, no sound", { view: "side", audio: false });
    add("dim + noisy", { light: 0.4, noise: 7 });
    add("side, dim + noisy", { view: "side", light: 0.4, noise: 7 });
    add("shaky 2.5 px", { shake: 2.5 });
    add("corner, shaky 2.5 px", { view: "corner", shake: 2.5 });
    add("same shirts + shorts", { sameShorts: true });
    add("side, same shirts + shorts", { view: "side", sameShorts: true });
    add("loud hall (2 false sounds/s)", { crowdNoise: 2 });
    add("detector misses 20 %", { detectorMiss: 0.2 });
    add("long dropouts (1–4 s, 6/min/player)", { dropouts: 6 });
    add("side, long dropouts", { view: "side", dropouts: 6 });
    add("corner, long dropouts", { view: "corner", dropouts: 6 });
    add("24 fps phone", { fps: 24 });
    add("60 fps phone", { fps: 60 });
    add("low res 480×270", { w: 480, h: 270 });
    add("everything bad, baseline", { light: 0.45, noise: 6, shake: 1.5, crowdNoise: 1, sameShorts: true, detectorMiss: 0.12 });
    add("everything bad, side", { view: "side", light: 0.45, noise: 6, shake: 1.5, crowdNoise: 1, sameShorts: true, detectorMiss: 0.12 });
  }
  const jobs: Job[] = cells.flatMap((c) => [11, 23, 37].map((seed) => ({ name: c.name, opts: { ...c.opts, seed }, seconds })));
  const results: Res[] = [];
  let next = 0;
  const t0 = Date.now();
  await new Promise<void>((done) => {
    let running = 0;
    const launch = () => {
      while (running < Math.max(1, availableParallelism() - 1) && next < jobs.length) {
        const job = jobs[next++];
        running++;
        const w = new Worker(new URL(import.meta.url), { workerData: job, execArgv: ["--experimental-strip-types", "--no-warnings"] });
        w.on("message", (r: Res) => results.push(r));
        w.on("error", (e) => {
          console.error(job.name, e);
          running--;
          launch();
        });
        w.on("exit", () => {
          running--;
          if (next >= jobs.length && running === 0) done();
          else launch();
        });
      }
    };
    launch();
  });
  const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(5);
  console.log(`\n${seconds} s × 3 seeds per row, ${((Date.now() - t0) / 1000).toFixed(0)} s total\n`);
  console.log("| condition | Q | precision | recall | right hitter | right side | identity | distance (measured ÷ true) |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const c of cells) {
    const rs = results.filter((r) => r.name === c.name);
    if (!rs.length) continue;
    const m = (k: keyof Res) => rs.reduce((a, r) => a + (r[k] as number), 0) / rs.length;
    console.log(`| ${c.name} | ${m("q").toFixed(2)} | ${pct(m("precision"))} | ${pct(m("recall"))} | ${pct(m("hitter"))} | ${pct(m("side"))} | ${pct(m("identity"))} | ×${m("distRatio").toFixed(2)} |`);
  }
}
