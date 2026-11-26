// The connector framework (build plan §12.1; test plan §3.19): the sync
// queue, the error queue, token handling, the vault, mappings and the
// reconciliation report. Connectors (Xero first) are tested against the same
// in-memory stores, so what's proved here holds for each of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  IntegrationError,
  MAX_FAILURES,
  backoffMs,
  clearingBalance,
  connectionHealth,
  decideSync,
  defineConnector,
  disconnect,
  fingerprint,
  providerIdempotencyKey,
  reconcile,
  redact,
  runDueJobs,
  sealTokens,
  usableTokens,
  validateConnector,
  type Connection,
  type ConnectorManifest,
  type JobHandler,
  type RunnerDeps,
  type TokenSet,
} from "@luvallplay/integrations";
import { FakeVault, MemoryConnectionStore, MemoryJobStore, MemoryMappingStore, MemorySyncLog } from "@luvallplay/integrations/memory";
import { parseKeks, sealedWith, tokenVault } from "../lib/integrations/token-vault.ts";

const T0 = Date.UTC(2026, 10, 26);
const MIN = 60_000;

const manifest: ConnectorManifest = {
  id: "ledger",
  module: "ledger",
  name: { en: "Ledger", vi: "Sổ cái" },
  provider: "Ledger Ltd",
  auth: { kind: "oauth2", scopes: ["offline_access"], refreshTokensRotate: true },
  statement: {
    reads: [{ en: "Your chart of accounts", vi: "Hệ thống tài khoản của bạn" }],
    writes: [{ en: "Invoices for payments", vi: "Hoá đơn cho các khoản thanh toán" }],
    never: [{ en: "Never deletes anything", vi: "Không bao giờ xoá gì" }],
  },
  regions: ["syd"],
  limits: { perMinute: 60 },
  jobKinds: ["invoice.push", "payment.push"],
};

function tokens(over: Partial<TokenSet> = {}): TokenSet {
  return { accessToken: "access-AAA-111", refreshToken: "refresh-RRR-111", accessExpiresAt: T0 + 30 * MIN, refreshExpiresAt: T0 + 60 * 86_400_000, scopes: ["offline_access"], ...over };
}

async function world(handlers: Record<string, JobHandler> = {}) {
  let now = T0;
  const jobs = new MemoryJobStore();
  const connections = new MemoryConnectionStore();
  const mappings = new MemoryMappingStore();
  const log = new MemorySyncLog();
  const vault = new FakeVault();
  const metered: number[] = [];
  let entitled = true;
  const connect = async (tenantId: number, over: Partial<Connection> = {}) => {
    const c: Connection = {
      id: `conn_${tenantId}`,
      tenantId,
      connector: "ledger",
      status: "connected",
      externalAccountId: `org-${tenantId}`,
      externalAccountName: `Club ${tenantId}`,
      sealedTokens: null,
      tokenVersion: 1,
      accessExpiresAt: T0 + 30 * MIN,
      refreshExpiresAt: T0 + 60 * 86_400_000,
      scopes: ["offline_access"],
      pausedUntil: null,
      lastError: null,
      connectedBy: "owner@example.com",
      connectedAt: T0,
      updatedAt: T0,
      ...over,
    };
    c.sealedTokens = over.sealedTokens === undefined ? await sealTokens(vault, { tenantId, connector: "ledger", connectionId: c.id }, tokens()) : over.sealedTokens;
    connections.rows.push(c);
    return c;
  };
  const deps: RunnerDeps = {
    jobs,
    connections,
    mappings,
    log,
    handlers: { ledger: handlers },
    entitled: async () => entitled,
    meter: async (_t, _c, calls) => void metered.push(calls),
    now: () => now,
  };
  return { deps, jobs, connections, mappings, log, vault, metered, connect, advance: (ms: number) => (now += ms), setEntitled: (v: boolean) => (entitled = v), now: () => now };
}

const invoice = (tenantId: number, id: string) => ({ tenantId, connector: "ledger", kind: "invoice.push", subjectType: "payment", subjectId: id, payload: { amount: 3300, currency: "NZD" } });

// ── Connectors and their statements ────────────────────────────────────────

