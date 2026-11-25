// Several clubs: the navigation rules and Home's merging (src/lib/nav.ts, src/lib/home.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isHomePath, moduleForPath, spaceClub, visibleTabsAcross } from "../src/lib/nav.ts";
import { initials, latestThreads, mergeCalendars, nextAcross } from "../src/lib/home.ts";

// Start times are instants (UTC here); "19:00" is short for that time on the day.
const day = (date: string, extra: Partial<{ startTime: string | null; paused: boolean; booked: boolean; included: boolean }> = {}) => {
  const { startTime = "19:00", ...rest } = extra;
  return { date, startTime: startTime && `${date}T${startTime}:00Z`, paused: false, booked: false, included: false, ...rest };
};
const hhmm = (iso: string | null) => iso?.slice(11, 16) ?? null;

describe("several clubs: where Home ends and a club's space begins", () => {
  test("Home is Me, the inbox, Settings and the welcome; the tabs of a club's modules are its spaces", () => {
    for (const p of ["/", "/me", "/welcome", "/inbox", "/inbox/new", "/inbox/12", "/settings"]) assert.equal(isHomePath(p), true, p);
    for (const p of ["/player", "/arena", "/leaderboard", "/vision", "/vision/track", "/membership", "/inboxes"]) assert.equal(isHomePath(p), false, p);
    assert.equal(moduleForPath("/arena"), "arena");
    assert.equal(moduleForPath("/leaderboard"), "arena");
    assert.equal(moduleForPath("/vision/label"), "vision");
    assert.equal(moduleForPath("/player"), null);
    assert.equal(moduleForPath("/membership"), null);
  });

  test("the tabs across clubs: a tab shows when one club has its module; unknown clubs add nothing", () => {
    const ids = (m: (string[] | null)[]) => visibleTabsAcross(m).map((t) => t.id);
    assert.deepEqual(ids([["vision"], ["arena"]]), ["me", "player", "arena", "leaderboard", "vision"]);
    assert.deepEqual(ids([["vision"], null]), ["me", "player", "vision"]);
    assert.deepEqual(ids([null, null]), ["me", "player"]);
  });

  test("a space shows the chosen club when it has the module, else the first that does", () => {
    const clubs = [{ slug: "a", m: ["vision"] }, { slug: "b", m: ["arena", "vision"] }, { slug: "c", m: null as string[] | null }];
    const pick = (chosen: string | null, module: string | null) => spaceClub(clubs, (c) => c.m, chosen, module)?.slug ?? null;
    assert.equal(pick("a", "vision"), "a");
    assert.equal(pick("a", "arena"), "b", "the chosen club has the Arena off");
    assert.equal(pick("c", null), "c", "every club has Player");
    assert.equal(pick("c", "arena"), "b", "a club still loading isn't picked for a module");
    assert.equal(pick("gone", null), "a", "a club the person left: the first");
    assert.equal(pick(null, "gallery"), null);
  });
});

describe("several clubs: Home brings their Me together", () => {
  test("next up: the earliest day the person is in, across clubs", () => {
    const a = { club: "a", calendar: [day("2026-12-04", { included: true, startTime: "19:00" })] };
    const b = { club: "b", calendar: [day("2026-12-01"), day("2026-12-04", { booked: true, startTime: "18:00" })] };
    assert.deepEqual(nextAcross([a, b]), { club: "b", item: b.calendar[1] });
    assert.equal(nextAcross([{ club: "a", calendar: [day("2026-12-01", { included: true, paused: true })] }]), null, "a paused day isn't next");
    assert.equal(nextAcross([]), null);
  });

  test("the calendar: every club's days by day and time; a tie keeps the person's order of clubs", () => {
    const rows = mergeCalendars([
      { club: "a", calendar: [day("2026-12-04"), day("2026-12-02", { startTime: "20:00" })] },
      { club: "b", calendar: [day("2026-12-02", { startTime: "18:30" }), day("2026-12-04")] },
    ]);
    assert.deepEqual(rows.map((r) => `${r.club}:${r.item.date}:${hhmm(r.item.startTime)}`), ["b:2026-12-02:18:30", "a:2026-12-02:20:00", "a:2026-12-04:19:00", "b:2026-12-04:19:00"]);
    const noTime = mergeCalendars([{ club: "a", calendar: [day("2026-12-02", { startTime: null }), day("2026-12-02", { startTime: "08:00" })] }]);
    assert.deepEqual(noTime.map((r) => hhmm(r.item.startTime)), ["08:00", null], "no start time: midday");
  });

  test("messages: the latest across clubs, newest first, as many as asked", () => {
    const t = (id: number, at: string) => ({ id, lastMessageAt: at });
    const merged = latestThreads([{ club: "a", threads: [t(1, "2026-11-20T10:00:00Z"), t(2, "2026-11-24T10:00:00Z")] }, { club: "b", threads: [t(1, "2026-11-22T10:00:00Z")] }], 2);
    assert.deepEqual(merged.map((m) => `${m.club}:${m.item.id}`), ["a:2", "b:1"]);
  });

  test("a club's initials for its badge", () => {
    assert.equal(initials("Three Wolves Badminton Club"), "TW");
    assert.equal(initials("Harbour Smash"), "HS");
    assert.equal(initials("The Club of Shuttles"), "S");
    assert.equal(initials("Câu lạc bộ Sài Gòn"), "CL");
    assert.equal(initials("  "), "?");
  });
});
