import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COURT,
  applyHomography,
  buildTracks,
  computeMotion,
  courtHomography,
  formatClock,
  groupRallies,
  motionAt,
  movementBetween,
  rallyAt,
  seedPlayers,
  shotSpeedKmh,
  solveHomography,
  swapTracks,
  type Box,
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

test("tracking keeps two players apart and ignores people off court", () => {
  const h = courtHomography(TAPS)!;
  const samples: Sample[] = [];
  for (let k = 0; k <= 20; k++) {
    const t = k / 10;
    const a = { x: 1 + t, y: 3 }; // near player walks right
    const b = { x: 5 - t, y: 10 }; // far player walks left
    samples.push({
      t,
      dets: [
        { box: boxAt(h.toImage, b), score: 0.9 },
        { box: boxAt(h.toImage, a), score: 0.8 },
        { box: boxAt(h.toImage, { x: -4, y: 6 }), score: 0.95 }, // umpire, well off court
      ],
    });
  }
  const seeds = seedPlayers(samples[0], h.toCourt, 2);
  assert.equal(seeds.length, 2);
  const tracks = buildTracks(samples, h.toCourt, 0, seeds);
  const near = tracks.findIndex((t) => t[0]!.p.y < 6.7);
  const far = 1 - near;
  for (let k = 0; k <= 20; k++) {
    close(tracks[near][k]!.p.x, 1 + k / 10, 1e-6);
    close(tracks[far][k]!.p.x, 5 - k / 10, 1e-6);
  }
});

test("tracking runs backwards from a seed in the middle", () => {
  const h = courtHomography(TAPS)!;
  const samples: Sample[] = [];
  for (let k = 0; k <= 10; k++) {
    samples.push({ t: k / 10, dets: k === 0 ? [] : [{ box: boxAt(h.toImage, { x: 3, y: 2 + k / 10 }), score: 0.9 }] });
  }
  const tracks = buildTracks(samples, h.toCourt, 5, seedPlayers(samples[5], h.toCourt, 1));
  assert.equal(tracks[0][0], null); // nobody detected there
  close(tracks[0][1]!.p.y, 2.1, 1e-6);
  close(tracks[0][10]!.p.y, 3, 1e-6);
});

test("swapTracks swaps only from the given sample", () => {
  const p = (x: number) => ({ p: { x, y: 0 }, box: [0, 0, 1, 1] as Box });
  const tracks = [[p(1), p(1), p(1)], [p(2), p(2), p(2)]];
  const out = swapTracks(tracks, 0, 1, 1);
  assert.deepEqual(out[0].map((tp) => tp!.p.x), [1, 2, 2]);
  assert.deepEqual(out[1].map((tp) => tp!.p.x), [2, 1, 1]);
  assert.equal(tracks[0][1]!.p.x, 1); // original untouched
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
