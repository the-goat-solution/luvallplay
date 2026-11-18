import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COURT,
  MotionTracker,
  applyHomography,
  buildTracks,
  computeMotion,
  courtDetections,
  courtHomography,
  detectionAtPoint,
  formatClock,
  groupRallies,
  motionAt,
  movementBetween,
  rallyAt,
  rallyReadout,
  shotSpeedKmh,
  solveHomography,
  summarise,
  trackStep,
  type Anchor,
  type Box,
  type PlayerMemory,
  type Pt,
  type Sample,
} from "../lib/match-analyzer.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// A camera looking at the court from behind one baseline: the far end is
// narrower and higher up the image, like a real phone recording.
const TAPS: Pt[] = [
  { x: 300, y: 1000 }, // near-left
  { x: 1620, y: 1000 }, // near-right
  { x: 1260, y: 300 }, // far-right
  { x: 660, y: 300 }, // far-left
];

test("homography maps the tapped corners onto the court corners and back", () => {
  const h = courtHomography(TAPS)!;
  assert.ok(h);
  const corners = TAPS.map((p) => applyHomography(h.toCourt, p));
  close(corners[0].x, 0); close(corners[0].y, 0);
  close(corners[1].x, COURT.width); close(corners[1].y, 0);
  close(corners[2].x, COURT.width); close(corners[2].y, COURT.length);
  close(corners[3].x, 0); close(corners[3].y, COURT.length);
  const back = applyHomography(h.toImage, { x: COURT.width, y: COURT.length });
  close(back.x, 1260, 1e-4); close(back.y, 300, 1e-4);
});

test("perspective: the net is drawn above the image midpoint, closer to the far end", () => {
  const h = courtHomography(TAPS)!;
  const netLeft = applyHomography(h.toImage, { x: 0, y: COURT.net });
  assert.ok(netLeft.y < 650, `net at y=${netLeft.y} should be above the 650 midpoint`);
});

test("rotation swaps which side is the baseline", () => {
  const h = courtHomography(TAPS, 1)!;
  const first = applyHomography(h.toCourt, TAPS[0]);
  close(first.x, COURT.width); close(first.y, 0);
});

test("degenerate taps give no homography", () => {
  const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
  assert.equal(solveHomography(line, line), null);
  assert.equal(courtHomography(TAPS.slice(0, 3)), null);
});

// Builds a person box whose feet stand on court point p.
function boxAt(toImage: number[], p: Pt): Box {
  const f = applyHomography(toImage, p);
  return [f.x - 40, f.y - 300, 80, 300];
}

// Shirt colours as 4-bin histograms.
const RED = [1, 0, 0, 0];
const BLUE = [0, 1, 0, 0];
const WHITE = [0, 0, 1, 0];
const BLACK = [0, 0, 0, 1];

type Walker = { at: (t: number) => Pt; look: number[] };
function scene(h: { toImage: number[] }, walkers: Walker[], steps: number, extra: (t: number) => Pt[] = () => []): Sample[] {
  const out: Sample[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / 10;
    const dets = walkers.map((w) => ({ box: boxAt(h.toImage, w.at(t)), score: 0.9, look: w.look }));
    for (const p of extra(t)) dets.push({ box: boxAt(h.toImage, p), score: 0.95, look: WHITE });
    // Detector order is arbitrary: shuffle it deterministically.
    out.push({ t, dets: k % 2 ? dets.reverse() : dets });
  }
  return out;
}

function tagAll(samples: Sample[], toImage: number[], walkers: Walker[], k: number): Anchor[] {
  return walkers.map((w, player) => ({ sample: k, player, box: boxAt(toImage, w.at(samples[k].t)) }));
}

test("doubles: four tagged players are followed and the umpire is ignored", () => {
  const h = courtHomography(TAPS)!;
  const walkers: Walker[] = [
    { at: (t) => ({ x: 1.5 + t, y: 2 }), look: RED },
    { at: (t) => ({ x: 4.5 - t * 0.5, y: 4.5 }), look: RED },
    { at: (t) => ({ x: 1.5, y: 9 + t }), look: BLUE },
    { at: (t) => ({ x: 4.5, y: 11.5 - t }), look: BLUE },
  ];
  const samples = scene(h, walkers, 20, () => [{ x: -4, y: 6.7 }]);
  const tracks = buildTracks(samples, h.toCourt, 4, tagAll(samples, h.toImage, walkers, 0));
  for (let k = 0; k <= 20; k++) {
    walkers.forEach((w, i) => {
      const want = w.at(samples[k].t);
      close(tracks[i][k]!.p.x, want.x, 1e-6);
      close(tracks[i][k]!.p.y, want.y, 1e-6);
    });
  }
});

