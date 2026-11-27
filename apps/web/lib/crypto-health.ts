// Are this deployment's encryption keys fit to start with?
//
// Every sealed value has a key list of its own, in an environment variable
// (packages/crypto/README.md, "Key lists"). Two things are done with them
// here, from the environment alone (no database, no module switches: at
// start-up those are scoped to one club by row-level security, so the answer
// would be wrong):
//
//   cryptoStatus()       each list's state (ok, missing, malformed) and its
//                        key ids. The System check shows one row per list.
//   assertCryptoReady()  throws when the keys must not be started with.
//   guardProductionKeys() calls it, in production only, in two places:
//                        as the build's configuration loads (next.config.ts),
//                        so a bad key FAILS THE BUILD and the previous
//                        deployment keeps serving; and as a server starts
//                        (instrumentation.ts), the backstop for a variable
//                        changed without a build. Next does not run the
//                        start-up hook during a build, so the start-up check
//                        alone would let the build through and then answer
//                        500 to every request.
//
// What stops a start, and what doesn't:
// - A MALFORMED list stops it. A bad paste must never quietly become "no
//   encryption", and everything that purpose seals would fail on first use.
// - The SAME KEY in two lists stops it (an operator pasting one key into two
//   variables): a leak of one purpose's key must open nothing else. Every key
//   of every list is compared, the older ones and the index keys too.
// - PII_READS=sealed without CONTACT_KEKS or CONTACT_INDEX_KEYS stops it:
//   nobody could be found by phone. So does a PII_READS that is neither
//   "plain" nor "sealed" (every phone lookup would throw).
// - A RATE_LIMIT_STORE that names no store stops it, always: anything but
//   "database", "memory" or nothing ("db", "postgres", a typo) would quietly
//   count per server instance while looking switched on.
// - In production, and only while CRYPTO_CHECK_RATE_LIMIT=1: RATE_LIMIT_STORE
//   not "database" stops it (limits must hold across server instances before
//   Social and Marketplace). The switch exists so this check can be deployed
//   before the owner has set RATE_LIMIT_STORE; it goes when both are in place.
// - A MISSING list does NOT stop it. The purpose is unavailable: its feature
//   refuses when used and the System check shows it red. Production has run
//   with some unset.
//
// Nothing here says a key, part of one, or a digest of one: variable names,
// key ids and counts only. Key ids are written into every sealed text and are
// not secret.
import { timingSafeEqual } from "node:crypto";
import { parseKeks, type Kek } from "@luvallplay/crypto";
import { PURPOSES } from "./crypto-purposes.ts";
import { piiReads } from "./pii/contact.ts";

type Env = Record<string, string | undefined>;

export type KeyList = {
  /** A short name: the variable without its ending, in lower case ("push", "contact-index"). */
  purpose: string;
  /** The environment variable that holds the list. */
  env: string;
  /** The sealed columns under it (table.column), from PURPOSES. Empty when it seals no column (yet). */
  seals: string[];
  /** What it is for, when it seals no column. */
  what?: string;
};

/**
 * Key lists that seal no column listed in PURPOSES: an index key, and the
 * purposes whose tables don't exist yet. When one of them gets its sealed
 * column, the column's entry goes in PURPOSES (lib/crypto-purposes.ts) and
 * the list is then found there as well; it is counted once.
 */
const OTHER_LISTS: readonly { env: string; what: string }[] = [
  { env: "INTEGRATIONS_KEKS", what: "a club's provider tokens (the integrations vault; nothing is stored with it yet)" },
  { env: "CONTACT_INDEX_KEYS", what: "the index that finds a sealed phone number (players.phone_index)" },
];

const nameOf = (env: string) => env.replace(/_(KEKS|KEYS)$/, "").toLowerCase().replaceAll("_", "-");

/**
 * Every key list of the deployment, once each: the list of each sealed column
 * in PURPOSES (so a new sealed column is checked from the change that adds
 * it), then the lists above.
 */
export const KEY_LISTS: readonly KeyList[] = (() => {
  const lists = new Map<string, KeyList>();
  const list = (env: string) => {
    if (!lists.has(env)) lists.set(env, { purpose: nameOf(env), env, seals: [] });
    return lists.get(env)!;
  };
  for (const p of PURPOSES) list(p.env).seals.push(`${p.table}.${p.column}`);
  for (const other of OTHER_LISTS) list(other.env).what = other.what;
  return [...lists.values()];
})();

