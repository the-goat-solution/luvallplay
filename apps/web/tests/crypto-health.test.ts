// The start-up check on the encryption keys (lib/crypto-health.ts), and the
// rows it gives the System check.
//
// What must hold (encryption plan, Review Focus 5): a production deploy with
// a malformed key list, a key reused across purposes, or PII_READS=sealed
// without its keys fails loudly at start. A purpose with no key is NOT a
// reason to stop (today's production has some unset): it shows red on the
// System check instead. Nothing here ever says a key.
//
// Throwaway keys, made here. No database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PURPOSES } from "../lib/crypto-purposes.ts";
import { rateLimitStore, rateLimitStoreSetting } from "../lib/security.ts";
import { assertCryptoReady, cryptoCheckRows, cryptoStatus, CryptoNotReadyError, guardProductionKeys, KEY_LISTS } from "../lib/crypto-health.ts";
import { register } from "../instrumentation.ts";

type Env = Record<string, string | undefined>;

/** The six lists of the plan's Global Constraints. */
const LISTS = ["INTEGRATIONS_KEKS", "PUSH_KEKS", "JUNIORS_KEKS", "CONTACT_KEKS", "CONTACT_INDEX_KEYS", "MODERATION_KEKS"];

const bytes: Record<string, Buffer> = {};
/** A fresh key's base64 text; its bytes are kept to prove no message holds them. */
const key = () => {
  const b = randomBytes(32);
  const text = b.toString("base64");
  bytes[text] = b;
  return text;
};
/** Every list set, each with its own keys. */
const full = (): Env => ({
  INTEGRATIONS_KEKS: `n1:${key()}`,
  PUSH_KEKS: `p2:${key()},p1:${key()}`,
  JUNIORS_KEKS: `j1:${key()}`,
  CONTACT_KEKS: `c1:${key()}`,
  CONTACT_INDEX_KEYS: `i1:${key()}`,
  MODERATION_KEKS: `m1:${key()}`,
});

/** Nothing of any key made here, in any form it could be printed in: base64, base64url, hex, or a digest of it. */
function holdsNoKey(text: string, env: Env, opts: { paths?: boolean } = {}) {
  for (const b of Object.values(bytes)) {
    const forms = [b.toString("base64"), b.toString("base64url"), b.toString("hex"), createHash("sha256").update(b).digest("hex"), createHash("sha256").update(b).digest("base64")];
    for (const form of forms) assert.ok(!text.includes(form) && !text.includes(form.slice(0, 16)), "no key material, and no digest of it");
  }
  // Nor the raw value of a list, even a malformed one (it may be a real key pasted badly).
  for (const name of LISTS) {
    for (const part of (env[name] ?? "").split(/[,:\s]+/).filter((p) => p.length >= 12)) assert.ok(!text.includes(part), `nothing of ${name}'s value`);
  }
  // (A stack trace has file paths, which look like that too.)
  if (!opts.paths) assert.ok(!/[A-Za-z0-9+/_-]{32,}/.test(text), "nothing that looks like a key or a digest");
}

/** The error assertCryptoReady throws for this environment (it must throw). */
function refusal(env: Env): CryptoNotReadyError {
  try {
    assertCryptoReady(env);
  } catch (err) {
    assert.ok(err instanceof CryptoNotReadyError, `a CryptoNotReadyError, not ${String(err)}`);
    holdsNoKey(`${err.message}\n${err.problems.join("\n")}`, env);
    holdsNoKey(err.stack ?? "", env, { paths: true });
    return err;
  }
  assert.fail("assertCryptoReady did not throw");
}