test("a connector must say, in both languages, what it reads, writes and never does", () => {
  assert.deepEqual(validateConnector(manifest), []);
  assert.equal(defineConnector(manifest).id, "ledger");
  const noNever = { ...manifest, statement: { ...manifest.statement, never: [] } };
  assert.match(validateConnector(noNever).join(), /never does/);
  const halfTranslated = { ...manifest, statement: { ...manifest.statement, writes: [{ en: "Invoices", vi: " " }] } };
  assert.match(validateConnector(halfTranslated).join(), /English and Vietnamese/);
  assert.throws(() => defineConnector({ ...manifest, id: "Bad Id" }), /kebab-case/);
  assert.match(validateConnector({ ...manifest, auth: { kind: "oauth2", scopes: [], refreshTokensRotate: true } }).join(), /scopes/);
});

// ── The queue ──────────────────────────────────────────────────────────────

test("the same event queued twice is one job, per club", async () => {
  const w = await world();
  const a = await w.jobs.enqueue(invoice(1, "p1"), T0);
  const b = await w.jobs.enqueue(invoice(1, "p1"), T0 + 5);
  const other = await w.jobs.enqueue(invoice(2, "p1"), T0);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(b.job.id, a.job.id);
  assert.equal(other.created, true, "another club's item with the same id is its own job");
  assert.equal(w.jobs.jobs.length, 2);
});

test("a job runs once: its handler finds the mapping on a replay, and every attempt sends the same idempotency key", async () => {
  const sent: string[] = [];
  const created = new Map<string, string>(); // the provider: idempotency key → the invoice it made
  const push: JobHandler = async (ctx) => {
    const key = { tenantId: ctx.job.tenantId, connector: "ledger", localType: ctx.job.subjectType, localId: ctx.job.subjectId, externalType: "invoice" };
    const decision = decideSync(await ctx.mappings.get(key), fingerprint(ctx.job.payload));
    if (decision.action === "skip") return;
    const idem = ctx.idempotencyKey();
    sent.push(idem);
    ctx.countCall();
    if (!created.has(idem)) created.set(idem, `INV-${created.size + 1}`);
    await ctx.mappings.putIfAbsent({ ...key, externalId: created.get(idem)!, sentHash: fingerprint(ctx.job.payload), externalVersion: "v1" }, ctx.now());
  };
  const w = await world({ "invoice.push": push });
  await w.connect(1);
  const { job } = await w.jobs.enqueue(invoice(1, "p1"), T0);
  assert.deepEqual(await runDueJobs(w.deps), { claimed: 1, succeeded: 1, retried: 0, waiting: 0, needsAttention: 0, dead: 0, leaseLost: 0 });

  // Replay it by hand, twice (as if the queue lost its result): still one invoice.
  for (let i = 0; i < 2; i++) {
    Object.assign(w.jobs.jobs[0], { status: "pending", runAfter: w.now() });
    await runDueJobs(w.deps);
  }
  assert.equal(created.size, 1);
  assert.equal(sent.length, 1, "the replays found the mapping and sent nothing");
  assert.equal(sent[0], providerIdempotencyKey(job));
  assert.equal((await w.mappings.list(1, "ledger")).length, 1);
  assert.deepEqual(w.metered, [1]);
});

test("a crash after the provider said yes doesn't make a second item: the retry sends the same key", async () => {
  const provider = new Map<string, string>();
  let crashOnce = true;
  const w = await world({
    "invoice.push": async (ctx) => {
      const idem = ctx.idempotencyKey();
      if (!provider.has(idem)) provider.set(idem, `INV-${provider.size + 1}`);
      if (crashOnce) {
        crashOnce = false;
        throw new Error("fetch failed"); // the answer never arrived
      }
      await ctx.mappings.putIfAbsent({ tenantId: 1, connector: "ledger", localType: "payment", localId: "p1", externalType: "invoice", externalId: provider.get(idem)!, sentHash: "h", externalVersion: null }, ctx.now());
    },
  });
  await w.connect(1);
  await w.jobs.enqueue(invoice(1, "p1"), T0);
  assert.equal((await runDueJobs(w.deps)).retried, 1);
  w.advance(2 * MIN);
  assert.equal((await runDueJobs(w.deps)).succeeded, 1);
  assert.equal(provider.size, 1);
});

