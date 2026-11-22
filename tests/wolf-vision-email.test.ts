import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatsEmail } from "../lib/wolf-vision-email.ts";

const base = {
  siteUrl: "https://example.org/",
  recipientName: "Anna <b>Lee</b>",
  recipientIndex: 2,
  recordedBy: "Tim L.",
  playedAt: "Fri 21 Nov 2026, 7:40 pm",
  teams: ["Tim & Kim", "Anna & Bo"] as [string, string],
  duration: 1325,
  rallies: 31,
  longestRally: 18,
  avgRallyShots: 6.4,
  fastestShotKmh: 212,
  players: [
    { name: "Tim L.", team: 0 as const, hits: 41, distance: 812.4, topSpeed: 5.2 },
    { name: "Kim T.", team: 0 as const, hits: 38, distance: 760, topSpeed: 4.9 },
    { name: "Anna <b>Lee</b>", team: 1 as const, hits: 44, distance: 901.25, topSpeed: 5.6 },
    { name: "Bo", team: 1 as const, hits: 35, distance: 700, topSpeed: 4.4 },
  ],
};

test("stats email: names are escaped, the recipient's row is marked, numbers formatted", () => {
  const e = renderStatsEmail({ ...base, freeUntil: "28 February 2027" });
  assert.match(e.subject, /Wolf Vision/);
  assert.ok(!e.html.includes("<b>Lee</b>"), "HTML in a name must be escaped");
  assert.ok(e.html.includes("Anna &lt;b&gt;Lee&lt;/b&gt;"));
  assert.ok(e.html.includes("Kia ora Anna"));
  assert.ok(e.html.includes("901.3 m") || e.html.includes("901.2 m"));
  assert.ok(e.html.includes("22:05"), "duration as m:ss");
  assert.ok(e.html.includes("212 km/h"));
  assert.equal((e.html.match(/>YOU</g) ?? []).length, 1);
  assert.ok(e.html.includes("https://example.org/login"));
  assert.ok(e.html.includes("free to try until 28 February 2027"));
  assert.match(e.text, /Anna <b>Lee<\/b> \(you\): 44 hits/);
});

test("stats email: no free-period line after the trial, no fastest shot", () => {
  const e = renderStatsEmail({ ...base, fastestShotKmh: null, freeUntil: null });
  assert.ok(!e.html.includes("free to try"));
  assert.ok(e.html.includes(">–<"));
});

test("stats email: a singles game says so", () => {
  const e = renderStatsEmail({ ...base, recipientIndex: 1, teams: ["Tim", "Anna"], players: [base.players[0], base.players[2]] });
  assert.match(e.html, /singles game/);
  assert.match(e.html, /both players/);
  assert.match(e.text, /singles game/);
});