describe("which lists are checked", () => {
  test("every key list of the plan, once each, and every sealed column's list (lib/crypto-purposes.ts)", () => {
    assert.deepEqual(KEY_LISTS.map((l) => l.env).sort(), [...LISTS].sort());
    for (const p of PURPOSES) assert.ok(KEY_LISTS.some((l) => l.env === p.env && l.seals.includes(`${p.table}.${p.column}`)), `${p.purpose} is covered`);
    assert.equal(new Set(KEY_LISTS.map((l) => l.purpose)).size, KEY_LISTS.length, "one name per list");
  });

  test("cryptoStatus: one row per list, with its state and key ids (newest first)", () => {
    const env = full();
    const status = cryptoStatus(env);
    assert.deepEqual(status.map((s) => s.env).sort(), [...LISTS].sort());
    assert.ok(status.every((s) => s.state === "ok"));
    const of = (name: string) => status.find((s) => s.env === name)!;
    assert.deepEqual(of("PUSH_KEKS").keyIds, ["p2", "p1"]);
    assert.equal(of("PUSH_KEKS").purpose, "push");
    assert.equal(of("CONTACT_INDEX_KEYS").purpose, "contact-index");
    assert.deepEqual(of("JUNIORS_KEKS").seals, ["junior_medical_notes.sealed"]);
    holdsNoKey(JSON.stringify(status), env);
  });

  test("a list pasted with spaces and a trailing comma reads the same as the clean one", () => {
    const env = full();
    const messy = { ...env, PUSH_KEKS: ` ${env.PUSH_KEKS!.replace(",", " ,\n ")} , ` };
    assert.deepEqual(cryptoStatus(messy), cryptoStatus(env));
    assert.doesNotThrow(() => assertCryptoReady(messy));
  });
});

describe("assertCryptoReady lets these start", () => {
  test("every list set, each with its own keys", () => {
    assert.doesNotThrow(() => assertCryptoReady(full()));
    assert.doesNotThrow(() => assertCryptoReady({ ...full(), PII_READS: "sealed", VERCEL_ENV: "production" }));
  });

  test("today's production settings: INTEGRATIONS_KEKS, PUSH_KEKS and JUNIORS_KEKS set or not, PII_READS unset, no shared rate-limit store", () => {
    const all = full();
    const trio = ["INTEGRATIONS_KEKS", "PUSH_KEKS", "JUNIORS_KEKS"];
    // Every combination of the three being set.
    for (let mask = 0; mask < 8; mask++) {
      const env: Env = { VERCEL_ENV: "production" };
      trio.forEach((name, i) => {
        if (mask & (1 << i)) env[name] = all[name];
      });
      assert.doesNotThrow(() => assertCryptoReady(env), `set: ${trio.filter((_, i) => mask & (1 << i)).join(", ") || "none"}`);
      // The same with the variables present but empty (how a cleared setting can arrive).
      assert.doesNotThrow(() => assertCryptoReady({ ...env, MODERATION_KEKS: "", CONTACT_KEKS: " ", PII_READS: "", RATE_LIMIT_STORE: "" }));
    }
  });

  test("a missing list is not a reason to stop: it is 'missing' in the status", () => {
    for (const name of LISTS) {
      const env = { ...full(), [name]: undefined, VERCEL_ENV: "production" };
      assert.doesNotThrow(() => assertCryptoReady(env), name);
      const row = cryptoStatus(env).find((s) => s.env === name)!;
      assert.deepEqual([row.state, row.keyIds], ["missing", []]);
    }
    assert.ok(cryptoStatus({}).every((s) => s.state === "missing"));
    assert.doesNotThrow(() => assertCryptoReady({}));
  });

  test("PII_READS plain, or sealed with both contact lists", () => {
    assert.doesNotThrow(() => assertCryptoReady({ PII_READS: "plain" }));
    assert.doesNotThrow(() => assertCryptoReady({ PII_READS: " sealed ", CONTACT_KEKS: `c1:${key()}`, CONTACT_INDEX_KEYS: `i1:${key()}` }));
  });

  test("only one of CONTACT_KEKS / CONTACT_INDEX_KEYS set (reads still plain): it starts, and the status says numbers aren't being sealed", () => {
    for (const [set, unset] of [["CONTACT_KEKS", "CONTACT_INDEX_KEYS"], ["CONTACT_INDEX_KEYS", "CONTACT_KEKS"]]) {
      const env: Env = { VERCEL_ENV: "production", [set]: `k1:${key()}` };
      assert.doesNotThrow(() => assertCryptoReady(env));
      const status = cryptoStatus(env);
      const [has, lacks] = [status.find((s) => s.env === set)!, status.find((s) => s.env === unset)!];
      assert.equal(has.state, "ok");
      assert.equal(lacks.state, "missing");
      assert.match(has.note ?? "", new RegExp(unset), "the one that is set says what it is waiting for");
      assert.match(has.note ?? "", /not sealed/);
      // And the System check shows it: the set one as a warning, the unset one red.
      const rows = cryptoCheckRows(env);
      assert.equal(rows.find((r) => r.name === set)!.status, "warn");
      assert.equal(rows.find((r) => r.name === unset)!.status, "fail");
    }
    // With both set there is nothing to say.
    assert.ok(cryptoStatus(full()).every((s) => s.note === undefined));
  });
});