test("out of order: a payment that arrives before its invoice waits, then both land once", async () => {
  const order: string[] = [];
  const w = await world({
    "invoice.push": async (ctx) => {
      order.push("invoice");
      await ctx.mappings.putIfAbsent({ tenantId: 1, connector: "ledger", localType: "payment", localId: ctx.job.subjectId, externalType: "invoice", externalId: "INV-1", sentHash: "h", externalVersion: null }, ctx.now());
    },
    "payment.push": async (ctx) => {
      const inv = await ctx.mappings.get({ tenantId: 1, connector: "ledger", localType: "payment", localId: ctx.job.subjectId, externalType: "invoice" });
      if (!inv) throw new IntegrationError("dependency", "The invoice hasn't synced yet.");
      order.push("payment");
    },
  });
  await w.connect(1);
  await w.jobs.enqueue({ ...invoice(1, "p1"), kind: "payment.push" }, T0);
  await w.jobs.enqueue(invoice(1, "p1"), T0);
  const first = await runDueJobs(w.deps);
  assert.deepEqual([first.retried, first.succeeded], [1, 1]);
  w.advance(2 * MIN);
  assert.equal((await runDueJobs(w.deps)).succeeded, 1);
  assert.deepEqual(order, ["invoice", "payment"]);
});

test("failures back off (1 min up to a day) and end in the error queue; Replay starts again", async () => {
  let fail = true;
  const w = await world({
    "invoice.push": async () => {
      if (fail) throw new IntegrationError("transient", "HTTP 503");
    },
  });
  await w.connect(1);
  const { job } = await w.jobs.enqueue(invoice(1, "p1"), T0);
  assert.ok(backoffMs(job, 1) >= MIN && backoffMs(job, 1) <= 1.2 * MIN);
  assert.ok(backoffMs(job, 7) >= 1440 * MIN && backoffMs(job, 99) <= 1.2 * 1440 * MIN);
  assert.equal(backoffMs(job, 3), backoffMs(job, 3), "the wait for a job's nth failure is fixed");

  assert.equal((await runDueJobs(w.deps)).retried, 1);
  assert.equal((await runDueJobs(w.deps)).claimed, 0, "not due yet");
  for (let i = 1; i < MAX_FAILURES; i++) {
    w.advance(2 * 1440 * MIN);
    await runDueJobs(w.deps);
  }
  const dead = (await w.jobs.get(1, job.id))!;
  assert.equal(dead.status, "dead");
  assert.equal(dead.failures, MAX_FAILURES);
  assert.equal(dead.lastErrorCode, "transient");
  assert.deepEqual((await w.jobs.list(1, { statuses: ["needs_attention", "dead"] })).map((j) => j.id), [job.id]);
  w.advance(2 * 1440 * MIN);
  assert.equal((await runDueJobs(w.deps)).claimed, 0, "nothing retries from the error queue by itself");

  fail = false;
  assert.equal(await w.jobs.replay({ id: job.id, tenantId: 2 }, w.now()), false, "another club can't replay it");
  assert.equal(await w.jobs.replay(job, w.now()), true);
  assert.equal((await runDueJobs(w.deps)).succeeded, 1);
  assert.equal(await w.jobs.replay(job, w.now()), false, "a finished job can't be replayed");
});

test("a lock date goes straight to the error queue with its reason, and a retry succeeds once it's fixed", async () => {
  let locked = true;
  const w = await world({
    "invoice.push": async () => {
      if (locked) throw new IntegrationError("lock_date", "The posting date is before the lock date.", { detail: { lockDate: "2026-09-30" } });
    },
  });
  await w.connect(1);
  const { job } = await w.jobs.enqueue(invoice(1, "p1"), T0);
  assert.equal((await runDueJobs(w.deps)).needsAttention, 1);
  const stuck = (await w.jobs.get(1, job.id))!;
  assert.deepEqual([stuck.status, stuck.lastErrorCode, stuck.failures], ["needs_attention", "lock_date", 0]);
  locked = false;
  await w.jobs.replay(job, w.now());
  assert.equal((await runDueJobs(w.deps)).succeeded, 1);
});

