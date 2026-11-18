import { test } from "node:test";
import assert from "node:assert/strict";
import { MatchSim, CAMERA_VIEWS } from "../lib/ma/sim.ts";
import { runSim } from "../lib/ma/simrun.ts";
import { refundDecision, finishedSessionFailure, AUTO_REFUNDS_PER_30_DAYS } from "../lib/wolf-vision-rules.ts";

// Wolf Vision from any phone position, and the pay-per-use refund rules.

test("every camera position keeps the whole court in shot, on both lenses", () => {
  for (const lens of ["wide", "ultrawide"] as const) {
    for (const view of CAMERA_VIEWS) {
      const sim = new MatchSim({ w: 640, h: 360, view, lens });
      for (const [x, y] of [[0, 0], [6.1, 0], [6.1, 13.4], [0, 13.4]]) {
        const p = sim.project([x, y, 0], false);
        assert.ok(p && p.x > 4 && p.y > 4 && p.x < 636 && p.y < 356, `${view} ${lens}: corner ${x},${y} out of shot`);
      }
    }
  }
});

test("side-on camera: the four players keep their identities (slots are court-based, not left/right on screen)", () => {
  const r = runSim({ w: 640, h: 360, view: "side", seed: 11 }, 20);
  assert.ok(r.identity > 0.95, `identity ${r.identity}`);
  assert.ok(r.hits.recall > 0.5, `recall ${r.hits.recall}`);
});

test("corner camera: identities and hits hold up", () => {
  const r = runSim({ w: 640, h: 360, view: "corner", seed: 23 }, 20);
  assert.ok(r.identity > 0.95, `identity ${r.identity}`);
  assert.ok(r.hits.precision > 0.6, `precision ${r.hits.precision}`);
});

test("distance covered is within 20 % of the truth (detector jitter is not counted as running)", () => {
  for (const view of ["baseline", "low"] as const) {
    const r = runSim({ w: 640, h: 360, view, seed: 11 }, 20);
    assert.ok(r.distanceRatio > 0.8 && r.distanceRatio < 1.2, `${view}: measured ÷ true = ${r.distanceRatio}`);
  }
});

test("a shaky phone does not inflate distances", () => {
  const r = runSim({ w: 640, h: 360, shake: 2.5, seed: 11 }, 20);
  assert.ok(r.distanceRatio < 1.15, `measured ÷ true = ${r.distanceRatio}`);
});

test("a 60 fps camera finds hits as well as 30 fps (analysed at ~30 fps)", () => {
  const a = runSim({ w: 640, h: 360, seed: 23 }, 20);
  const b = runSim({ w: 640, h: 360, seed: 23, fps: 60 }, 20);
  assert.ok(b.hits.recall >= a.hits.recall - 0.12, `60 fps recall ${b.hits.recall} vs 30 fps ${a.hits.recall}`);
});

test("refunds: technical failures of paid sessions are refunded, up to a monthly limit; then an admin reviews", () => {
  const base = { pricePaid: 500, alreadyRefunded: false, reason: "camera_failed", recentAutoRefunds: 0 };
  assert.equal(refundDecision(base), "refund");
  assert.equal(refundDecision({ ...base, reason: "dropped" }), "refund");
  assert.equal(refundDecision({ ...base, recentAutoRefunds: AUTO_REFUNDS_PER_30_DAYS }), "review");
  assert.equal(refundDecision({ ...base, alreadyRefunded: true }), "none");
  assert.equal(refundDecision({ ...base, pricePaid: 0 }), "none");
  assert.equal(refundDecision({ ...base, reason: "changed_my_mind" }), "none");
});

test("refunds: a finished session counts as failed when tracking or quality collapsed", () => {
  assert.equal(finishedSessionFailure({ quality: 0.8, trackedPlayers: 4, duration: 900, hits: 300 }), null);
  assert.equal(finishedSessionFailure({ quality: 0.8, trackedPlayers: 0, duration: 900, hits: 0 }), "tracking_lost");
  assert.equal(finishedSessionFailure({ quality: 0.2, trackedPlayers: 4, duration: 900, hits: 50 }), "quality_collapsed");
  assert.equal(finishedSessionFailure({ quality: 0.8, trackedPlayers: 4, duration: 600, hits: 0 }), "tracking_lost");
  // A 30 s test is not judged.
  assert.equal(finishedSessionFailure({ quality: 0.1, trackedPlayers: 0, duration: 30, hits: 0 }), null);
});