describe("assertCryptoReady refuses", () => {
  test("a malformed list, whichever it is, naming the variable and what is wrong", () => {
    const good = key();
    const malformed: [string, RegExp][] = [
      [`k1:${good.slice(0, 20)}`, /must be 32 bytes/],
      [`k1:"${good}"`, /must be 32 bytes/],
      [`${good}`, /needs an id/],
      [`K1:${good}`, /needs an id/],
      [`k1:${good},k1:${key()}`, /listed twice/],
      [`k1:${good}\nk2:${key()}`, /must be 32 bytes/],
    ];
    for (const name of LISTS) {
      for (const [value, what] of malformed) {
        const env = { ...full(), [name]: value };
        const err = refusal(env);
        assert.match(err.message, new RegExp(`${name}: `), `${name} is named`);
        assert.match(err.message, what);
        assert.equal(err.problems.length, 1, "the other lists are fine");
        const row = cryptoStatus(env).find((s) => s.env === name)!;
        assert.deepEqual([row.state, row.keyIds], ["malformed", []]);
        assert.match(row.problem ?? "", what);
      }
    }
    // Alone too (today's production, plus one bad paste).
    assert.match(refusal({ VERCEL_ENV: "production", PUSH_KEKS: "not-a-key-list" }).message, /PUSH_KEKS: /);
  });

  test("two purposes holding the same key bytes, naming both variables and key ids and nothing else", () => {
    for (let a = 0; a < LISTS.length; a++) {
      for (let b = a + 1; b < LISTS.length; b++) {
        const shared = key();
        const env = { ...full(), [LISTS[a]]: `one:${shared}`, [LISTS[b]]: `two:${shared}` };
        const err = refusal(env);
        assert.equal(err.problems.length, 1);
        const said = err.problems[0];
        assert.ok(said.includes(LISTS[a]) && said.includes(LISTS[b]), `${LISTS[a]} and ${LISTS[b]} are named: ${said}`);
        assert.ok(said.includes('"one"') && said.includes('"two"'), "with their key ids");
        assert.match(said, /same key/);
      }
    }
  });

  test("…also when the shared key is an older one in a list, or written the other way (base64url, without the =)", () => {
    const b = randomBytes(32);
    // Bytes whose base64 and base64url differ, so the two texts are not equal.
    b[0] = 0xfb;
    b[1] = 0xff;
    const [std, url] = [b.toString("base64"), b.toString("base64url")];
    bytes[std] = b;
    assert.notEqual(std, url);
    const env: Env = { PUSH_KEKS: `p2:${key()},p1:${std}`, CONTACT_INDEX_KEYS: `i3:${key()},i2:${key()},i1:${url}` };
    const said = refusal(env).message;
    assert.ok(said.includes("PUSH_KEKS") && said.includes('"p1"') && said.includes("CONTACT_INDEX_KEYS") && said.includes('"i1"'), said);
    assert.ok(!said.includes('"p2"') && !said.includes('"i3"'), "only the two keys that are the same");
  });

  test("PII_READS=sealed without CONTACT_KEKS, without CONTACT_INDEX_KEYS, or without both", () => {
    const [keks, index] = [`c1:${key()}`, `i1:${key()}`];
    const a = refusal({ PII_READS: "sealed", CONTACT_INDEX_KEYS: index });
    assert.match(a.message, /PII_READS/);
    assert.match(a.message, /CONTACT_KEKS/);
    assert.ok(!/CONTACT_INDEX_KEYS is not set/.test(a.message));
    const b = refusal({ PII_READS: "sealed", CONTACT_KEKS: keks });
    assert.match(b.message, /CONTACT_INDEX_KEYS/);
    const c = refusal({ PII_READS: "sealed" });
    assert.ok(c.message.includes("CONTACT_KEKS") && c.message.includes("CONTACT_INDEX_KEYS"));
    // A malformed one is said once, as malformed (not also as "not set").
    const d = refusal({ PII_READS: "sealed", CONTACT_KEKS: "nonsense", CONTACT_INDEX_KEYS: index });
    assert.equal(d.problems.length, 1);
    assert.match(d.problems[0], /CONTACT_KEKS: /);
  });

  test("a PII_READS that is neither plain nor sealed", () => {
    for (const value of ["Sealed", "true", "1", "seal", "plain,sealed"]) {
      const err = refusal({ ...full(), PII_READS: value });
      assert.match(err.message, /PII_READS must be "plain" or "sealed"/);
      assert.ok(!err.message.includes(`"${value}"`) || value === "sealed", "the value itself isn't repeated");
    }
  });

  test("production without the shared rate-limit store, but only once CRYPTO_CHECK_RATE_LIMIT=1 says to check it", () => {
    const prod = { ...full(), VERCEL_ENV: "production" };
    for (const store of [undefined, "", " ", "memory", " Memory", "database", "Database "]) {
      const env = { ...prod, RATE_LIMIT_STORE: store };
      assert.notEqual(rateLimitStoreSetting(env), "unknown");
      // What the check reads is what the limiter reads.
      const shared = rateLimitStore(env) === "database";
      // Without the switch: never checked (so this change can't stop production on its own).
      assert.doesNotThrow(() => assertCryptoReady(env));
      assert.doesNotThrow(() => assertCryptoReady({ ...env, CRYPTO_CHECK_RATE_LIMIT: "0" }));
      assert.doesNotThrow(() => assertCryptoReady({ ...env, CRYPTO_CHECK_RATE_LIMIT: "true" }));
      const checked = { ...env, CRYPTO_CHECK_RATE_LIMIT: "1" };
      if (shared) assert.doesNotThrow(() => assertCryptoReady(checked));
      else assert.match(refusal(checked).message, /RATE_LIMIT_STORE must be "database"/);
      // Production only.
      for (const where of [undefined, "preview", "development"]) assert.doesNotThrow(() => assertCryptoReady({ ...checked, VERCEL_ENV: where }));
    }
    assert.doesNotThrow(() => assertCryptoReady({ ...prod, CRYPTO_CHECK_RATE_LIMIT: "1", RATE_LIMIT_STORE: "database" }));
  });

  test("a RATE_LIMIT_STORE that names no store (a typo) is refused wherever it is, with or without the switch: it would quietly count per instance", () => {
    for (const store of ["db", "postgres", "redis", "databse", "database,memory", "true", "1"]) {
      for (const where of [undefined, "preview", "production"]) {
        for (const check of [undefined, "1"]) {
          const env = { ...full(), VERCEL_ENV: where, CRYPTO_CHECK_RATE_LIMIT: check, RATE_LIMIT_STORE: store };
          // What the check reads is what the limiter reads: it would have counted in memory.
          assert.equal(rateLimitStoreSetting(env), "unknown", store);
          assert.equal(rateLimitStore(env), "memory", store);
          const err = refusal(env);
          assert.match(err.message, /RATE_LIMIT_STORE must be "database" or "memory" \(or not set, which is "memory"\)/, store);
          assert.equal(err.problems.filter((p) => /RATE_LIMIT_STORE/.test(p)).length, 1, "said once, not twice");
        }
      }
    }
    // The values the limiter knows are not refused (the production switch aside), and both read them alike.
    for (const store of [undefined, "", " ", "memory", "MEMORY ", "database", " Database "]) {
      const env = { ...full(), RATE_LIMIT_STORE: store };
      assert.doesNotThrow(() => assertCryptoReady(env), String(store));
      assert.equal(rateLimitStoreSetting(env), rateLimitStore(env));
    }
    // The System check shows it too, on any deployment.
    const row = cryptoCheckRows({ ...full(), RATE_LIMIT_STORE: "db" }).find((r) => r.name === "Start-up check")!;
    assert.equal(row.status, "fail");
    assert.match(row.detail, /RATE_LIMIT_STORE/);
  });

  test("everything wrong is said at once, one line each", () => {
    const shared = key();
    const env: Env = { VERCEL_ENV: "production", CRYPTO_CHECK_RATE_LIMIT: "1", PII_READS: "sealed", PUSH_KEKS: "bad", JUNIORS_KEKS: `j1:${shared}`, MODERATION_KEKS: `m1:${shared}` };
    const err = refusal(env);
    assert.equal(err.problems.length, 5, err.problems.join(" | "));
    for (const p of err.problems) assert.ok(err.message.includes(p) && !p.includes("\n"));
    assert.match(err.message, /must not start/);
  });
});

