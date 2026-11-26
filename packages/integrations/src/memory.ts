// In-memory stores with the same rules as the Postgres ones. Used by the
// framework's tests and by each connector's contract tests, so a connector
// is proved against the queue's real behaviour without a database.
import { claimable, dedupeKeyFor, type Job, type JobStatus, type JobStore, type NewJob, type SyncLog, type SyncLogEntry, type Transition } from "./jobs.ts";
import type { Mapping, MappingKey, MappingStore } from "./mappings.ts";
import type { ReconciliationReport, ReconciliationStore } from "./reconcile.ts";
import type { Connection, ConnectionStatus, ConnectionStore, TokenVault, VaultContext } from "./tokens.ts";

export class MemoryJobStore implements JobStore {
  readonly jobs: Job[] = [];
  private seq = 0;

  async enqueue(input: NewJob, now: number): Promise<{ job: Job; created: boolean }> {
    const dedupeKey = dedupeKeyFor(input);
    const existing = this.jobs.find((j) => j.tenantId === input.tenantId && j.connector === input.connector && j.dedupeKey === dedupeKey);
    if (existing) return { job: { ...existing }, created: false };
    const job: Job = {
      id: `job_${++this.seq}`,
      tenantId: input.tenantId,
      connector: input.connector,
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      dedupeKey,
      payload: JSON.parse(JSON.stringify(input.payload)) as Job["payload"],
      status: "pending",
      attempts: 0,
      failures: 0,
      runAfter: input.runAfter ?? now,
      leaseUntil: null,
      lastErrorCode: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    this.jobs.push(job);
    return { job: { ...job }, created: true };
  }

  async claimDue(input: { now: number; limit: number; leaseMs: number; tenantId?: number; skip?: readonly { tenantId: number; connector: string }[] }): Promise<Job[]> {
    const due = this.jobs
      .filter((j) => claimable(j, input.now))
      .filter((j) => input.tenantId === undefined || j.tenantId === input.tenantId)
      .filter((j) => !input.skip?.some((s) => s.tenantId === j.tenantId && s.connector === j.connector))
      .sort((a, b) => a.runAfter - b.runAfter || a.createdAt - b.createdAt)
      .slice(0, input.limit);
    for (const j of due) {
      j.status = "running";
      j.attempts += 1;
      j.leaseUntil = input.now + input.leaseMs;
      j.updatedAt = input.now;
    }
    return due.map((j) => ({ ...j }));
  }

  async finish(ref: Pick<Job, "id" | "tenantId" | "attempts">, t: Transition, now: number): Promise<boolean> {
    const j = this.jobs.find((x) => x.id === ref.id && x.tenantId === ref.tenantId);
    if (!j || j.status !== "running" || j.attempts !== ref.attempts) return false;
    j.leaseUntil = null;
    j.updatedAt = now;
    if (t.status === "succeeded") {
      j.status = "succeeded";
      j.finishedAt = now;
      j.lastErrorCode = null;
      j.lastError = null;
      return true;
    }
    j.status = t.status;
    j.lastErrorCode = t.code;
    j.lastError = t.message;
    if (t.status === "pending") {
      j.runAfter = t.runAfter;
      if (t.countsAsFailure) j.failures += 1;
    } else {
      if (t.status === "dead") j.failures += 1;
      j.finishedAt = now;
    }
    return true;
  }

  async replay(ref: Pick<Job, "id" | "tenantId">, now: number): Promise<boolean> {
    const j = this.jobs.find((x) => x.id === ref.id && x.tenantId === ref.tenantId);
    if (!j || (j.status !== "needs_attention" && j.status !== "dead")) return false;
    Object.assign(j, { status: "pending", failures: 0, runAfter: now, finishedAt: null, updatedAt: now });
    return true;
  }

  async cancelOpen(tenantId: number, connector: string, now: number): Promise<number> {
    const open = this.jobs.filter((j) => j.tenantId === tenantId && j.connector === connector && j.status !== "succeeded" && j.status !== "canceled");
    for (const j of open) Object.assign(j, { status: "canceled", leaseUntil: null, finishedAt: now, updatedAt: now });
    return open.length;
  }

  async get(tenantId: number, id: string): Promise<Job | null> {
    const j = this.jobs.find((x) => x.id === id && x.tenantId === tenantId);
    return j ? { ...j } : null;
  }

  async list(tenantId: number, filter: { connector?: string; statuses?: readonly JobStatus[] } = {}): Promise<Job[]> {
    return this.jobs
      .filter((j) => j.tenantId === tenantId && (!filter.connector || j.connector === filter.connector) && (!filter.statuses || filter.statuses.includes(j.status)))
      .map((j) => ({ ...j }));
  }
}

export class MemorySyncLog implements SyncLog {
  readonly entries: SyncLogEntry[] = [];
  async append(entry: SyncLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

const mappingId = (k: MappingKey) => [k.tenantId, k.connector, k.localType, k.localId, k.externalType].join("|");

export class MemoryMappingStore implements MappingStore {
  readonly rows = new Map<string, Mapping>();

  async get(key: MappingKey): Promise<Mapping | null> {
    const m = this.rows.get(mappingId(key));
    return m ? { ...m } : null;
  }

  async putIfAbsent(mapping: Omit<Mapping, "flaggedAt" | "flagReason" | "createdAt" | "updatedAt">, now: number): Promise<{ mapping: Mapping; created: boolean }> {
    const id = mappingId(mapping);
    const existing = this.rows.get(id);
    if (existing) return { mapping: { ...existing }, created: false };
    const row: Mapping = { ...mapping, flaggedAt: null, flagReason: null, createdAt: now, updatedAt: now };
    this.rows.set(id, row);
    return { mapping: { ...row }, created: true };
  }

  async recordSent(key: MappingKey, sent: { sentHash: string; externalVersion: string | null }, now: number): Promise<void> {
    const m = this.rows.get(mappingId(key));
    if (m) Object.assign(m, sent, { updatedAt: now });
  }

  async flag(key: MappingKey, reason: string, now: number): Promise<void> {
    const m = this.rows.get(mappingId(key));
    if (m && m.flaggedAt === null) Object.assign(m, { flaggedAt: now, flagReason: reason, updatedAt: now });
  }

  async list(tenantId: number, connector: string, filter: { flagged?: boolean } = {}): Promise<Mapping[]> {
    return [...this.rows.values()]
      .filter((m) => m.tenantId === tenantId && m.connector === connector && (filter.flagged === undefined || (m.flaggedAt !== null) === filter.flagged))
      .map((m) => ({ ...m }));
  }
}

export class MemoryConnectionStore implements ConnectionStore {
  readonly rows: Connection[] = [];
  private locks = new Map<string, Promise<unknown>>();

  private find(ref: Pick<Connection, "id" | "tenantId">): Connection | undefined {
    // The club is part of every lookup: an id from another club finds nothing.
    return this.rows.find((c) => c.id === ref.id && c.tenantId === ref.tenantId);
  }

  async get(tenantId: number, connector: string): Promise<Connection | null> {
    const c = this.rows.find((x) => x.tenantId === tenantId && x.connector === connector);
    return c ? { ...c } : null;
  }

  async withLock<T>(ref: Pick<Connection, "id" | "tenantId">, fn: (fresh: Connection | null) => Promise<T>): Promise<T> {
    const key = `${ref.tenantId}|${ref.id}`;
    const before = this.locks.get(key) ?? Promise.resolve();
    const run = before.catch(() => {}).then(() => {
      const fresh = this.find(ref);
      return fn(fresh ? { ...fresh } : null);
    });
    this.locks.set(key, run);
    return run;
  }

  async replaceTokens(ref: Pick<Connection, "id" | "tenantId">, expectedVersion: number, next: { sealedTokens: string; accessExpiresAt: number; refreshExpiresAt: number | null; scopes: readonly string[]; now: number }): Promise<boolean> {
    const c = this.find(ref);
    if (!c || c.tokenVersion !== expectedVersion || c.status === "disconnected") return false;
    Object.assign(c, { sealedTokens: next.sealedTokens, accessExpiresAt: next.accessExpiresAt, refreshExpiresAt: next.refreshExpiresAt, scopes: [...next.scopes], tokenVersion: c.tokenVersion + 1, updatedAt: next.now });
    return true;
  }

  async setStatus(ref: Pick<Connection, "id" | "tenantId">, status: ConnectionStatus, lastError: string | null, now: number): Promise<void> {
    const c = this.find(ref);
    if (c) Object.assign(c, { status, lastError, updatedAt: now });
  }

  async pauseUntil(ref: Pick<Connection, "id" | "tenantId">, until: number, now: number): Promise<void> {
    const c = this.find(ref);
    if (c) Object.assign(c, { pausedUntil: until, updatedAt: now });
  }

  async clearTokens(ref: Pick<Connection, "id" | "tenantId">, now: number): Promise<void> {
    const c = this.find(ref);
    if (c) Object.assign(c, { status: "disconnected", sealedTokens: null, accessExpiresAt: null, refreshExpiresAt: null, pausedUntil: null, tokenVersion: c.tokenVersion + 1, updatedAt: now });
  }
}

export class MemoryReconciliationStore implements ReconciliationStore {
  readonly reports: ReconciliationReport[] = [];
  async save(report: ReconciliationReport): Promise<void> {
    this.reports.push(report);
  }
  async latest(tenantId: number, connector: string): Promise<ReconciliationReport | null> {
    return this.reports.filter((r) => r.tenantId === tenantId && r.connector === connector).sort((a, b) => b.generatedAt - a.generatedAt)[0] ?? null;
  }
}

/**
 * NOT encryption: a stand-in that keeps the vault's one rule (text sealed for
 * one club's connection opens for nothing else), for tests of everything
 * around the vault. The real one is apps/web/lib/integrations/token-vault.ts.
 */
export class FakeVault implements TokenVault {
  private key(c: VaultContext) {
    return `${c.tenantId}/${c.connector}/${c.connectionId}`;
  }
  async seal(context: VaultContext, plaintext: string): Promise<string> {
    return `fake:${this.key(context)}:${[...plaintext].reverse().join("")}`;
  }
  async open(context: VaultContext, sealed: string): Promise<string> {
    const prefix = `fake:${this.key(context)}:`;
    if (!sealed.startsWith(prefix)) throw new Error("sealed for something else");
    return [...sealed.slice(prefix.length)].reverse().join("");
  }
}