test("a rate limit pauses the whole connection for as long as the provider says, and isn't a failure", async () => {
  let limited = true;
  const ran: string[] = [];
  const w = await world({
    "invoice.push": async (ctx) => {
      ran.push(ctx.job.subjectId);
      ctx.countCall();
      if (limited) throw new IntegrationError("rate_limited", "HTTP 429", { retryAfterMs: 10 * MIN });
    },
  });
  await w.connect(1);
  await w.connect(2);
  const a = await w.jobs.enqueue(invoice(1, "p1"), T0);
  await w.jobs.enqueue(invoice(1, "p2"), T0);
  await w.jobs.enqueue(invoice(2, "p9"), T0);
  const run = await runDueJobs(w.deps);
  // Club 1's second job was left alone; club 2 has its own limit and (here) hits it too.
  assert.deepEqual(ran, ["p1", "p9"]);
  assert.equal(run.waiting, 2);
  assert.equal((await w.jobs.get(1, a.job.id))!.failures, 0);
  assert.equal((await w.connections.get(1, "ledger"))!.pausedUntil, T0 + 10 * MIN);

  limited = false;
  w.advance(5 * MIN);
  assert.equal((await runDueJobs(w.deps)).succeeded, 0, "still inside the provider's wait");
  w.advance(6 * MIN);
  assert.equal((await runDueJobs(w.deps)).succeeded, 3);
});

test("a revoked authorisation marks the connection, and its jobs wait for a reconnect without failing", async () => {
  const w = await world({
    "invoice.push": async () => {
      throw new IntegrationError("auth", "invalid_grant refresh_token=refresh-RRR-111");
    },
  });
  const c = await w.connect(1);
  const { job } = await w.jobs.enqueue(invoice(1, "p1"), T0);
  await w.jobs.enqueue(invoice(1, "p2"), T0 + 1);
  const run = await runDueJobs(w.deps);
  assert.deepEqual([run.claimed, run.waiting], [1, 1], "the second job wasn't even tried");
  const after = (await w.connections.get(1, "ledger"))!;
  assert.equal(after.status, "revoked");
  assert.ok(!after.lastError!.includes("refresh-RRR-111"), "the stored error is redacted");
  assert.equal((await w.jobs.get(1, job.id))!.failures, 0);
  // Reconnected: the jobs go through.
  await w.connections.setStatus(c, "connected", null, w.now());
  (w.deps.handlers.ledger as Record<string, JobHandler>)["invoice.push"] = async () => {};
  w.advance(61 * MIN);
  assert.equal((await runDueJobs(w.deps)).succeeded, 2);
});

test("a club whose plan no longer includes the connector syncs nothing, and nothing is deleted", async () => {
  let ran = 0;
  const w = await world({ "invoice.push": async () => void ran++ });
  await w.connect(1);
  await w.mappings.putIfAbsent({ tenantId: 1, connector: "ledger", localType: "payment", localId: "old", externalType: "invoice", externalId: "INV-0", sentHash: "h", externalVersion: null }, T0);
  const { job } = await w.jobs.enqueue(invoice(1, "p1"), T0);
  w.setEntitled(false);
  assert.equal((await runDueJobs(w.deps)).needsAttention, 1);
  assert.equal(ran, 0);
  assert.equal((await w.jobs.get(1, job.id))!.lastErrorCode, "not_entitled");
  assert.equal((await w.mappings.list(1, "ledger")).length, 1, "mappings stay");
  assert.equal((await w.connections.get(1, "ledger"))!.status, "connected", "the connection stays");
  w.setEntitled(true);
  await w.jobs.replay(job, w.now());
  assert.equal((await runDueJobs(w.deps)).succeeded, 1);
});

test("a worker that died is replaced when its lease runs out, and its late result is dropped", async () => {
  const w = await world();
  await w.connect(1);
  await w.jobs.enqueue(invoice(1, "p1"), T0);
  const [first] = await w.jobs.claimDue({ now: T0, limit: 5, leaseMs: 5 * MIN });
  assert.deepEqual(await w.jobs.claimDue({ now: T0 + MIN, limit: 5, leaseMs: 5 * MIN }), [], "leased: nobody else gets it");
  const [second] = await w.jobs.claimDue({ now: T0 + 6 * MIN, limit: 5, leaseMs: 5 * MIN });
  assert.equal(second.id, first.id);
  assert.equal(second.attempts, 2);
  assert.equal(await w.jobs.finish(first, { status: "succeeded" }, T0 + 7 * MIN), false, "the first worker's lease is gone");
  assert.equal(await w.jobs.finish(second, { status: "succeeded" }, T0 + 7 * MIN), true);
});