test("doubles: partners crossing paths keep their names thanks to shirt colour", () => {
  const h = courtHomography(TAPS)!;
  // Two partners swap sides, passing within 30 cm of each other at t = 1 s.
  const walkers: Walker[] = [
    { at: (t) => ({ x: 1 + 2 * t, y: 3 + 0.15 * Math.sin(t * Math.PI) }), look: RED },
    { at: (t) => ({ x: 5 - 2 * t, y: 3 - 0.15 * Math.sin(t * Math.PI) }), look: BLACK },
  ];
  const samples = scene(h, walkers, 20);
  const tracks = buildTracks(samples, h.toCourt, 2, tagAll(samples, h.toImage, walkers, 0));
  close(tracks[0][20]!.p.x, 5, 1e-6);
  close(tracks[1][20]!.p.x, 1, 1e-6);
});

test("doubles: a later tag fixes a swapped identity from that frame on", () => {
  const h = courtHomography(TAPS)!;
  // Same shirts, and they cross exactly: the tracker cannot know, so it bounces.
  const walkers: Walker[] = [
    { at: (t) => ({ x: 1 + 2 * t, y: 3 }), look: RED },
    { at: (t) => ({ x: 5 - 2 * t, y: 3 }), look: RED },
  ];
  const samples = scene(h, walkers, 20);
  const anchors = tagAll(samples, h.toImage, walkers, 0);
  const before = buildTracks(samples, h.toCourt, 2, anchors);
  const fixedAt = 15;
  const fixed = buildTracks(samples, h.toCourt, 2, [...anchors, { sample: fixedAt, player: 0, box: boxAt(h.toImage, walkers[0].at(1.5)) }]);
  close(fixed[0][20]!.p.x, 5, 1e-6);
  close(fixed[1][20]!.p.x, 1, 1e-6);
  // Before the fix tag nothing changes.
  for (let k = 0; k < fixedAt; k++) assert.deepEqual(fixed[0][k], before[0][k]);
});

test("a player tagged late is also followed backwards to the start", () => {
  const h = courtHomography(TAPS)!;
  const walkers: Walker[] = [
    { at: (t) => ({ x: 1, y: 2 + t }), look: RED },
    { at: (t) => ({ x: 5, y: 10 - t }), look: BLUE },
  ];
  const samples = scene(h, walkers, 10);
  const tracks = buildTracks(samples, h.toCourt, 2, [
    { sample: 0, player: 0, box: boxAt(h.toImage, walkers[0].at(0)) },
    { sample: 6, player: 1, box: boxAt(h.toImage, walkers[1].at(0.6)) },
  ]);
  for (let k = 0; k <= 10; k++) {
    close(tracks[0][k]!.p.y, 2 + k / 10, 1e-6);
    close(tracks[1][k]!.p.y, 10 - k / 10, 1e-6);
  }
});

test("live tracking: a tap pins a player, then they are followed frame by frame", () => {
  const h = courtHomography(TAPS)!;
  const memory: PlayerMemory[] = [null, null, null, null];
  const frame = (t: number) => courtDetections([
    { box: boxAt(h.toImage, { x: 1 + t, y: 2 }), score: 0.9 },
    { box: boxAt(h.toImage, { x: 3, y: 10 }), score: 0.9 },
  ], h.toCourt);
  // Before any tap nobody is tracked.
  assert.deepEqual(trackStep(memory, frame(0), 0), [null, null, null, null]);
  // The assistant taps the near player and names them player 2.
  const dets0 = frame(0);
  const tapped = detectionAtPoint(dets0, applyHomography(h.toImage, { x: 1, y: 2 }), 0)!;
  const got0 = trackStep(memory, dets0, 0, new Map([[2, dets0.indexOf(tapped)]]));
  assert.equal(got0[2], dets0.indexOf(tapped));
  for (let k = 1; k <= 10; k++) {
    const dets = frame(k / 10);
    const got = trackStep(memory, dets, k / 10);
    close(dets[got[2]!].p.x, 1 + k / 10, 1e-6);
    assert.equal(got[0], null);
  }
});

