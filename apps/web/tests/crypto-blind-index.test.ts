// @luvallplay/crypto's blind index: a keyed fingerprint (HMAC-SHA256) of a
// value, stored beside the sealed value so the row can still be found by it.
// The same value under the same key and purpose always gives the same index;
// without the key the index says nothing about the value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { blindIndex, parseKeks, SealError } from "@luvallplay/crypto";
import { toE164 } from "@luvallplay/core/phone";

const key = () => randomBytes(32).toString("base64");
const K1 = key();
const K2 = key();
const indexFor = (list: string | undefined, purpose = "player.phone") =>
  blindIndex({ purpose, keys: () => parseKeks(list, "CONTACT_INDEX_KEYS") });

const PHONE = "+64211234567";
const index = indexFor(`k1:${K1}`);

test("the same value and key give the same index", () => {
  const a = index.current(PHONE);
  assert.deepEqual(index.current(PHONE), a);
  assert.deepEqual(indexFor(`k1:${K1}`).current(PHONE), a, "a second index made from the same key agrees");
  assert.notEqual(index.current("+64211234568").mac, a.mac, "a different value gives a different index");
  assert.notEqual(indexFor(`k1:${key()}`).current(PHONE).mac, a.mac, "a different key gives a different index");
});

test("a different purpose gives a different index", () => {
  assert.notEqual(indexFor(`k1:${K1}`, "player.email").current(PHONE).mac, index.current(PHONE).mac);
  // The purpose and the value are kept apart: moving text between them changes the index.
  assert.notEqual(indexFor(`k1:${K1}`, "ab").current("c").mac, indexFor(`k1:${K1}`, "a").current("bc").mac);
});

test("known answer: mac is base64url(HMAC-SHA256(key, purpose + NUL + value))", () => {
  const expected = createHmac("sha256", Buffer.from(K1, "base64")).update("player.phone\0+64211234567", "utf8").digest("base64url");
  const { mac } = index.current(PHONE);
  assert.equal(mac, expected);
  assert.match(mac, /^[A-Za-z0-9_-]{43}$/, "32 bytes, base64url, no padding");
  // Text outside ASCII is hashed as UTF-8.
  const word = "Zoë 北";
  assert.equal(
    indexFor(`k1:${K1}`, "name").current(word).mac,
    createHmac("sha256", Buffer.from(K1, "base64")).update(Buffer.from(`name\0${word}`, "utf8")).digest("base64url"),
  );
});

test("the key id is returned separately from the mac", () => {
  const got = index.current(PHONE);
  assert.deepEqual(Object.keys(got).sort(), ["kid", "mac"]);
  assert.equal(got.kid, "k1");
  assert.ok(!got.mac.includes("."), "the mac carries no key id, so a unique index on it works");
  assert.equal(Buffer.from(got.mac, "base64url").length, 32);
});

test("rotation: current uses the first key, all() gives one per listed key, the old key's included", () => {
  const before = indexFor(`k1:${K1}`).current(PHONE);
  const rotating = indexFor(`k2:${K2},k1:${K1}`);
  const now = rotating.current(PHONE);
  assert.equal(now.kid, "k2");
  assert.notEqual(now.mac, before.mac);
  const all = rotating.all(PHONE);
  assert.deepEqual(all.map((i) => i.kid), ["k2", "k1"], "newest first, as listed");
  assert.deepEqual(all[0], now);
  assert.deepEqual(all[1], before, "a row indexed before the rotation is still found");
  assert.deepEqual(indexFor(`k1:${K1}`).all(PHONE), [before], "one key: all() is just current()");
});

test("no keys: current throws SealError, all() is empty (a lookup that matches nothing)", () => {
  for (const none of [indexFor(undefined), indexFor(""), indexFor(" , ")]) {
    assert.throws(() => none.current(PHONE), (err: unknown) => {
      assert.ok(err instanceof SealError);
      assert.equal(err.code, "unavailable");
      assert.match(err.message, /player\.phone/, "names the purpose");
      assert.ok(!err.message.includes(PHONE));
      return true;
    });
    assert.deepEqual(none.all(PHONE), []);
  }
});

test("a malformed key list throws from current and from all, never an unkeyed index", () => {
  for (const list of ["k1:short", `K1:${K1}`, `k1:${K1},k1:${K2}`, K1]) {
    const bad = indexFor(list);
    for (const call of [() => bad.current(PHONE), () => bad.all(PHONE)]) {
      assert.throws(call, (err: unknown) => {
        assert.ok(err instanceof SealError);
        assert.equal(err.code, "keys");
        assert.match(err.message, /CONTACT_INDEX_KEYS/);
        return true;
      });
    }
  }
});

test("the output contains no part of the input", () => {
  const value = "+64211234567";
  const out = JSON.stringify(indexFor(`k2:${K2},k1:${K1}`).all(value));
  const encodings = (s: string) => [s, Buffer.from(s).toString("base64"), Buffer.from(s).toString("base64url"), Buffer.from(s).toString("hex")];
  for (const piece of [value, value.slice(1), "6421", "1234567", "player.phone"]) {
    for (const e of encodings(piece)) assert.ok(!out.includes(e), "nothing of the value or the purpose is in the index");
  }
  for (const k of [K1, K2]) assert.ok(!out.includes(k) && !out.includes(Buffer.from(k, "base64").toString("base64url")), "nor the key");
});

test("an empty purpose or one holding NUL is refused", () => {
  for (const purpose of ["", "player\0phone", "\0"]) {
    assert.throws(() => blindIndex({ purpose, keys: () => parseKeks(`k1:${K1}`) }), (err: unknown) => err instanceof SealError && err.code === "binding");
  }
  assert.throws(() => blindIndex({ purpose: 7 as unknown as string, keys: () => parseKeks(`k1:${K1}`) }), SealError);
});

test("a value that isn't text, or is empty, is refused without echoing it", () => {
  const secret = 64211234567;
  for (const value of ["", secret, null, undefined, { phone: PHONE }, [PHONE]]) {
    for (const call of [() => index.current(value as unknown as string), () => index.all(value as unknown as string)]) {
      assert.throws(call, (err: unknown) => {
        assert.ok(err instanceof SealError);
        assert.equal(err.code, "plaintext");
        assert.ok(!err.message.includes(String(secret)) && !err.message.includes(PHONE), "the value isn't in the message");
        return true;
      });
    }
  }
  // Refused before the keys are looked at, so it's the same answer with no keys.
  assert.throws(() => indexFor(undefined).all(""), SealError);
});

test("the keys are asked on every call, so a changed list takes effect at once", () => {
  let list = `k1:${K1}`;
  const live = blindIndex({ purpose: "player.phone", keys: () => parseKeks(list) });
  assert.equal(live.current(PHONE).kid, "k1");
  list = `k2:${K2},k1:${K1}`;
  assert.equal(live.current(PHONE).kid, "k2");
  assert.equal(live.all(PHONE).length, 2);
});

test("the index doesn't normalise: callers do, and then one number written three ways gives one index", () => {
  const written = ["021 123 4567", "+64 21 123 4567", "+64211234567"];
  assert.equal(new Set(written.map((w) => index.current(w).mac)).size, 3, "as written, they are three different values");
  const normal = written.map((w) => toE164(w));
  assert.deepEqual(normal, [PHONE, PHONE, PHONE]);
  assert.equal(new Set(normal.map((n) => index.current(n!).mac)).size, 1);
});