test("every attempt is logged, with secrets scrubbed", async () => {
  const w = await world({
    "invoice.push": async () => {
      throw new Error("POST failed: Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop client_secret=shhh-very-secret");
    },
  });
  await w.connect(1);
  await w.jobs.enqueue(invoice(1, "p1"), T0);
  await runDueJobs(w.deps);
  const [entry] = w.log.entries;
  assert.deepEqual([entry.outcome, entry.code, entry.attempt], ["retry", "unknown", 1]);
  assert.ok(!/eyJ|shhh/.test(entry.message!), entry.message!);
  assert.ok(!/eyJ|shhh/.test(w.jobs.jobs[0].lastError!));
});

test("redact removes named secrets, bearer tokens, JWTs, Stripe keys and key=value secrets", () => {
  const out = redact('token abc123SECRETxyz and {"refresh_token":"r-12345678"} sk_test_51Habcdefgh Basic dXNlcjpwYXNzd29yZA==', ["abc123SECRETxyz"]);
  for (const leak of ["abc123SECRETxyz", "r-12345678", "sk_test_51Habcdefgh", "dXNlcjpwYXNzd29yZA"]) assert.ok(!out.includes(leak), `${leak} in ${out}`);
  assert.equal(redact("The account 200 Sales was archived."), "The account 200 Sales was archived.");
});

// ── Tokens ─────────────────────────────────────────────────────────────────

test("tokens refresh once however many workers ask, and the rotated refresh token is the one stored", async () => {
  const w = await world();
  const c = await w.connect(1, { accessExpiresAt: T0 + 30_000 });
  let refreshes = 0;
  const used: (string | null)[] = [];
  const refresh = async (current: TokenSet) => {
    refreshes++;
    used.push(current.refreshToken);
    await new Promise((r) => setTimeout(r, 5));
    return tokens({ accessToken: `access-${refreshes}`, refreshToken: `refresh-${refreshes}`, accessExpiresAt: T0 + 30 * MIN });
  };
  const deps = { store: w.connections, vault: w.vault, refresh, now: w.now };
  const results = await Promise.all([usableTokens(deps, c), usableTokens(deps, c), usableTokens(deps, c)]);
  assert.equal(refreshes, 1, "a rotating refresh token is spent once");
  assert.deepEqual(results.map((t) => t.accessToken), ["access-1", "access-1", "access-1"]);
  const stored = (await w.connections.get(1, "ledger"))!;
  assert.equal(stored.tokenVersion, 2);
  assert.ok(!stored.sealedTokens!.includes("access-1") && !stored.sealedTokens!.includes("refresh-1"), "stored sealed");
  // The next refresh uses the rotated token, not the first one.
  w.advance(31 * MIN);
  await usableTokens(deps, (await w.connections.get(1, "ledger"))!);
  assert.deepEqual(used, ["refresh-RRR-111", "refresh-1"]);
});

test("a refused refresh marks the connection revoked; a network failure changes nothing", async () => {
  const w = await world();
  const c = await w.connect(1, { accessExpiresAt: T0 });
  const net = { store: w.connections, vault: w.vault, now: w.now, refresh: async () => Promise.reject(new Error("fetch failed")) };
  await assert.rejects(usableTokens(net, c), (e: IntegrationError) => e.code === "transient");
  const same = (await w.connections.get(1, "ledger"))!;
  assert.deepEqual([same.status, same.tokenVersion], ["connected", 1]);

  const refused = { ...net, refresh: async () => Promise.reject(new IntegrationError("auth", "invalid_grant for refresh-RRR-111")) };
  await assert.rejects(usableTokens(refused, c), (e: IntegrationError) => e.code === "auth");
  const revoked = (await w.connections.get(1, "ledger"))!;
  assert.equal(revoked.status, "revoked");
  assert.ok(!revoked.lastError!.includes("refresh-RRR-111"));
  await assert.rejects(usableTokens(refused, revoked), /revoked/);
});

test("the health screen: connected, expiring, revoked, error, disconnected", () => {
  const day = 86_400_000;
  assert.equal(connectionHealth({ status: "connected", refreshExpiresAt: T0 + 40 * day }, T0), "connected");
  assert.equal(connectionHealth({ status: "connected", refreshExpiresAt: T0 + 10 * day }, T0), "expiring");
  assert.equal(connectionHealth({ status: "connected", refreshExpiresAt: T0 - 1 }, T0), "revoked");
  assert.equal(connectionHealth({ status: "connected", refreshExpiresAt: null }, T0), "connected");
  for (const s of ["revoked", "error", "disconnected"] as const) assert.equal(connectionHealth({ status: s, refreshExpiresAt: T0 + 40 * day }, T0), s);
});