export type KeyListStatus = {
  purpose: string;
  env: string;
  /** ok: at least one key. missing: not set or empty (the purpose is unavailable). malformed: the parser refuses it. */
  state: "ok" | "missing" | "malformed";
  /** The ids of its keys, newest first. Empty unless ok. */
  keyIds: string[];
  seals: string[];
  /** Malformed: what the parser said (the variable, and the key's id when it has one). Never a key. */
  problem?: string;
  /** Set, but of no use yet, and why. */
  note?: string;
};

/** The two lists a sealed phone number needs. With only one set, lib/pii/contact.ts seals nothing. */
const CONTACT_PAIR = ["CONTACT_KEKS", "CONTACT_INDEX_KEYS"] as const;

/** One list, read. `keys` is for comparing only, and is wiped by whoever asked. */
function read(list: KeyList, env: Env): { status: KeyListStatus; keys: Kek[] } {
  const base = { purpose: list.purpose, env: list.env, seals: [...list.seals] };
  try {
    const keys = parseKeks(env[list.env], list.env);
    return { status: { ...base, state: keys.length ? "ok" : "missing", keyIds: keys.map((k) => k.id) }, keys };
  } catch (err) {
    // The parser's message names the variable and, at most, a key's id.
    return { status: { ...base, state: "malformed", keyIds: [], problem: err instanceof Error ? err.message : `${list.env}: the list can't be read.` }, keys: [] };
  }
}

function inspect(env: Env): { statuses: KeyListStatus[]; reused: string[] } {
  const lists = KEY_LISTS.map((list) => read(list, env));
  try {
    // The same key bytes in two lists. Compared as bytes (the same key can be
    // written two ways in base64), in constant time, and never printed.
    const reused: string[] = [];
    for (let a = 0; a < lists.length; a++) {
      for (let b = a + 1; b < lists.length; b++) {
        for (const ka of lists[a].keys) {
          for (const kb of lists[b].keys) {
            if (!timingSafeEqual(ka.key, kb.key)) continue;
            reused.push(
              `${lists[a].status.env} (key "${ka.id}") and ${lists[b].status.env} (key "${kb.id}") hold the same key. Each purpose needs a key of its own: give one of them a new key (packages/crypto/README.md, "Rotating a key").`,
            );
          }
        }
      }
    }
    const statuses = lists.map((l) => l.status);
    const state = (name: string) => statuses.find((s) => s.env === name)?.state;
    for (const [mine, other] of [CONTACT_PAIR, [...CONTACT_PAIR].reverse()]) {
      const status = statuses.find((s) => s.env === mine);
      if (status?.state === "ok" && state(other) !== "ok") status.note = `${other} is ${state(other) === "malformed" ? "malformed" : "not set"}, so phone numbers are not sealed: both lists are needed.`;
    }
    return { statuses, reused };
  } finally {
    for (const l of lists) for (const k of l.keys) k.key.fill(0);
  }
}

/** Each key list's state and key ids. Never throws, and never holds a key. */
export function cryptoStatus(env: Env = process.env): KeyListStatus[] {
  return inspect(env).statuses;
}

/** The same reading as rateLimitStoreSetting() (lib/security.ts), which can't be loaded here: it brings the database with it. tests/crypto-health.test.ts holds the two together. */
function rateLimitSetting(env: Env): "database" | "memory" | "unknown" {
  const value = env.RATE_LIMIT_STORE?.trim().toLowerCase() ?? "";
  if (value === "database") return "database";
  return value === "" || value === "memory" ? "memory" : "unknown";
}

/**
 * Everything that must stop production starting, one line each, in words
 * that hold no key. Empty when it may start.
 */