test("a tap on two overlapping people picks the smaller (nearer-looking) box", () => {
  const dets = [
    { box: [100, 100, 200, 400] as Box, score: 0.9 },
    { box: [150, 200, 100, 200] as Box, score: 0.9 },
  ];
  assert.equal(detectionAtPoint(dets, { x: 200, y: 300 }), dets[1]);
  assert.equal(detectionAtPoint(dets, { x: 120, y: 120 }), dets[0]);
  assert.equal(detectionAtPoint(dets, { x: 10, y: 10 }), null);
});

test("motion: distance and top speed of a steady 2 m/s run, with short gaps bridged", () => {
  const times = Array.from({ length: 31 }, (_, k) => k / 10);
  const track = times.map((t, k) => (k === 12 || k === 13 ? null : { p: { x: 0, y: 2 * t }, box: [0, 0, 1, 1] as Box }));
  const m = computeMotion(times, track);
  close(m.cumDist[30], 6, 1e-6);
  const { distance, topSpeed } = movementBetween(m, 1, 2);
  close(distance, 2, 1e-6);
  close(topSpeed, 2, 1e-6);
  close(motionAt(m, 1.25)!.p.y, 2.5, 1e-6);
});

test("motion: a detector glitch does not count as distance", () => {
  const times = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const ys = [0, 0, 0, 30, 0, 0, 0];
  const m = computeMotion(times, ys.map((y) => ({ p: { x: 0, y }, box: [0, 0, 1, 1] as Box })));
  assert.equal(m.cumDist[6], 0);
  assert.ok(Math.max(...m.speed) <= 9);
});

test("rallies split on long pauses and stay on screen until the next serve", () => {
  const hits = [
    { t: 1, player: 0 }, { t: 2, player: 1 }, { t: 3, player: 0 },
    { t: 12, player: 1 }, { t: 13.5, player: 0 },
  ];
  const rallies = groupRallies(hits, 4);
  assert.equal(rallies.length, 2);
  assert.equal(rallies[0].hits.length, 3);
  assert.equal(rallies[0].end, 4);
  assert.equal(rallyAt(rallies, 0.5), null);
  assert.deepEqual(
    { i: rallyAt(rallies, 2.5)!.index, live: rallyAt(rallies, 2.5)!.live },
    { i: 0, live: true },
  );
  assert.deepEqual(
    { i: rallyAt(rallies, 8)!.index, live: rallyAt(rallies, 8)!.live },
    { i: 0, live: false },
  );
  assert.equal(rallyAt(rallies, 12)!.index, 1);
});

test("shot speed and clock formatting", () => {
  // 10 m across the floor plus 2 m of height in 1 s ≈ 36.7 km/h.
  close(shotSpeedKmh({ x: 0, y: 0 }, { x: 0, y: 10 }, 1)!, Math.hypot(10, 2) * 3.6, 1e-9);
  assert.equal(shotSpeedKmh({ x: 0, y: 0 }, { x: 0, y: 10 }, 0), null);
  assert.equal(formatClock(10.03), "00:10.03");
  assert.equal(formatClock(75.5), "01:15.50");
});

test("MotionTracker (live) gives the same numbers as computeMotion (upload)", () => {
  // A wandering path at ~15 fps with jitter, dropouts and a few glitches.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const times: number[] = [];
  const track: ({ p: Pt; box: Box } | null)[] = [];
  let t = 0, x = 3, y = 3;
  for (let k = 0; k < 600; k++) {
    t += 0.05 + rand() * 0.04;
    x += (rand() - 0.5) * 0.3;
    y += (rand() - 0.5) * 0.3;
    times.push(t);
    const r = rand();
    if (r < 0.1) track.push(null); // missed detection
    else if (r < 0.12 && k > 40 && k < 60) track.push(null); // longer dropout
    else if (r < 0.13) track.push({ p: { x: x + 20, y }, box: [0, 0, 1, 1] }); // glitch
    else track.push({ p: { x: x + (rand() - 0.5) * 0.05, y }, box: [x, y, 1, 1] });
  }
  const full = computeMotion(times, track);
  const live = new MotionTracker();
  times.forEach((tt, k) => live.push(tt, track[k]));
  for (let k = 0; k < times.length; k++) {
    close(live.motion.cumDist[k], full.cumDist[k], 1e-9);
    close(live.motion.speed[k], full.speed[k], 1e-9);
    assert.deepEqual(live.motion.p[k], full.p[k]);
  }
});

