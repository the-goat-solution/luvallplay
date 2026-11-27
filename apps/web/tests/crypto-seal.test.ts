// @luvallplay/crypto: the one envelope every sealed value uses (integration
// tokens, medical notes, push addresses, and the purposes still to come).
//
// The fixture holds text sealed by the code as it was BEFORE this package
// (lib/integrations/token-vault.ts and lib/push/seal.ts), with test-only
// keys: a row sealed then must still open now.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto, { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createSeal, parseKeks, sealedWith, SealError, type Binding } from "@luvallplay/crypto";

type Vectors = { keks: string; cases: { sealedBy: string; binding: (string | number)[]; plaintext: string; sealed: string }[] };
const vectors: Vectors = JSON.parse(readFileSync(new URL("./fixtures/crypto/v1-vectors.json", import.meta.url), "utf8"));

const K = randomBytes(32).toString("base64");
const key = () => randomBytes(32).toString("base64");
const sealFor = (list: string | undefined, purpose = "TEST_KEKS") => createSeal({ purpose, keks: () => parseKeks(list, purpose) });

const old = sealFor(vectors.keks);
const seal = sealFor(`k1:${K}`);

test("opens every v1 vector sealed by the old code", () => {
  assert.equal(vectors.cases.length, 6, "three plaintexts, each from the integrations vault and the push seal");
  assert.deepEqual([...new Set(vectors.cases.map((c) => c.sealedBy))].sort(), ["push/seal.ts", "token-vault.ts"]);
  assert.deepEqual([...new Set(vectors.cases.map((c) => sealedWith(c.sealed)))].sort(), ["k1", "k2"], "vectors from before and after a rotation");
  for (const c of vectors.cases) assert.equal(old.open(c.binding, c.sealed), c.plaintext, `${c.sealedBy}: ${c.plaintext.slice(0, 12)}`);
});