test("disconnect revokes at the provider and deletes our tokens, even when the provider can't be reached", async () => {
  const w = await world();
  const c = await w.connect(1);
  await w.connect(2);
  await w.mappings.putIfAbsent({ tenantId: 1, connector: "ledger", localType: "payment", localId: "p1", externalType: "invoice", externalId: "INV-1", sentHash: "h", externalVersion: null }, T0);
  await w.jobs.enqueue(invoice(1, "p2"), T0);
  const revoked: string[] = [];
  const ok = await disconnect({ store: w.connections, vault: w.vault, now: w.now, revoke: async (t) => void revoked.push(t.refreshToken!) }, c);
  assert.deepEqual([ok.revokedAtProvider, revoked], [true, ["refresh-RRR-111"]]);
  const gone = (await w.connections.get(1, "ledger"))!;
  assert.deepEqual([gone.status, gone.sealedTokens, gone.accessExpiresAt], ["disconnected", null, null]);
  assert.equal(await w.jobs.cancelOpen(1, "ledger", w.now()), 1);
  assert.equal((await w.mappings.list(1, "ledger")).length, 1, "mappings and history stay");
  assert.equal((await w.connections.get(2, "ledger"))!.status, "connected", "the other club is untouched");

  const c2 = (await w.connections.get(2, "ledger"))!;
  const down = await disconnect({ store: w.connections, vault: w.vault, now: w.now, revoke: async () => Promise.reject(new Error("fetch failed")) }, c2);
  assert.equal(down.revokedAtProvider, false);
  assert.equal((await w.connections.get(2, "ledger"))!.sealedTokens, null);
});

test("one club can't touch another's connection, even with its id", async () => {
  const w = await world();
  const c1 = await w.connect(1);
  await w.connections.setStatus({ id: c1.id, tenantId: 2 }, "revoked", "x", T0);
  await w.connections.clearTokens({ id: c1.id, tenantId: 2 }, T0);
  assert.equal(await w.connections.replaceTokens({ id: c1.id, tenantId: 2 }, 1, { sealedTokens: "evil", accessExpiresAt: T0, refreshExpiresAt: null, scopes: [], now: T0 }), false);
  const still = (await w.connections.get(1, "ledger"))!;
  assert.deepEqual([still.status, still.tokenVersion, still.sealedTokens], ["connected", 1, c1.sealedTokens]);
  assert.equal(await w.connections.get(2, "ledger"), null);
});

// ── The vault ──────────────────────────────────────────────────────────────

const kek = (id: string) => `${id}:${randomBytes(32).toString("base64")}`;

