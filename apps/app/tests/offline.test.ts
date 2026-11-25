// Offline (src/lib/offline.ts): the saved screens are only for the person who
// saved them and only for a week; only the named screens are saved; the
// queue keeps the latest change per club and day and sends in order,
// stopping while there's still no connection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { enqueue, flushQueue, ownerOf, queued, restoreCache, saveCache, clearOffline } from "../src/lib/offline.ts";
import { memoryStorage } from "../src/lib/storage.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the saved screens: the named queries only, back for the same person, not for another or after a week", async () => {
  const storage = memoryStorage();
  const a = new QueryClient();
  const stop = saveCache(a, storage, () => "token-a", 5);
  a.setQueryData(["me", "club", "token-a"], { hello: 1 });
  a.setQueryData(["arena", "club", "token-a"], { board: [] });
  a.setQueryData(["messages", "club", "token-a"], { private: true });
  await wait(20);
  stop();
  const raw = storage.get("cache") ?? "";
  assert.ok(raw.includes('"hello"') && raw.includes('"board"'));
  assert.equal(raw.includes("private"), false, "the inbox isn't saved");
  assert.equal(JSON.parse(raw).owner, ownerOf("token-a"), "the owner is a fingerprint, not the token");

  const same = new QueryClient();
  assert.equal(restoreCache(same, storage, "token-a"), true);
  assert.deepEqual(same.getQueryData(["me", "club", "token-a"]), { hello: 1 });

  assert.equal(restoreCache(new QueryClient(), storage, "token-b"), false, "someone else signed in");
  assert.equal(storage.get("cache"), null, "and it's gone");

  const old = new QueryClient();
  const stop2 = saveCache(old, storage, () => "token-a", 5);
  old.setQueryData(["me", "club", "token-a"], { hello: 2 });
  await wait(20);
  stop2();
  assert.equal(restoreCache(new QueryClient(), storage, "token-a", Date.now() + 8 * 24 * 3600_000), false, "older than a week");
  assert.equal(restoreCache(new QueryClient(), memoryStorage(), null), false);
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
  assert.equal(await flushQueue(storage, async (q) => (sent.push(q.date), "done")), 2);
  assert.deepEqual(sent, ["2026-12-08", "2026-12-08", "2026-12-01"]);
  assert.equal(storage.get("queue"), null);

  enqueue(storage, { club: "c", date: "2026-12-15", absent: true });
  storage.set("cache", "{}");
  clearOffline(storage);
  assert.deepEqual([storage.get("queue"), storage.get("cache")], [null, null], "signing out removes both");
});
