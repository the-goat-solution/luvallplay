import { test } from "node:test";
import assert from "node:assert/strict";
import { COURT, applyHomography, courtLandmarks, solveHomography, type Pt } from "../lib/match-analyzer.ts";
import { distort, fitCamera, imageToCourt, courtToImage, makeLens, undistort } from "../lib/ma/lens.ts";
import { hungarian } from "../lib/ma/hungarian.ts";
import { estimateShift, projections, toGray } from "../lib/ma/imaging.ts";
import { IdentityTracker, type PersonObs } from "../lib/ma/identity.ts";
import { HitFusion, acceptThreshold, expectedRecall, rhythmScore, type FusionContext } from "../lib/ma/hits.ts";
import { cameraFromHomography, fitFromPoint, project3, rayNearPlayer } from "../lib/ma/flight.ts";
import { OnsetDetector } from "../lib/ma/audio.ts";
import { combineQuality } from "../lib/ma/quality.ts";
import { MatchSim } from "../lib/ma/sim.ts";
import { runSim } from "../lib/ma/simrun.ts";

const close = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b} (±${eps})`);

test("lens: distort and undistort are inverses; barrel distortion pulls corners in", () => {
  const L = makeLens(1920, 1080, -0.2);
  for (const p of [{ x: 100, y: 80 }, { x: 960, y: 540 }, { x: 1800, y: 1000 }]) {
    const q = undistort(L, distort(L, p));
    close(q.x, p.x, 1e-6);
    close(q.y, p.y, 1e-6);
  }
  const corner = distort(L, { x: 1900, y: 1060 });
  assert.ok(corner.x < 1900 && corner.y < 1060);
});

test("lens: with 6+ court points the ultra-wide distortion is measured", () => {
  // A known court view through a known barrel distortion.
  const H = solveHomography(
    [{ x: 0, y: 0 }, { x: 6.1, y: 0 }, { x: 6.1, y: 13.4 }, { x: 0, y: 13.4 }],
    [{ x: 300, y: 980 }, { x: 1620, y: 980 }, { x: 1250, y: 330 }, { x: 670, y: 330 }],
  )!;
  const lens = makeLens(1920, 1080, -0.22);
  const ids = ["0,0", "6.1,0", "6.1,13.4", "0,13.4", "3.05,4.72", "3.05,8.68", "0,6.7", "6.1,6.7"];
  const taps = courtLandmarks()
    .filter((l) => ids.includes(l.id))
    .map((l) => ({ court: l.p, image: distort(lens, applyHomography(H, l.p)) }));
  const cam = fitCamera(taps, 1920, 1080, 0)!;
  close(cam.lens.lambda, -0.22, 0.03);
  const back = imageToCourt(cam, courtToImage(cam, { x: 2, y: 9 }));
  close(back.x, 2, 1e-3);
  close(back.y, 9, 1e-3);
});

test("hungarian: matches brute force on random matrices", () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let trial = 0; trial < 30; trial++) {
    const C = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => Math.round(rnd() * 20)));
    const a = hungarian(C);
    const cost = a.reduce((s, j, i) => s + C[i][j], 0);
    let best = Infinity;
    const perm = (i: number, used: Set<number>, acc: number) => {
      if (i === 4) return void (best = Math.min(best, acc));
      for (let j = 0; j < 5; j++) if (!used.has(j)) perm(i + 1, new Set([...used, j]), acc + C[i][j]);
    };
    perm(0, new Set(), 0);
    assert.equal(cost, best);
  }
});

test("imaging: camera shake between frames is measured exactly", () => {
  const sim = new MatchSim({ w: 640, h: 360, seed: 21, shake: 2.5 });
  const s = sim as unknown as { shakeX: number; shakeY: number };
  let prev: ReturnType<typeof projections> | null = null;
  let prevS = [0, 0];
  let ok = 0;
  for (let k = 0; k < 40; k++) {
    const f = sim.step();
    const p = projections(toGray(f.rgba, 640, 360), 640, 360);
    const cur = [Math.round(s.shakeX), Math.round(s.shakeY)];
    if (prev) {
      const e = estimateShift(prev, p, 6);
      if (e.dx === cur[0] - prevS[0] && e.dy === cur[1] - prevS[1]) ok++;
    }
    prev = p;
    prevS = cur;
  }
  assert.ok(ok >= 37, `only ${ok}/39 exact`);
});

test("identity: partners in identical kit crossing keep their names", () => {
  const tr = new IdentityTracker([{ side: 0, lr: 0 }, { side: 0, lr: 1 }]);
  const look = new Array(33).fill(0);
  look[0] = look[11] = look[22] = 1;
  const obs = (x: number, y: number, h: number): PersonObs => ({ box: [x * 100, 500 - h * 100, 50, h * 100], score: 0.9, look, p: { x, y }, mpp: 0.01 });
  // A walks right, B walks left; they pass 30 cm apart at t = 1 s.
  for (let k = 0; k <= 40; k++) {
    const t = k / 15;
    const a = obs(1 + 2 * t, 3 + 0.15 * Math.sin(t), 1.7);
    const b = obs(5 - 2 * t, 3 - 0.15 * Math.sin(t), 1.85);
    tr.update(t, k % 2 ? [b, a] : [a, b]);
  }
  const pa = tr.positionAt(0, 40 / 15)!;
  const pb = tr.positionAt(1, 40 / 15)!;
  assert.ok(pa.x > pb.x, `A should have ended on the right (A ${pa.x.toFixed(1)}, B ${pb.x.toFixed(1)})`);
});

function ctx(q = 0.9): FusionContext {
  return {
    quality: q,
    sideOf: (p) => (p < 2 ? 0 : 1),
    playersOn: (s) => (s === 0 ? [0, 1] : [2, 3]),
    reach: () => null,
    swingNear: () => 0,
    players: 4,
    audioOn: true,
  };
}

test("hits: sound + swing is accepted; a swing alone is not; the threshold rises as quality drops", () => {
  const f = new HitFusion();
  f.addCue({ t: 1, kind: "audio", strength: 0.9 });
  f.addCue({ t: 1.07, kind: "swing", strength: 0.9, player: 2 });
  f.addCue({ t: 3, kind: "swing", strength: 0.9, player: 1 });
  f.update(5, ctx());
  assert.deepEqual(f.hits.map((h) => [h.t, h.player]), [[1, 2]]);
  assert.ok(acceptThreshold(0.3) > acceptThreshold(0.9));
  assert.ok(expectedRecall(0.3) < expectedRecall(0.9));
  // Without sound the picture alone finds fewer hits: the miss estimate must expect that.
  assert.ok(expectedRecall(0.8, false) < expectedRecall(0.8, true));
  assert.ok(rhythmScore(1) > rhythmScore(0.1));
});

test("hits: a missed shot between two same-side hits is predicted for the other side", () => {
  const f = new HitFusion();
  for (const [t, p] of [[1, 0], [2.1, 2], [4.3, 3]] as const) {
    f.addCue({ t, kind: "audio", strength: 0.95 });
    f.addCue({ t: t + 0.07, kind: "swing", strength: 1, player: p });
  }
  // A strong hit by player 2 at 4.3 after player 2's side at 2.1: the near side's reply is missing.
  f.update(10, ctx());
  const H = f.hits;
  assert.equal(H.length, 4);
  assert.equal(H[2].status, "predicted");
  assert.ok(H[2].player < 2);
  assert.ok(H[2].t > 2.1 && H[2].t < 4.3);
});

test("hits: two same-side hits too close together keep only the stronger", () => {
  const f = new HitFusion();
  f.addCue({ t: 1, kind: "audio", strength: 0.95 });
  f.addCue({ t: 1.07, kind: "swing", strength: 1, player: 0 });
  f.addCue({ t: 1.5, kind: "audio", strength: 0.6 });
  f.addCue({ t: 1.57, kind: "swing", strength: 0.5, player: 1 });
  f.update(10, ctx());
  assert.deepEqual(f.hits.map((h) => h.player), [0]);
});

test("audio: a sharp impact in a noisy background is found", () => {
  const det = new OnsetDetector(16000, 512);
  let found: number[] = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 300; k++) {
    const t = k * 0.01;
    const mags = new Float32Array(256).map(() => 0.002 + rnd() * 0.002);
    if (k === 150) mags.fill(0.05, 48, 224);
    const o = det.push(t, mags);
    if (o) found.push(o.t);
  }
  found = found.map((t) => Math.round(t * 100) / 100);
  assert.deepEqual(found, [1.5]);
});

test("quality: weighted geometric mean; one bad factor pulls it down", () => {
  const good = combineQuality({ light: 1, stability: 1, court: 1, identity: 1, resolution: 1 });
  const dark = combineQuality({ light: 0.2, stability: 1, court: 1, identity: 1, resolution: 1 });
  close(good, 1, 1e-9);
  assert.ok(dark < 0.7 && dark > 0.6);
});

test("3D: the camera is recovered from the court and a contact is tested against each player", () => {
  const sim = new MatchSim({ w: 640, h: 360, seed: 11 });
  const c3 = cameraFromHomography(sim.cam.toImage, 640, 360, 69)!;
  close(c3.C[1], -5.6, 0.3);
  close(c3.C[2], 3.0, 0.2);
  // A shot from a near player's racket: the right hypothesis fits better than the far player's.
  const P0: [number, number, number] = [2.5, 3.5, 2.2];
  const v0: [number, number, number] = [0.5, 14, 6];
  const pts: { t: number; x: number; y: number }[] = [];
  for (let k = 1; k <= 9; k++) {
    const t = k / 30;
    const X = sim["cam"] && (() => {
      // drag-ballistic path from P0
      let p = [...P0], v = [...v0];
      for (let i = 0; i < t * 240; i++) {
        const sp = Math.hypot(v[0], v[1], v[2]);
        const kd = 9.81 / 6.8 ** 2;
        v = [v[0] - kd * sp * v[0] / 240, v[1] - kd * sp * v[1] / 240, v[2] - (9.81 + kd * sp * v[2]) / 240];
        p = [p[0] + v[0] / 240, p[1] + v[1] / 240, p[2] + v[2] / 240];
      }
      return p as [number, number, number];
    })();
    const q = project3(c3, sim.cam, X!)!;
    pts.push({ t, x: q.x, y: q.y });
  }
  const contact = project3(c3, sim.cam, P0)!;
  const near = rayNearPlayer(c3, sim.cam, contact, { x: 2.3, y: 3.2 });
  const far = rayNearPlayer(c3, sim.cam, contact, { x: 2.6, y: 10.5 });
  const eNear = fitFromPoint(c3, sim.cam, near.P, 0, pts);
  const eFar = far.P[2] > 0.2 && far.P[2] < 3.4 && far.horiz < 1.6 ? fitFromPoint(c3, sim.cam, far.P, 0, pts) : Infinity;
  assert.ok(eNear < 0.5, `near fit ${eNear}`);
  assert.ok(eFar > eNear * 2, `far ${eFar} vs near ${eNear}`);
});

test("end to end on the simulator: a 40 s doubles game, same shirts, 1× lens", () => {
  const r = runSim({ w: 640, h: 360, seed: 21 }, 40);
  assert.ok(r.hits.precision >= 0.8, `precision ${r.hits.precision}`);
  assert.ok(r.hits.recall >= 0.65, `recall ${r.hits.recall}`);
  assert.ok(r.hits.side >= 0.7, `side ${r.hits.side}`);
  assert.ok(r.identity >= 0.97, `identity ${r.identity}`);
  assert.ok(r.quality > 0.7, `quality ${r.quality}`);
});

test("court geometry sanity: the net is in the middle", () => {
  assert.equal(COURT.net * 2, COURT.length);
  const p: Pt = { x: 0, y: 0 };
  assert.equal(p.x, 0);
});

test("calibration: taps on the court mat's edge instead of the lines are flagged (real broadcast taps)", async () => {
  const { suspectTap } = await import("../lib/ma/lens.ts");
  const mk = (a: number[][]) => a.map(([x, y, ix, iy]) => ({ court: { x, y }, image: { x: ix, y: iy } }));
  // All England 2026, Birmingham (1920×1080): outer corners, the near T, singles corners.
  const good = mk([[0, 0, 414, 1018], [6.1, 0, 1506, 1019], [0, 13.4, 607, 589], [6.1, 13.4, 1316, 589], [3.05, 4.72, 963, 822], [0.46, 0, 500, 1018], [5.64, 0, 1422, 1018]]);
  const camGood = fitCamera(good, 1920, 1080, 0)!;
  assert.ok(camGood.rms < 3, `good fit ${camGood.rms}`);
  close(camGood.lens.lambda, 0, 0.03);
  assert.equal(suspectTap(camGood, good, 1920), null);
  // Far corners tapped on the edge of the grey mat, ~60 px outside the outer lines.
  const bad = mk([[0, 0, 414, 1018], [6.1, 0, 1506, 1019], [0, 13.4, 544, 588], [6.1, 13.4, 1372, 588], [3.05, 4.72, 963, 822], [0.46, 0, 500, 1018], [5.64, 0, 1422, 1018]]);
  const camBad = fitCamera(bad, 1920, 1080, 0)!;
  // The lens curve may not soak up the mistake as a strong (unphysical) distortion...
  assert.ok(camBad.lens.lambda <= 0.05 + 1e-9, `lambda ${camBad.lens.lambda}`);
  // ...and the assistant is told.
  assert.ok(suspectTap(camBad, bad, 1920));
});

test("shuttle candidates: feet are masked, an isolated blob in flight is kept, the racket zone stays open", async () => {
  const { shuttleCandidates } = await import("../lib/ma/shuttle.ts");
  const blob = (x: number, y: number, area = 4) => ({ x, y, area, minX: x - 1, maxX: x + 1, minY: y - 1, maxY: y + 1, bright: 200 });
  const player: [number, number, number, number] = [200, 100, 60, 150]; // analysis px = video px here
  const out = shuttleCandidates([blob(205, 245), blob(400, 60), blob(205, 120)], 1, [player], 640 * 360);
  const at = (x: number, y: number) => out.some((c) => Math.abs(c.x - x) < 1 && Math.abs(c.y - y) < 1);
  assert.ok(!at(205, 245), "a moving shoe at the box's bottom corner is not a shuttle");
  assert.ok(at(400, 60), "an isolated blob away from players is a candidate");
  assert.ok(at(205, 120), "beside the shoulders (racket zone) stays a candidate");
});