test("the vault: sealed text opens only for the same club, connector and connection", async () => {
  const keys = parseKeks(kek("k1"));
  const vault = tokenVault(() => keys);
  const ctx = { tenantId: 1, connector: "xero", connectionId: "c1" };
  const secret = JSON.stringify(tokens());
  const sealed = await vault.seal(ctx, secret);
  assert.equal(await vault.open(ctx, sealed), secret);
  assert.ok(!sealed.includes("access-AAA-111") && !sealed.includes(Buffer.from("access-AAA-111").toString("base64url")));
  assert.notEqual(await vault.seal(ctx, secret), sealed, "every sealing is different");
  for (const other of [{ ...ctx, tenantId: 2 }, { ...ctx, connector: "myob" }, { ...ctx, connectionId: "c2" }]) {
    await assert.rejects(vault.open(other, sealed), /can't be opened for this connection/);
  }
  const parts = sealed.split(".");
  const flipped = [...parts.slice(0, 3), `${parts[3].slice(0, -2)}${parts[3].endsWith("AA") ? "BB" : "AA"}`].join(".");
  await assert.rejects(vault.open(ctx, flipped), /can't be opened/);
  await assert.rejects(vault.open(ctx, "not sealed"), /known format/);
});

test("the vault: keys rotate (new sealings use the first key, old ones still open) and no key means nothing is stored", async () => {
  const oldKey = kek("k1");
  const before = tokenVault(() => parseKeks(oldKey));
  const ctx = { tenantId: 1, connector: "xero", connectionId: "c1" };
  const sealedOld = await before.seal(ctx, "secret");
  const rotated = parseKeks(`${kek("k2")},${oldKey}`);
  const after = tokenVault(() => rotated);
  assert.equal(await after.open(ctx, sealedOld), "secret");
  const sealedNew = await after.seal(ctx, "secret");
  assert.deepEqual([sealedWith(sealedOld), sealedWith(sealedNew)], ["k1", "k2"]);
  await assert.rejects(before.open(ctx, sealedNew), /isn't available/);

  await assert.rejects(tokenVault(() => parseKeks(undefined)).seal(ctx, "secret"), /No encryption key/);
  assert.throws(() => parseKeks("k1:c2hvcnQ="), /32 bytes/);
  assert.throws(() => parseKeks(randomBytes(32).toString("base64")), /needs an id/);
  assert.throws(() => parseKeks(`${oldKey},${oldKey}`), /twice/);
});

// ── Mappings and reconciliation ────────────────────────────────────────────

test("an item changed at the provider after it synced is flagged, never overwritten", async () => {
  const w = await world();
  const key = { tenantId: 1, connector: "ledger", localType: "payment", localId: "p1", externalType: "invoice" };
  assert.equal(decideSync(null, "h1").action, "create");
  const { mapping } = await w.mappings.putIfAbsent({ ...key, externalId: "INV-1", sentHash: "h1", externalVersion: "2026-11-26T01:00:00" }, T0);
  const second = await w.mappings.putIfAbsent({ ...key, externalId: "INV-2", sentHash: "h1", externalVersion: null }, T0);
  assert.deepEqual([second.created, second.mapping.externalId], [false, "INV-1"], "the first mapping wins");
  assert.equal(decideSync(mapping, "h1", "2026-11-26T01:00:00").action, "skip");
  assert.equal(decideSync(mapping, "h2", "2026-11-26T01:00:00").action, "update");
  assert.equal(decideSync(mapping, "h2", "2026-11-27T09:30:00").action, "flag");
  await w.mappings.flag(key, "Edited in the ledger", T0 + 1);
  const flagged = (await w.mappings.get(key))!;
  assert.equal(decideSync(flagged, "h1", "2026-11-26T01:00:00").action, "flag", "it stays flagged until a person clears it");
  assert.equal((await w.mappings.list(1, "ledger", { flagged: true })).length, 1);
  assert.equal(fingerprint({ a: 1, b: [1, 2], c: undefined }), fingerprint({ b: [1, 2], a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});

test("the reconciliation report matches to the cent, and names what doesn't", () => {
  const base = { tenantId: 1, connector: "ledger", from: T0, to: T0 + 86_400_000, now: T0 + 86_400_000 };
  const local = [
    { key: "sales:memberships", currency: "NZD", amount: 33_00, count: 1 },
    { key: "sales:memberships", currency: "nzd", amount: 66_01, count: 2 },
    { key: "fees", currency: "NZD", amount: -2_95, count: 3 },
  ];
  const ok = reconcile({ ...base, local, external: [{ key: "sales:memberships", currency: "NZD", amount: 99_01, count: 3 }, { key: "fees", currency: "NZD", amount: -2_95, count: 3 }] });
  assert.equal(ok.balanced, true);
  const off = reconcile({ ...base, local, external: [{ key: "sales:memberships", currency: "NZD", amount: 99_00, count: 3 }, { key: "refunds", currency: "NZD", amount: -10_00, count: 1 }], openJobs: 2 });
  assert.equal(off.balanced, false);
  assert.deepEqual(off.rows.map((r) => [r.key, r.status, r.difference]), [["fees", "missing_external", 2_95], ["refunds", "missing_local", -10_00], ["sales:memberships", "amount_differs", -1]]);
  assert.equal(off.openJobs, 2);
  assert.throws(() => reconcile({ ...base, local: [{ key: "x", currency: "NZD", amount: 1.5, count: 1 }], external: [] }), /whole minor units/);
  // A payout: sales in, fees and a refund out, the payout itself out. The clearing account ends at zero.
  assert.equal(clearingBalance([{ amount: 99_01 }, { amount: -2_95 }, { amount: -10_00 }, { amount: -86_06 }]), 0);
});