test("rally over marker splits rallies even without a pause", () => {
  const hits = [{ t: 1, player: 0 }, { t: 2, player: 2 }, { t: 3, player: 0 }, { t: 4, player: 3 }];
  const rallies = groupRallies(hits, 4, [3.5]);
  assert.equal(rallies.length, 2);
  assert.equal(rallies[0].hits.length, 3);
  close(rallies[0].end, 3.5);
  assert.equal(rallies[1].hits[0].t, 4);
});

test("rally readout and match summary", () => {
  // Team A (players 0, 1) near half, team B (2, 3) far half; everyone stands still.
  const spots: Pt[] = [{ x: 1.5, y: 2 }, { x: 4.5, y: 4 }, { x: 1.5, y: 9 }, { x: 4.5, y: 11 }];
  const positionAt = (p: number) => spots[p];
  const hits = [
    { t: 1, player: 0 }, { t: 2, player: 2 }, { t: 3, player: 1 }, { t: 3.4, player: 1 }, // a double tap on one side
    { t: 20, player: 3 }, { t: 21, player: 0 },
  ];
  const rallies = groupRallies(hits, 4);
  const r = rallyReadout(rallies, 2.5, 4, positionAt)!;
  assert.equal(r.index, 0);
  assert.equal(r.total, 2);
  assert.equal(r.count, 2);
  close(r.time, 1.5);
  assert.deepEqual(r.hitsBy, [1, 0, 1, 0]);
  close(r.shotKmh!, shotSpeedKmh(spots[0], spots[2], 1)!, 1e-9);
  // After the same-side double tap the last real shot speed is kept.
  const later = rallyReadout(rallies, 3.6, 4, positionAt)!;
  close(later.shotKmh!, shotSpeedKmh(spots[2], spots[1], 1)!, 1e-9);
  // Frozen after the rally ends.
  close(rallyReadout(rallies, 10, 4, positionAt)!.time, 3.4 + 1 - 1);

  const times = [0, 10, 30];
  const motions = spots.map((p) => computeMotion(times, times.map(() => ({ p, box: [0, 0, 1, 1] as Box }))));
  const sum = summarise(motions, hits, rallies, 0, 30, positionAt);
  assert.equal(sum.rallies, 2);
  assert.equal(sum.longestRally, 4);
  assert.equal(sum.avgRallyShots, 3);
  assert.deepEqual(sum.players.map((p) => p.hits), [2, 2, 1, 1]);
  assert.equal(sum.players[0].distance, 0);
  assert.ok(sum.fastestShotKmh! > 0);
});

test("calibration from any four or more court points, not just the corners", async () => {
  const { courtHomographyFromTaps, courtLandmarks, landmarkId } = await import("../lib/match-analyzer.ts");
  const truth = courtHomography(TAPS)!;
  // Net posts and the near short service line corners: the near baseline is out of shot.
  const picks = [{ x: 0, y: 6.7 }, { x: 6.1, y: 6.7 }, { x: 0, y: 4.72 }, { x: 6.1, y: 4.72 }];
  const ids = new Set(courtLandmarks().map((l) => l.id));
  for (const p of picks) assert.ok(ids.has(landmarkId(p)), `landmark ${landmarkId(p)}`);
  const taps = picks.map((court) => ({ court, image: applyHomography(truth.toImage, court) }));
  const h = courtHomographyFromTaps(taps)!;
  const far = applyHomography(h.toImage, { x: 6.1, y: 13.4 });
  close(far.x, 1260, 1e-3);
  close(far.y, 300, 1e-3);
  // Six slightly-off taps (±3 px) still give a court within a few centimetres.
  const more = [...picks, { x: 3.05, y: 13.4 }, { x: 0.46, y: 0.76 }];
  let k = 0;
  const noisy = more.map((court) => {
    const q = applyHomography(truth.toImage, court);
    k++;
    return { court, image: { x: q.x + (k % 2 ? 3 : -3), y: q.y + (k % 3 ? -2 : 2) } };
  });
  const h2 = courtHomographyFromTaps(noisy)!;
  const mid = applyHomography(h2.toCourt, applyHomography(truth.toImage, { x: 3, y: 9 }));
  assert.ok(Math.hypot(mid.x - 3, mid.y - 9) < 0.1, `off by ${Math.hypot(mid.x - 3, mid.y - 9)}`);
  // Three points in a line cannot define the court.
  const line = [{ x: 0, y: 0 }, { x: 0, y: 4.72 }, { x: 0, y: 6.7 }, { x: 0, y: 13.4 }].map((court) => ({ court, image: applyHomography(truth.toImage, court) }));
  assert.equal(courtHomographyFromTaps(line), null);
});