describe("the System check rows", () => {
  test("one row per list, with its state and key ids, never key material", () => {
    const env = { ...full(), MODERATION_KEKS: undefined, JUNIORS_KEKS: "j1:too-short" };
    const rows = cryptoCheckRows(env);
    assert.deepEqual(rows.filter((r) => LISTS.includes(r.name)).map((r) => r.name).sort(), [...LISTS].sort());
    assert.ok(rows.every((r) => r.area === "Encryption keys"));
    const of = (name: string) => rows.find((r) => r.name === name)!;

    assert.equal(of("PUSH_KEKS").status, "ok");
    assert.match(of("PUSH_KEKS").detail, /p2, p1/, "the key ids, newest first");
    assert.match(of("PUSH_KEKS").detail, /push_devices\.sealed/);
    assert.equal(of("PUSH_KEKS").fix, undefined);

    assert.equal(of("MODERATION_KEKS").status, "fail", "a missing purpose shows red");
    assert.match(of("MODERATION_KEKS").detail, /Not set/);
    assert.match(of("MODERATION_KEKS").fix ?? "", /MODERATION_KEKS/);

    assert.equal(of("JUNIORS_KEKS").status, "fail");
    assert.match(of("JUNIORS_KEKS").detail, /Malformed/);
    assert.match(of("JUNIORS_KEKS").detail, /must be 32 bytes/);

    holdsNoKey(JSON.stringify(rows), env);
  });

  test("what would stop production starting is a row too (a preview isn't stopped, so this is where it is seen first)", () => {
    const shared = key();
    const env = { ...full(), PUSH_KEKS: `p1:${shared}`, CONTACT_KEKS: `c1:${shared}` };
    const row = cryptoCheckRows(env).find((r) => r.name === "Start-up check")!;
    assert.equal(row.status, "fail");
    assert.ok(row.detail.includes("PUSH_KEKS") && row.detail.includes("CONTACT_KEKS") && row.detail.includes('"p1"') && row.detail.includes('"c1"'));
    holdsNoKey(JSON.stringify(cryptoCheckRows(env)), env);
    const fine = cryptoCheckRows(full()).find((r) => r.name === "Start-up check")!;
    assert.equal(fine.status, "ok");
  });

  test("with nothing set: six red rows and no throw", () => {
    const rows = cryptoCheckRows({});
    assert.equal(rows.filter((r) => r.status === "fail").length, 6);
    assert.equal(rows.find((r) => r.name === "Start-up check")!.status, "ok");
  });
});