export function cryptoProblems(env: Env = process.env): string[] {
  const { statuses, reused } = inspect(env);
  const problems = statuses.filter((s) => s.state === "malformed").map((s) => `${s.problem} Correct the list (the format is in packages/crypto/README.md, "Key lists").`);
  problems.push(...reused);

  let reads: "plain" | "sealed" | null = null;
  try {
    reads = piiReads(env);
  } catch {
    problems.push(`PII_READS must be "plain" or "sealed" (or not set, which is "plain").`);
  }
  if (reads === "sealed") {
    for (const name of CONTACT_PAIR) {
      // A malformed one is already said above.
      if (statuses.find((s) => s.env === name)?.state === "missing") problems.push(`PII_READS is "sealed" but ${name} is not set, so nobody could be found by their phone number. Set ${name}, or set PII_READS back to "plain".`);
    }
  }

  const store = rateLimitSetting(env);
  if (store === "unknown") {
    // The value isn't repeated: only what it may be.
    problems.push(`RATE_LIMIT_STORE must be "database" or "memory" (or not set, which is "memory"). What is set names no store, so limits would quietly count on each server by itself.`);
  } else if (env.VERCEL_ENV === "production" && env.CRYPTO_CHECK_RATE_LIMIT?.trim() === "1" && store !== "database") {
    problems.push(`RATE_LIMIT_STORE must be "database" in production, so limits hold on every server (checked because CRYPTO_CHECK_RATE_LIMIT is 1).`);
  }
  return problems;
}

/** Why the deployment must not start. `problems` has one line per thing to put right; none holds a key. */
export class CryptoNotReadyError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`This deployment must not start: ${problems.length === 1 ? "its encryption settings have a problem" : `its encryption settings have ${problems.length} problems`}.\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "CryptoNotReadyError";
    this.problems = problems;
  }
}

/**
 * Throws CryptoNotReadyError when the environment's keys must not be started
 * with (the rules are at the top of this file). A missing list is not one of
 * them. Reads the environment only.
 */
export function assertCryptoReady(env: Env = process.env): void {
  const problems = cryptoProblems(env);
  if (problems.length) throw new CryptoNotReadyError(problems);
}

/**
 * Production only: throws CryptoNotReadyError when the keys must not be
 * started with. Called as the build's configuration loads (next.config.ts)
 * and as a server starts (instrumentation.ts). Everywhere else it does
 * nothing: the System check shows the same problems there.
 */
export function guardProductionKeys(env: Env = process.env): void {
  if (env.VERCEL_ENV === "production") assertCryptoReady(env);
}

// ── The System check ────────────────────────────────────────────────────────

/** A row of Admin → System check (the shape of lib/setup-check.ts's Check). */
export type CryptoCheckRow = { area: string; name: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };

const AREA = "Encryption keys";

/**
 * The System check's rows: one per key list with its state and key ids (red
 * when missing or malformed), and one saying whether production would start.
 * Key ids only, never a key.
 */
export function cryptoCheckRows(env: Env = process.env): CryptoCheckRow[] {
  const whatOf = (s: KeyListStatus) => (s.seals.length ? s.seals.join(", ") : (KEY_LISTS.find((l) => l.env === s.env)?.what ?? "nothing yet"));
  const rows = cryptoStatus(env).map((s): CryptoCheckRow => {
    const fix = `Set ${s.env} in the hosting environment's settings (how to make and check a key: packages/crypto/README.md, "Key lists"), then redeploy.`;
    if (s.state === "malformed") {
      return { area: AREA, name: s.env, status: "fail", detail: `Malformed: ${s.problem} Production does not start with it.`, fix: `Correct ${s.env} (packages/crypto/README.md, "Key lists"), then redeploy.` };
    }
    if (s.state === "missing") {
      return { area: AREA, name: s.env, status: "fail", detail: `Not set. It is for ${whatOf(s)}: that is unavailable here (nothing is stored unsealed instead).`, fix };
    }
    const ids = `Key id${s.keyIds.length === 1 ? "" : "s"}, newest first: ${s.keyIds.join(", ")}. For ${whatOf(s)}.`;
    return s.note ? { area: AREA, name: s.env, status: "warn", detail: `${ids} ${s.note}`, fix: "Set the other list too, then redeploy." } : { area: AREA, name: s.env, status: "ok", detail: ids };
  });
  const problems = cryptoProblems(env);
  rows.push(
    problems.length
      ? { area: AREA, name: "Start-up check", status: "fail", detail: `Production does not start with these settings. ${problems.join(" ")}`, fix: "Put each one right, then redeploy." }
      : { area: AREA, name: "Start-up check", status: "ok", detail: "No malformed list, no key used for two purposes, and phone lookups have the keys they need." },
  );
  return rows;
}