test("an old vector doesn't open under the other caller's binding", () => {
  const [vault, push] = [vectors.cases.find((c) => c.sealedBy === "token-vault.ts")!, vectors.cases.find((c) => c.sealedBy === "push/seal.ts")!];
  assert.throws(() => old.open(push.binding, vault.sealed), /can't be opened/);
  assert.throws(() => old.open(vault.binding, push.sealed), /can't be opened/);
});

test("the wire format is v1.<kek-id>.<wrapped-key>.<data>: base64url, 12-byte IV, 16-byte tag", () => {
  const sealed = seal.seal([1, "x", "y"], "hello");
  const parts = sealed.split(".");
  assert.equal(parts.length, 4);
  assert.deepEqual(parts.slice(0, 2), ["v1", "k1"]);
  for (const p of parts.slice(2)) assert.match(p, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(parts[2], "base64url").length, 12 + 16 + 32, "the wrapped data key");
  assert.equal(Buffer.from(parts[3], "base64url").length, 12 + 16 + 5, "the data");
  assert.equal(seal.open([1, "x", "y"], sealed), "hello");
  assert.notEqual(seal.seal([1, "x", "y"], "hello"), sealed, "every sealing is different");
  assert.ok(!sealed.includes("hello") && !sealed.includes(Buffer.from("hello").toString("base64url")));
  assert.equal(seal.open([1, "x", "y"], seal.seal([1, "x", "y"], "")), "", "empty text seals and opens");
});

test("a different binding, a changed byte or an unknown key all fail with the same message", () => {
  const s = seal.seal([1, "x", "y"], "hello");
  const changed = s.slice(0, -2) + (s.endsWith("AA") ? "BB" : "AA");
  const parts = s.split(".");
  const changedKey = [parts[0], parts[1], `${parts[2].slice(0, -2)}${parts[2].endsWith("AA") ? "BB" : "AA"}`, parts[3]].join(".");
  const messages = new Set<string>();
  for (const bad of [
    () => seal.open([2, "x", "y"], s),
    () => seal.open([1, "z", "y"], s),
    () => seal.open([1, "x"], s),
    () => seal.open([1, "x", "y", "more"], s),
    () => seal.open(["1", "x", "y"], s), // the text "1" is not the number 1
    () => seal.open([1, "x", "y"], changed),
    () => seal.open([1, "x", "y"], changedKey),
    // The same key id with different key bytes.
    () => sealFor(`k1:${key()}`).open([1, "x", "y"], s),
  ]) {
    assert.throws(bad, (err: unknown) => {
      assert.ok(err instanceof SealError);
      assert.match(err.message, /can't be opened/);
      messages.add(err.message);
      return true;
    });
  }
  assert.equal(messages.size, 1, "one message for every cause");
  assert.throws(() => seal.open([1, "x", "y"], s.replace(".k1.", ".gone.")), /isn't available/);
  assert.throws(() => seal.open([1, "x", "y"], "not sealed"), /known format/);
  assert.throws(() => seal.open([1, "x", "y"], `${s}.extra`), /known format/);
  assert.throws(() => seal.open([1, "x", "y"], s.replace(/^v1\./, "v2.")), /known format/);
  assert.throws(() => seal.open([1, "x", "y"], `v1.k1.${parts[2]}.AAAA`), /too short/);
});

test("rotation: seals with the first key, opens with any listed", () => {
  const before = sealFor(`k1:${K}`);
  const sealedOld = before.seal(["push", 3, 7], "address");
  const after = sealFor(`k2:${key()},k1:${K}`);
  const sealedNew = after.seal(["push", 3, 7], "address");
  assert.deepEqual([sealedWith(sealedOld), sealedWith(sealedNew)], ["k1", "k2"]);
  assert.equal(after.open(["push", 3, 7], sealedOld), "address");
  assert.equal(after.open(["push", 3, 7], sealedNew), "address");
  assert.throws(() => before.open(["push", 3, 7], sealedNew), /isn't available/);
  assert.equal(sealedWith("not sealed"), null);
  assert.equal(sealedWith("v2.k1.a.b"), null);
  assert.equal(sealedWith("v1.k1.a.b.c"), null);
});

test("parseKeks trims spaces and ignores empty parts", () => {
  assert.deepEqual(parseKeks(` k1:${K} , `, "X").map((k) => k.id), ["k1"]);
  assert.deepEqual(parseKeks(`\n k2:${key()} ,, k1 : ${K} ,\n`, "X").map((k) => k.id), ["k2", "k1"]);
  // The messy list gives the same keys as the clean one.
  assert.deepEqual(parseKeks(`  k1:${K}\t,\n`, "X"), parseKeks(`k1:${K}`, "X"));
  assert.equal(parseKeks(`k1: ${K}`, "X")[0].key.toString("base64"), K);
  assert.deepEqual(parseKeks(undefined, "X"), []);
  assert.deepEqual(parseKeks("", "X"), []);
  assert.deepEqual(parseKeks(" , ,", "X"), []);
});

test("parseKeks throws on a short key, a bad id or a repeated id, naming the variable", () => {
  assert.throws(() => parseKeks("k1:short", "PUSH_KEKS"), /PUSH_KEKS.*32 bytes/);
  assert.throws(() => parseKeks("k1:short"), /INTEGRATIONS_KEKS.*32 bytes/); // today's message, unchanged
  assert.throws(() => parseKeks("k1:c2hvcnQ=", "CONTACT_KEKS"), /CONTACT_KEKS.*32 bytes/);
  assert.throws(() => parseKeks(`k1:${randomBytes(33).toString("base64")}`, "PUSH_KEKS"), /PUSH_KEKS.*32 bytes/);
  assert.throws(() => parseKeks(key(), "PUSH_KEKS"), /PUSH_KEKS.*needs an id/);
  assert.throws(() => parseKeks(`:${key()}`, "PUSH_KEKS"), /PUSH_KEKS.*needs an id/);
  assert.throws(() => parseKeks(`K1:${key()}`, "PUSH_KEKS"), /PUSH_KEKS.*needs an id/);
  assert.throws(() => parseKeks(`k_1:${key()}`, "PUSH_KEKS"), /PUSH_KEKS.*needs an id/);
  assert.throws(() => parseKeks(`${"k".repeat(33)}:${key()}`, "PUSH_KEKS"), /PUSH_KEKS.*needs an id/);
  assert.throws(() => parseKeks(`k1:${K},k1:${key()}`, "PUSH_KEKS"), /PUSH_KEKS.*twice/);
  assert.throws(() => parseKeks(`k1:${K}, k1:${K}`), /INTEGRATIONS_KEKS.*twice/);
  // A good key next to a bad one still throws: a bad key never silently becomes "no encryption".
  assert.throws(() => parseKeks(`k2:${key()},k1:short`, "PUSH_KEKS"), /32 bytes/);
  for (const bad of [() => parseKeks("k1:short", "PUSH_KEKS"), () => parseKeks(key(), "PUSH_KEKS")]) assert.throws(bad, SealError);
  // The message names the variable and the key id, never the key.
  assert.throws(() => parseKeks(`k1:${K.slice(0, 24)}`, "PUSH_KEKS"), (err: unknown) => err instanceof SealError && !err.message.includes(K.slice(0, 24)));
});

test("no key: available() is false and seal throws; nothing is ever returned unsealed", () => {
  for (const list of [undefined, "", " , "]) {
    const none = sealFor(list, "CONTACT_KEKS");
    assert.equal(none.available(), false);
    let out: string | undefined;
    assert.throws(() => { out = none.seal(["player.phone", 3], "+64211234567"); }, (err: unknown) => err instanceof SealError && /No encryption key is set \(CONTACT_KEKS\)/.test(err.message));
    assert.equal(out, undefined);
    // Something sealed while there was a key doesn't open without it either.
    assert.throws(() => none.open([1, "x", "y"], seal.seal([1, "x", "y"], "hello")), /isn't available/);
  }
  assert.equal(seal.available(), true);
  // A malformed list is not "no key": sealing throws the parse error, and available() is false.
  const broken = sealFor("k1:short", "PUSH_KEKS");
  assert.equal(broken.available(), false);
  assert.throws(() => broken.seal(["push", 3, 7], "address"), /PUSH_KEKS.*32 bytes/);
  assert.throws(() => broken.open(["push", 3, 7], "v1.k1.a.b"), /PUSH_KEKS.*32 bytes/);
});

test("an empty binding or a non-positive number is refused", () => {
  assert.throws(() => seal.seal([], "x"), SealError);
  assert.throws(() => seal.seal([0, "a"], "x"), SealError);
  const sealed = seal.seal([1, "a"], "x");
  for (const bad of [[], [0, "a"], [-1, "a"], [1.5, "a"], [Number.NaN, "a"], [Number.MAX_SAFE_INTEGER + 1, "a"], [1, ""], ["", 1]] as Binding[]) {
    assert.throws(() => seal.seal(bad, "x"), SealError, JSON.stringify(bad));
    assert.throws(() => seal.open(bad, sealed), SealError, JSON.stringify(bad));
  }
  // Anything that isn't a string or a number (a caller without types) is refused too.
  for (const bad of [[null], [undefined], [true], [{}], [[1]], [1n]] as unknown as Binding[]) assert.throws(() => seal.seal(bad, "x"), SealError);
  assert.throws(() => seal.seal(undefined as unknown as Binding, "x"), SealError);
});

test("parseKeks refuses key text that isn't clean base64 of 32 bytes: a list split by line breaks never drops keys", () => {
  const [a, b] = [key(), key()];
  // Line breaks instead of commas: base64 decoding used to stop at the first "=", so this read as [k1] alone.
  assert.throws(() => parseKeks(`k1:${a}\nk2:${b}`, "PUSH_KEKS"), /PUSH_KEKS.*32 bytes/);
  assert.throws(() => parseKeks(`k1:${a}\r\nk2:${b}\n`, "PUSH_KEKS"), /PUSH_KEKS.*32 bytes/);
  assert.throws(() => parseKeks(`k1:${a} k2:${b}`, "PUSH_KEKS"), /PUSH_KEKS.*32 bytes/);
  assert.throws(() => parseKeks(`k1:${a};k2:${b}`), /INTEGRATIONS_KEKS.*32 bytes/);
  // Anything after the key, or inside it, that isn't base64.
  assert.throws(() => parseKeks(`k1:${a}=`, "X"), /32 bytes/);
  assert.throws(() => parseKeks(`k1:${a}junk`, "X"), /32 bytes/);
  assert.throws(() => parseKeks(`k1:"${a}"`, "X"), /32 bytes/);
  assert.throws(() => parseKeks(`k1:${a.slice(0, 20)} ${a.slice(20)}`, "X"), /32 bytes/);
  assert.throws(() => parseKeks(`k1:${a.slice(0, 20)}!${a.slice(20)}`, "X"), /32 bytes/);
  assert.throws(() => parseKeks(`k1:${randomBytes(32).toString("hex")}`, "X"), /32 bytes/);
  for (const bad of [`k1:${a}\nk2:${b}`, `k1:${a.slice(0, 20)}!${a.slice(20)}`]) {
    assert.throws(() => parseKeks(bad, "X"), (err: unknown) => err instanceof SealError && err.code === "keys" && !err.message.includes(a.slice(0, 20)));
  }
  // Still read: with or without the padding, and base64url.
  const raw = randomBytes(32);
  for (const text of [raw.toString("base64"), raw.toString("base64").replace(/=$/, ""), raw.toString("base64url")]) {
    assert.deepEqual(parseKeks(`k1:${text}`, "X")[0].key, raw, text.length === 44 ? "padded" : "unpadded or base64url");
  }
});

test("text to seal that isn't text is refused, and the error never shows it", () => {
  for (const bad of [64211234567, null, undefined, { phone: "+64211234567" }, ["+64211234567"], Buffer.from("+64211234567")]) {
    let out: string | undefined;
    assert.throws(() => { out = seal.seal([1, "a"], bad as unknown as string); }, (err: unknown) => {
      assert.ok(err instanceof SealError, String(err));
      assert.ok(!/64211234567/.test(err.message) && !/64211234567/.test(String(err.stack)), "the value is not in the error");
      return true;
    });
    assert.equal(out, undefined);
  }
});

test("the data key is zeroed whether opening works or not", () => {
  const sealed = seal.seal([1, "x", "y"], "hello");
  // Watch every chunk the decipher hands back: the first of each opening is the unwrapped data key.
  const chunks: Buffer[] = [];
  const real = crypto.createDecipheriv;
  (crypto as { createDecipheriv: unknown }).createDecipheriv = (...args: Parameters<typeof real>) => {
    const decipher = real(...args);
    const update = decipher.update.bind(decipher) as (data: Buffer) => Buffer;
    (decipher as { update: unknown }).update = (data: Buffer) => {
      const out = update(data);
      chunks.push(out);
      return out;
    };
    return decipher;
  };
  syncBuiltinESMExports();
  try {
    assert.equal(seal.open([1, "x", "y"], sealed), "hello");
    // A wrong binding: the key is unwrapped (GCM hands back the bytes before it checks them), then refused.
    assert.throws(() => seal.open([2, "x", "y"], sealed), /can't be opened/);
    // The right binding for the key, changed data: the key is used, then the data is refused.
    assert.throws(() => seal.open([1, "x", "y"], `${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`), /can't be opened/);
  } finally {
    (crypto as { createDecipheriv: unknown }).createDecipheriv = real;
    syncBuiltinESMExports();
  }
  assert.deepEqual(chunks.map((c) => c.length), [32, 5, 32, 32, 5], "key and data; key refused; key, then data refused");
  for (const c of chunks) assert.ok(c.every((b) => b === 0), `a ${c.length}-byte chunk was left in memory`);
});

test("sealedWith answers null for anything that isn't sealed text", () => {
  for (const bad of [null, undefined, 7, {}, ["v1", "k1", "a", "b"]]) assert.equal(sealedWith(bad as unknown as string), null);
  assert.equal(sealedWith(""), null);
});
