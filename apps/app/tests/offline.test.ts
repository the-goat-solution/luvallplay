// Offline (src/lib/offline.ts): the saved screens are only for the person who
// saved them and only for a week; only the named screens are saved; the
// queue keeps the latest change per club and day and sends in order,
// stopping while there's still no connection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { readFileSync, readdirSync } from "node:fs";
import { clearOffline, dropped, enqueue, flushQueue, forgetDropped, ownerOf, queued, restoreCache, saveCache, watchQueue, withPending } from "../src/lib/offline.ts";
import { browserStorage, memoryStorage, type SecretStore } from "../src/lib/storage.ts";
import { createStore } from "../src/lib/store.ts";

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

// The whole path, as the app wires it (src/app.ts, src/main.tsx): the real
// storage under its "lp." prefix, the real store holding the session, the
// real saving of screens. Then everything this device was asked to keep is
// read back and searched for the token.
test("signed in and used: nothing kept in lp.cache holds the session token, and in the store app nothing in the page's storage does", async () => {
  const token = "tw_Zq7-RECOGNISABLE_session.token_0123456789abcdef";
  // Every way the token could be written down: as it is, in base64 or hex, backwards, or a part of it.
  const forms = [token, Buffer.from(token).toString("base64"), Buffer.from(token).toString("base64url"), Buffer.from(token).toString("hex"), [...token].reverse().join(""), token.slice(0, 16), token.slice(-16)];
  const holdsToken = (text: string) => forms.some((f) => text.includes(f));

  for (const where of ["browser", "store app"] as const) {
    // What the browser would write to disk.
    const disk = new Map<string, string>();
    const storage = browserStorage("lp.", { getItem: (k) => disk.get(k) ?? null, setItem: (k, v) => void disk.set(k, v), removeItem: (k) => void disk.delete(k) });
    // The phone's Keychain or Keystore (the store app only).
    const keychain = new Map<string, string>();
    const secrets: SecretStore | undefined = where === "browser" ? undefined : { get: async (k) => keychain.get(k) ?? null, set: async (k, v) => void keychain.set(k, v), remove: async (k) => void keychain.delete(k) };

    const store = createStore(storage, secrets);
    await store.ready();
    const client = new QueryClient();
    restoreCache(client, storage, store.get().token);
    const stop = saveCache(client, storage, () => store.get().token, 5);

    // Signing in, then every screen that is saved, with the keys the hooks give them (src/hooks.tsx).
    store.set({ token, club: "three-wolves", homeClub: "three-wolves", needsDetails: true, lang: "vi", theme: "dark" });
    const who = ownerOf(store.get().token as string);
    assert.equal(holdsToken(who), false, "the fingerprint in the keys isn't the token");
    const saved: [unknown[], unknown][] = [
      [["session", who], { player: { id: 7, name: "An" } }],
      [["clubs", who], { clubs: [{ slug: "three-wolves" }] }],
      [["config", "three-wolves"], { club: { slug: "three-wolves" }, modules: ["arena"] }],
      [["me", "three-wolves", who], { calendar: [] }],
      [["arena", "three-wolves", who], { board: [] }],
      [["leaderboard", "three-wolves", who], { rows: [] }],
      [["player-stats", "three-wolves", who], { games: 3 }],
      [["vision", "three-wolves", who], { passes: 1 }],
    ];
    for (const [key, data] of saved) client.setQueryData(key, data);
    client.setQueryData(["messages", "three-wolves", who], { inbox: [] });
    // A change made without a connection, and one the club refused.
    enqueue(storage, { club: "three-wolves", date: "2026-12-01", absent: true }, 1);
    enqueue(storage, { club: "three-wolves", date: "2026-12-08", absent: true }, 2);
    await flushQueue(storage, async (q) => (q.date === "2026-12-01" ? { refused: "too_late" } : "later"));
    await wait(30);
    stop();

    const cache = disk.get("lp.cache") ?? "";
    for (const [key] of saved) assert.ok(cache.includes(`"${String(key[0])}"`), `${where}: ${String(key[0])} is saved`);
    assert.equal(holdsToken(cache), false, `${where}: lp.cache holds no token`);
    assert.ok(disk.has("lp.queue") && disk.has("lp.dropped"));

    // Everything on disk. The token is in one place only: lp.token in a browser, the Keychain or Keystore in the store app.
    const holders = [...disk].filter(([k, v]) => holdsToken(k) || holdsToken(v)).map(([k]) => k);
    assert.deepEqual(holders, where === "browser" ? ["lp.token"] : [], `${where}: where the token is kept`);
    assert.equal(where === "browser" ? disk.get("lp.token") : keychain.get("token"), token);

    // The next start: the screens come back for the same person, from a cache that still has no token.
    const next = new QueryClient();
    assert.equal(restoreCache(next, storage, token), true);
    assert.deepEqual(next.getQueryData(["me", "three-wolves", who]), { calendar: [] });
    assert.equal(holdsToken(disk.get("lp.cache") ?? ""), false);

    // Signing out (src/main.tsx): the token and what was saved for that person are gone from the device.
    store.signOut();
    clearOffline(storage);
    await wait(10);
    assert.deepEqual([...disk].filter(([k, v]) => holdsToken(k) || holdsToken(v)), []);
    assert.deepEqual([disk.has("lp.cache"), disk.has("lp.queue"), disk.has("lp.dropped"), keychain.size], [false, false, false, 0]);
  }
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

test("a club's saved settings show at once but are checked again on every start; other saved screens keep their freshness", async () => {
  const storage = memoryStorage();
  const a = new QueryClient();
  const stop = saveCache(a, storage, () => "token-a", 5);
  a.setQueryData(["config", "three-wolves"], { modules: ["arena"] });
  a.setQueryData(["me", "three-wolves", ownerOf("token-a")], { hello: 1 });
  await wait(20);
  stop();
  const b = new QueryClient();
  assert.equal(restoreCache(b, storage, "token-a"), true);
  assert.deepEqual(b.getQueryData(["config", "three-wolves"]), { modules: ["arena"] }, "shown from the saved copy");
  assert.equal(b.getQueryState(["config", "three-wolves"])?.isInvalidated, true, "and fetched again when a screen uses it");
  assert.equal(b.getQueryState(["me", "three-wolves", ownerOf("token-a")])?.isInvalidated, false);
});
