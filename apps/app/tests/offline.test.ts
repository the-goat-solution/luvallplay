// Offline (src/lib/offline.ts): the saved screens are only for the person who
// saved them and only for a week; only the named screens are saved; the
// queue keeps the latest change per club and day and sends in order,
// stopping while there's still no connection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { readFileSync, readdirSync } from "node:fs";
import { clearOffline, dropped, enqueue, flushQueue, forgetDropped, ownerOf, queued, restoreCache, saveCache, watchQueue, withPending } from "../src/lib/offline.ts";
import { memoryStorage } from "../src/lib/storage.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the saved screens: the named queries only, back for the same person, not for another or after a week", async () => {
  const storage = memoryStorage();
  const a = new QueryClient();
  const stop = saveCache(a, storage, () => "token-a", 5);
  a.setQueryData(["me", "club", ownerOf("token-a")], { hello: 1 });
  a.setQueryData(["arena", "club", ownerOf("token-a")], { board: [] });
  a.setQueryData(["messages", "club", ownerOf("token-a")], { private: true });
  await wait(20);
  stop();
  const raw = storage.get("cache") ?? "";
  assert.ok(raw.includes('"hello"') && raw.includes('"board"'));
  assert.equal(raw.includes("private"), false, "the inbox isn't saved");
  assert.equal(JSON.parse(raw).owner, ownerOf("token-a"), "the owner is a fingerprint, not the token");

  const same = new QueryClient();
  assert.equal(restoreCache(same, storage, "token-a"), true);
  assert.deepEqual(same.getQueryData(["me", "club", ownerOf("token-a")]), { hello: 1 });

  assert.equal(restoreCache(new QueryClient(), storage, "token-b"), false, "someone else signed in");
  assert.equal(storage.get("cache"), null, "and it's gone");

  const old = new QueryClient();
  const stop2 = saveCache(old, storage, () => "token-a", 5);
  old.setQueryData(["me", "club", ownerOf("token-a")], { hello: 2 });
  await wait(20);
  stop2();
  assert.equal(restoreCache(new QueryClient(), storage, "token-a", Date.now() + 8 * 24 * 3600_000), false, "older than a week");
  assert.equal(restoreCache(new QueryClient(), memoryStorage(), null), false);
});

test("the saved screens never hold the session token, and a new build starts from nothing", async () => {
  const storage = memoryStorage();
  const token = "tw_0123456789abcdef0123456789abcdef";
  const client = new QueryClient();
  const stop = saveCache(client, storage, () => token, 5, "build-1");
  client.setQueryData(["me", "club", ownerOf(token)], { hello: 1 });
  await wait(20);
  const raw = storage.get("cache") ?? "";
  assert.ok(raw.includes('"hello"'));
  assert.equal(raw.includes(token), false);
  assert.equal(JSON.parse(raw).build, "build-1");

  // Another build of the app: what this one saved isn't read back.
  assert.equal(restoreCache(new QueryClient(), storage, token, Date.now(), "build-2"), false);
  assert.equal(storage.get("cache"), null);

  // Should a key ever carry the token again, nothing is written at all.
  client.setQueryData(["me", "club", token], { hello: 2 });
  await wait(20);
  stop();
  assert.equal(storage.get("cache"), null);

  // What an older version of the app saved (keys with the token in them) is removed at start.
  storage.set("cache", JSON.stringify({ owner: ownerOf(token), build: "build-1", at: Date.now(), state: { mutations: [], queries: [{ queryKey: ["me", "club", token] }] } }));
  assert.equal(restoreCache(new QueryClient(), storage, token, Date.now(), "build-1"), false);
  assert.equal(storage.get("cache"), null);
});

