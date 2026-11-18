import { test } from "node:test";
import assert from "node:assert/strict";
import { ShuttleChecker, averageWeights, N_FEATURES } from "../lib/ma/checker.ts";
import { fromCrop, mergeDetections } from "../lib/ma/detections.ts";
import { MatchEngine, type PoseKeypoints } from "../lib/ma/engine.ts";
import { fitCamera, LENS_PRIOR } from "../lib/ma/lens.ts";
import { MatchSim } from "../lib/ma/sim.ts";
import { SHUTTLE_CHECKER } from "../lib/ma/models/shuttle-checker.ts";
import { addTotals, totalsAsSummary, Throttle } from "../components/match-analyzer/session.ts";

test("resume: totals of two parts add up (hits, distance, rallies, average, fastest)", () => {
  const part = (hits: number[], rallies: number, avg: number, fast: number | null, dur: number) => ({
    duration: dur,
    rallies,
    longestRally: rallies ? 6 : 0,
    avgRallyShots: avg,
    fastestShotKmh: fast,
    players: hits.map((h) => ({ hits: h, distance: h * 10, topSpeed: h / 2 })),
    breakdown: { accepted: 10, inferred: 1, predicted: 1 },
    estimate: { estimated: 14, plusMinus: 3, seen: 11, predicted: 1, recall: 0.7 },
  });
  const a = part([3, 3, 2, 4], 4, 3, 120, 600);
  const b = part([1, 2, 2, 1], 2, 3, 150, 300);
  const t = addTotals(addTotals(null, a), b);
  assert.equal(t.duration, 900);
  assert.equal(t.rallies, 6);
  assert.deepEqual(t.players.map((p) => p.hits), [4, 5, 4, 5]);
  assert.equal(t.fastestShotKmh, 150);
  assert.equal(t.plusMinus, Math.round(Math.hypot(3, 3)));
  const s = totalsAsSummary(t, b);
  assert.equal(s.avgRallyShots, 3);
  assert.equal(s.players[0].distance, 40);
});

test("throttle: detector slows down when the phone falls behind, and recovers", () => {
  const th = new Throttle();
  let now = 0;
  for (let i = 0; i < 5; i++) th.update(40, 33, (now += 3100)); // 120 % of the frame budget
  assert.ok(th.stride > Throttle.MIN && th.throttled);
  for (let i = 0; i < 10; i++) th.update(5, 33, (now += 3100));
  assert.equal(th.stride, Throttle.MIN);
});

test("AI checker: learns a separable pattern, and federated averaging weighs by samples", () => {
  const m = new ShuttleChecker(null);
  const sample = (y: 0 | 1) => {
    const f = new Float32Array(N_FEATURES);
    for (let i = 0; i < N_FEATURES; i++) f[i] = (Math.sin(i * 7.1 + y * 3) + (y ? 0.8 : -0.8)) * 0.5;
    return f;
  };
  const before = m.predict(sample(1));
  for (let k = 0; k < 400; k++) {
    m.train(sample(1), 1, 0.02);
    m.train(sample(0), 0, 0.02);
  }
  assert.ok(m.predict(sample(1)) > 0.9 && m.predict(sample(0)) < 0.1, `p1 ${m.predict(sample(1))} p0 ${m.predict(sample(0))} (was ${before})`);
  const a = { ...m.toJSON(), n: 300 };
  const z = { ...new ShuttleChecker(null).toJSON(), n: 100 };
  const avg = averageWeights([a, z])!;
  assert.equal(avg.n, 400);
  assert.ok(Math.abs(avg.b2 - (a.b2 * 300 + z.b2 * 100) / 400) < 1e-9);
});

test("AI checker: bundled weights are present and the right shape", () => {
  assert.ok(SHUTTLE_CHECKER, "trained weights ship with the app");
  assert.equal(SHUTTLE_CHECKER!.w1.length, 16 * N_FEATURES);
  assert.ok(SHUTTLE_CHECKER!.n > 1000);
});

function simEngine() {
  const sim = new MatchSim({ w: 640, h: 360, seed: 3 });
  const cam = fitCamera(sim.taps(6), 640, 360, LENS_PRIOR.wide)!;
  return new MatchEngine({ cam, videoW: 640, videoH: 360, courtPoints: 6 });
}

test("pose layer: a whipped racket arm becomes a swing cue; footwork does not", () => {
  const e = simEngine();
  const kp = (wx: number, wy: number): PoseKeypoints => ({
    shoulders: [[300, 200, 0.9], [330, 200, 0.9]],
    elbows: [[290, 215, 0.9], [340, 215, 0.9]],
    wrists: [[285, 230, 0.9], [wx, wy, 0.9]],
    hips: [[305, 250, 0.9], [325, 250, 0.9]],
  });
  // Torso ~50 px. Calm arm (walking): wrist moves 5 px per 0.1 s = 1 torso/s.
  for (let i = 0; i < 10; i++) e.addPose(0, i * 0.1, kp(345 + i * 5, 230));
  const swings = () => ((e as unknown as { swings: { events: unknown[] }[] }).swings[0].events.length);
  assert.equal(swings(), 0);
  // A stroke: the wrist travels ~60 px in 0.07 s (~17 torso/s), then slows.
  e.addPose(0, 1.07, kp(400, 170));
  e.addPose(0, 1.14, kp(405, 168));
  e.addPose(0, 1.21, kp(406, 168));
  assert.equal(swings(), 1);
  assert.ok(e.poseCount >= 13);
});

test("two-pass detection: far-crop boxes map back to video pixels and merge without duplicates", () => {
  const roi: [number, number, number, number] = [600, 300, 640, 360]; // crop at scale 1 for clarity
  const full = [{ box: [900, 340, 20, 50] as [number, number, number, number], score: 0.3 }, { box: [700, 600, 90, 260] as [number, number, number, number], score: 0.9 }];
  const crop = fromCrop(
    [
      { box: [301, 41, 19, 49], score: 0.8 }, // same far player, more confident
      { box: [100, 50, 18, 45], score: 0.6 }, // a far player the full frame missed
      { box: [120, 330, 60, 40], score: 0.7 }, // near player's head cut by the crop edge: dropped
    ],
    roi,
    640,
    360,
  );
  const merged = mergeDetections(full, crop, roi);
  assert.equal(merged.length, 3);
  assert.ok(merged.some((d) => d.score === 0.8 && Math.abs(d.box[0] - 901) < 1e-9));
  assert.ok(merged.some((d) => Math.abs(d.box[0] - 700) < 1e-9));
});

test("far-court crop: from behind a baseline it covers the far half and is much smaller than the frame", () => {
  const e = simEngine();
  const roi = e.farRoi();
  assert.ok(roi, "a second pass is worth it");
  const [, , w, h] = roi!;
  assert.ok(w <= 640 * 0.6 && h > 0);
  assert.ok(Math.abs(w / h - 16 / 9) < 0.05);
});
