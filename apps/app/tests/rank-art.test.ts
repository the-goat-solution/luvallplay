// The ladder's drawings in both sets (packages/core rank-art): Three Wolves'
// own, and Luvallplay's plain set that every other club gets in its colours.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS, LADDER } from "@luvallplay/core/ranks";
import { achievementArt, artSetOf, crownArt, rankArt, seatArt } from "@luvallplay/core/rank-art";

const WOLF_HEAD = "M32 55L20.5 42L15 23.5L13.5 7.5";

describe("rank art sets", () => {
  test("a club's art set: Three Wolves keeps its own, everyone else gets the plain set", () => {
    assert.equal(artSetOf("three-wolves"), "three-wolves");
    assert.equal(artSetOf("luvallplay"), "luvallplay");
    assert.equal(artSetOf(undefined), "luvallplay");
    assert.equal(artSetOf("anything-else"), "luvallplay");
  });

  test("every rank, seat, crown and achievement draws in both sets and both sizes", () => {
    for (const set of ["three-wolves", "luvallplay"] as const) {
      for (const size of ["lg", "sm"] as const) {
        LADDER.forEach((_, i) => assert.ok(rankArt(i, size, `t${i}`, set).length > 100, `${set} ${size} rank ${i}`));
        for (const seat of ["alpha", "silver"] as const) assert.ok(seatArt(seat, size, "s", set).includes("<path"));
        for (const kind of ["crown-pair", "pack-leader", "season-champion"] as const) assert.ok(crownArt(kind, size, "c", set).includes("<"));
        for (const a of ACHIEVEMENTS) assert.ok(achievementArt(a.key, size, "a", set).includes("<"));
      }
    }
  });

  test("the plain set draws no wolves, no rackets and no paw, and takes the club's colours", () => {
    for (const seat of ["alpha", "silver"] as const) assert.doesNotMatch(seatArt(seat, "lg", "s", "luvallplay"), new RegExp(WOLF_HEAD));
    assert.match(seatArt("alpha", "lg", "s", "three-wolves"), new RegExp(WOLF_HEAD));
    LADDER.forEach((_, i) => {
      const art = rankArt(i, "lg", "x", "luvallplay");
      assert.doesNotMatch(art, /clip-path/, `rank ${i}: no racket strings`);
      assert.match(art, /class="art-/, `rank ${i}: club-coloured`);
    });
    assert.doesNotMatch(crownArt("pack-leader", "lg", "c", "luvallplay"), /ellipse/);
  });

  test("Three Wolves' drawings are unchanged by default (the website calls them without a set)", () => {
    LADDER.forEach((_, i) => assert.equal(rankArt(i, "lg", "x"), rankArt(i, "lg", "x", "three-wolves")));
    assert.doesNotMatch(rankArt(5, "lg", "x"), /class="art-/);
  });
});