/** The connection variables the preview guard may remove (lib/db-switch.ts): set aside too, so loading the config as a preview can't touch this process's. */
const CONNECTION = ["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL_NO_SSL", "POSTGRES_PRISMA_URL", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "APP_DATABASE_URL", "PREVIEW_DATABASE_BLOCKED"];

/** Runs `run` with only these variables set (of the ones the check reads), then puts the environment back. What it threw, or null. */
async function withEnv(vars: Env, run: () => unknown): Promise<unknown> {
  const names = ["NEXT_RUNTIME", "VERCEL_ENV", "TENANT_SLUG", "TENANT_SCOPE", "CLUB_SETTINGS_SOURCE", "PII_READS", "RATE_LIMIT_STORE", "CRYPTO_CHECK_RATE_LIMIT", "DATABASE_URL_VAR", "NEON_LOCAL_WS_PROXY", ...CONNECTION, ...LISTS];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  for (const [n, v] of Object.entries(vars)) if (v !== undefined) process.env[n] = v;
  try {
    await run();
    return null;
  } catch (err) {
    return err;
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
}
const bad = { PUSH_KEKS: "not-a-key-list" };

// Next does not run register() during `next build`, so a start-up check alone
// lets a bad key through the build: the deployment is promoted and then every
// request answers 500. The same check therefore runs as the build's
// configuration loads (next.config.ts): the build fails, nothing is promoted,
// and the previous deployment keeps serving.
describe("next.config.ts: the production build", () => {
  // Next compiles the config as CommonJS, where __dirname exists; under this
  // test's ES module loader it doesn't, so it is given here (the app folder).
  (globalThis as { __dirname?: string }).__dirname ??= fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  let n = 0;
  /** Loads next.config.ts afresh (as `next build` does, once) with these variables set. */
  const build = (vars: Env) => withEnv(vars, () => import(`../next.config.ts?build=${++n}`));

  test("a malformed list fails the production build, naming the variable and no key", async () => {
    const env = { VERCEL_ENV: "production", ...bad };
    const err = await build(env);
    assert.ok(err instanceof CryptoNotReadyError, `a CryptoNotReadyError, not ${String(err)}`);
    assert.match(err.message, /PUSH_KEKS: /);
    holdsNoKey(err.message, env);
  });

  test("so does a key used for two purposes", async () => {
    const shared = key();
    const env = { VERCEL_ENV: "production", PUSH_KEKS: `p1:${shared}`, JUNIORS_KEKS: `j1:${shared}` };
    const err = await build(env);
    assert.ok(err instanceof CryptoNotReadyError);
    assert.ok(err.message.includes("PUSH_KEKS") && err.message.includes("JUNIORS_KEKS"));
    holdsNoKey(err.message, env);
  });

  test("a production build with today's settings, or with every list set, goes through", async () => {
    assert.equal(await build({ VERCEL_ENV: "production" }), null);
    assert.equal(await build({ VERCEL_ENV: "production", ...full() }), null);
  });

  test("a build anywhere else isn't stopped (local, CI, a preview: the System check shows it instead)", async () => {
    for (const where of [undefined, "preview", "development"]) assert.equal(await build({ VERCEL_ENV: where, ...bad }), null, String(where));
  });

  test("guardProductionKeys: production only, and it reads the environment it is given", () => {
    assert.throws(() => guardProductionKeys({ VERCEL_ENV: "production", ...bad }), CryptoNotReadyError);
    assert.doesNotThrow(() => guardProductionKeys({ VERCEL_ENV: "production" }));
    assert.doesNotThrow(() => guardProductionKeys({ VERCEL_ENV: "preview", ...bad }));
    assert.doesNotThrow(() => guardProductionKeys({ ...bad }));
  });
});

describe("instrumentation.ts: register()", () => {
  // main's start-up check of the deployment settings (lib/tenant-settings.ts)
  // runs first: give it a valid production deployment so only the key check
  // decides these tests.
  const DEPLOYMENT: Env = { TENANT_SLUG: "three-wolves", TENANT_SCOPE: "enforce", CLUB_SETTINGS_SOURCE: "constants" };
  const start = (vars: Env) => withEnv({ ...DEPLOYMENT, ...vars }, () => register());

  test("production on the Node runtime: a malformed list stops the server starting", async () => {
    const err = await start({ NEXT_RUNTIME: "nodejs", VERCEL_ENV: "production", ...bad });
    assert.ok(err instanceof CryptoNotReadyError);
    assert.match(err.message, /PUSH_KEKS: /);
  });

  test("production with today's settings starts", async () => {
    assert.equal(await start({ NEXT_RUNTIME: "nodejs", VERCEL_ENV: "production" }), null);
    assert.equal(await start({ NEXT_RUNTIME: "nodejs", VERCEL_ENV: "production", ...full() }), null);
  });

  test("anywhere but production it isn't checked at start (the System check shows it instead); nor on the edge runtime, which has no node:crypto", async () => {
    for (const where of [undefined, "preview", "development"]) assert.equal(await start({ NEXT_RUNTIME: "nodejs", VERCEL_ENV: where, ...bad }), null);
    assert.equal(await start({ NEXT_RUNTIME: "edge", VERCEL_ENV: "production", ...bad }), null);
  });
});