test("no query key in the app is built from the session token", () => {
  const dir = new URL("../src/", import.meta.url);
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
  assert.ok(files.length > 40);
  for (const f of files) {
    const source = readFileSync(new URL(f, dir), "utf8");
    for (const line of source.split("\n")) {
      if (/queryKey|Key\b.*=.*\[|key:\s*\[|setQueryData|invalidateQueries/.test(line)) assert.doesNotMatch(line, /\btoken\b/, `${f}: ${line.trim()}`);
    }
  }
});

test("the queue: one change per club and day (the latest), sent in order, kept while still offline", async () => {
  const storage = memoryStorage();
  enqueue(storage, { club: "c", date: "2026-12-01", absent: true }, 1);
  enqueue(storage, { club: "c", date: "2026-12-08", absent: true }, 2);
  enqueue(storage, { club: "c", date: "2026-12-01", absent: false }, 3);
  assert.deepEqual(queued(storage).map((q) => [q.date, q.absent]), [["2026-12-08", true], ["2026-12-01", false]]);

  const sent: string[] = [];
  assert.equal(await flushQueue(storage, async (q) => (sent.push(q.date), "later")), 0);
  assert.equal(queued(storage).length, 2, "nothing lost while offline");
  const taken: string[] = [];
  assert.equal(await flushQueue(storage, async (q) => (sent.push(q.date), "sent"), (q) => taken.push(q.date)), 2);
  assert.deepEqual(sent, ["2026-12-08", "2026-12-08", "2026-12-01"]);
  assert.deepEqual(taken, ["2026-12-08", "2026-12-01"], "each sent change is handed to the screens before it leaves the queue");
  assert.equal(storage.get("queue"), null);

  enqueue(storage, { club: "c", date: "2026-12-15", absent: true });
  storage.set("cache", "{}");
  storage.set("dropped", "[]");
  clearOffline(storage);
  assert.deepEqual([storage.get("queue"), storage.get("cache"), storage.get("dropped")], [null, null, null], "signing out removes all of it");
});

test("the queue: a refused change is put aside to be told, and a newer choice for the day replaces both", async () => {
  const storage = memoryStorage();
  let told = 0;
  const stop = watchQueue(() => told++);
  enqueue(storage, { club: "c", date: "2026-12-01", absent: true }, 1);
  enqueue(storage, { club: "c", date: "2026-12-08", absent: true }, 2);
  assert.equal(await flushQueue(storage, async (q) => (q.date === "2026-12-01" ? { refused: "too_late" } : "sent")), 2);
  assert.deepEqual(queued(storage), []);
  assert.deepEqual(dropped(storage), [{ club: "c", date: "2026-12-01", absent: true, code: "too_late" }]);
  assert.ok(told >= 3, "the screens are told of every change");

  // Choosing again for that day: the refusal is forgotten, the new choice waits.
  enqueue(storage, { club: "c", date: "2026-12-01", absent: true }, 5);
  assert.deepEqual(dropped(storage), []);
  assert.equal(queued(storage).length, 1);

  // A choice made again while the older one is on its way: the older answer doesn't remove or refuse the newer one.
  assert.equal(
    await flushQueue(storage, async (q) => {
      if (q.at === 5) {
        enqueue(storage, { club: "c", date: "2026-12-01", absent: false }, 6);
        return { refused: "conflict" };
      }
      return "sent";
    }),
    2,
  );
  assert.deepEqual(dropped(storage), [], "the refusal was for a choice the person has already changed");
  assert.deepEqual(queued(storage), []);

  enqueue(storage, { club: "c", date: "2026-12-22", absent: true }, 7);
  await flushQueue(storage, async () => ({ refused: "gone" }));
  forgetDropped(storage, { club: "c", date: "2026-12-22" });
  assert.equal(storage.get("dropped"), null);
  stop();
});

test("choices that wait show over what the club last said", () => {
  const day = (date: string, absent: boolean, included = true) => ({ date, absent, spots: 3, included });
  const calendar = [day("2026-12-01", false), day("2026-12-08", true), day("2026-12-15", false, false)];
  const waiting = [
    { kind: "absence" as const, club: "c", date: "2026-12-01", absent: true, at: 1 },
    { kind: "absence" as const, club: "c", date: "2026-12-08", absent: true, at: 2 },
    { kind: "absence" as const, club: "c", date: "2026-12-15", absent: true, at: 3 },
    { kind: "absence" as const, club: "other", date: "2026-12-08", absent: false, at: 4 },
  ];
  assert.deepEqual(withPending(calendar, "c", waiting), [{ ...day("2026-12-01", true), spots: 4 }, day("2026-12-08", true), day("2026-12-15", false, false)]);
  assert.equal(withPending(calendar, "none", waiting), calendar, "nothing waiting for this club: the same list");
});
