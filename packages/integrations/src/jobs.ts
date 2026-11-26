// The sync queue's rules (build plan §12.1 "Sync engine"). Pure: the store
// (Postgres in the app, memory in tests) is passed in; see engine.ts.
//
// Every business event (a payment, refund, order, donation) becomes one job
// per connector. A job is safe to run any number of times and in any order:
//
//   1. Queued once. (club, connector, dedupeKey) is unique, so the same event
//      queued twice is one job.
//   2. Run under a lease. A worker claims a job for a few minutes; if it
//      dies, the lease runs out and another worker takes it. A worker whose
//      lease was taken over can't record a result (its attempt number is old).
//   3. Sent once. The handler first looks in the mapping table ("this
//      Luvallplay item is already that external item") and sends the
//      provider the job's own idempotency key, so a retry after a timeout
//      doesn't create a second invoice.
//
// A job that fails is retried with growing waits; after MAX_FAILURES, or
// straight away when a person has to fix something, it sits in the error
// queue until someone presses Replay.
import { dispositionOf, type IntegrationError, type IntegrationErrorCode } from "./errors.ts";

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  /** In the error queue: a person has to fix something first. */
  | "needs_attention"
  /** In the error queue: gave up after too many failures. */
  | "dead"
  /** No longer wanted (the club disconnected, or the item was withdrawn before it synced). */
  | "canceled";

export const ERROR_QUEUE: readonly JobStatus[] = ["needs_attention", "dead"];

export type Job = {
  id: string;
  tenantId: number;
  connector: string;
  /** What to do, e.g. "invoice.push". */
  kind: string;
  /** The Luvallplay item it's about. */
  subjectType: string;
  subjectId: string;
  /** Unique per club and connector. */
  dedupeKey: string;
  /** Only what the handler needs; never tokens. */
  payload: Readonly<Record<string, unknown>>;
  status: JobStatus;
  /** Times a worker has claimed it. Also the lease's number. */
  attempts: number;
  /** Failures that count towards giving up (rate limits and waiting on a connection don't). */
  failures: number;
  /** ms since epoch. */
  runAfter: number;
  leaseUntil: number | null;
  lastErrorCode: IntegrationErrorCode | null;
  /** Already redacted. */
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
};

export type NewJob = Pick<Job, "tenantId" | "connector" | "kind" | "subjectType" | "subjectId" | "payload"> & {
  /**
   * Set when the same item may need the same job again later (a second
   * partial refund): the default key is one job per kind and item.
   */
  dedupeKey?: string;
  /** Don't run before this (ms since epoch). */
  runAfter?: number;
};

export function dedupeKeyFor(job: Pick<NewJob, "kind" | "subjectType" | "subjectId" | "dedupeKey">): string {
  return job.dedupeKey ?? `${job.kind}:${job.subjectType}:${job.subjectId}`;
}

/**
 * The key sent to the provider with a job's writes (Xero's Idempotency-Key,
 * Windcave's X-ID). The same for every attempt of the job, different for
 * every other job, and safe to show: it says nothing about the club.
 */
export function providerIdempotencyKey(job: Pick<Job, "id">, step = ""): string {
  return step ? `lap-${job.id}-${step}` : `lap-${job.id}`;
}

export const MAX_FAILURES = 8;
export const LEASE_MS = 5 * 60_000;

const MINUTE = 60_000;
/** Wait before try n+1 after the nth failure: 1 min, 5, 15, 1 h, 3 h, 8 h, 24 h. About 1.5 days in all. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 480, 1440];

/** Spread retries out so a provider coming back isn't hit by every club at once: up to +20%, fixed per job and attempt. */
function jitter(jobId: string, failures: number): number {
  let h = 2166136261;
  for (const ch of `${jobId}:${failures}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 5000;
}

export function backoffMs(job: Pick<Job, "id">, failures: number): number {
  const base = BACKOFF_MINUTES[Math.min(Math.max(failures, 1), BACKOFF_MINUTES.length) - 1] * MINUTE;
  return Math.round(base * (1 + jitter(job.id, failures)));
}

/** What a finished attempt does to the job. */
export type Transition =
  | { status: "succeeded" }
  | { status: "pending"; runAfter: number; countsAsFailure: boolean; code: IntegrationErrorCode; message: string; pauseConnectionUntil?: number }
  | { status: "needs_attention" | "dead"; code: IntegrationErrorCode; message: string }
  /** The club must reconnect: the job waits, and the connection is marked revoked. */
  | { status: "pending"; runAfter: number; countsAsFailure: false; code: "auth"; message: string; revokeConnection: true };

const DEFAULT_RATE_WAIT_MS = MINUTE;
/** After a revoked connection, look again in an hour (it's skipped anyway until the club reconnects). */
const RECONNECT_RECHECK_MS = 60 * MINUTE;

/** What a failed attempt becomes. `message` must already be redacted. */
export function afterFailure(job: Pick<Job, "id" | "failures">, error: IntegrationError, message: string, now: number): Transition {
  const code = error.code;
  switch (dispositionOf(code)) {
    case "wait": {
      const until = now + Math.max(error.retryAfterMs ?? DEFAULT_RATE_WAIT_MS, 1000);
      // The whole connection stays quiet until then: the limit is per club, not per job.
      return { status: "pending", runAfter: until, countsAsFailure: false, code, message, pauseConnectionUntil: until };
    }
    case "attention":
      return { status: "needs_attention", code, message };
    case "reconnect":
      return { status: "pending", runAfter: now + RECONNECT_RECHECK_MS, countsAsFailure: false, code: "auth", message, revokeConnection: true };
    case "retry": {
      const failures = job.failures + 1;
      if (failures >= MAX_FAILURES) return { status: "dead", code, message };
      return { status: "pending", runAfter: now + backoffMs(job, failures), countsAsFailure: true, code, message };
    }
  }
}

/** May this job be claimed now? */
export function claimable(job: Pick<Job, "status" | "runAfter" | "leaseUntil">, now: number): boolean {
  if (job.status === "pending") return job.runAfter <= now;
  // A worker died mid-job: its lease ran out.
  if (job.status === "running") return job.leaseUntil !== null && job.leaseUntil <= now;
  return false;
}

/** Replay (the error queue's button): only for jobs in the error queue; the failure count starts again. */
export function canReplay(job: Pick<Job, "status">): boolean {
  return ERROR_QUEUE.includes(job.status);
}

export interface JobStore {
  /** Adds the job unless (club, connector, dedupeKey) exists; returns the one that's stored either way. */
  enqueue(job: NewJob, now: number): Promise<{ job: Job; created: boolean }>;
  /**
   * Claims up to `limit` jobs that are due, oldest first, skipping the given
   * connections (paused or not connected). Each claimed job is "running",
   * with attempts + 1 and a lease. Two workers never get the same job.
   */
  claimDue(input: { now: number; limit: number; leaseMs: number; tenantId?: number; skip?: readonly { tenantId: number; connector: string }[] }): Promise<Job[]>;
  /**
   * Records an attempt's result, only if the job is still running under the
   * same attempt number. False means the lease was taken over: drop the result.
   */
  finish(job: Pick<Job, "id" | "tenantId" | "attempts">, transition: Transition, now: number): Promise<boolean>;
  /** Puts a job from the error queue back to pending, failures at zero. False if it wasn't there. */
  replay(job: Pick<Job, "id" | "tenantId">, now: number): Promise<boolean>;
  /** Cancels a club's unfinished jobs for a connector (on disconnect). Returns how many. */
  cancelOpen(tenantId: number, connector: string, now: number): Promise<number>;
  get(tenantId: number, id: string): Promise<Job | null>;
  list(tenantId: number, filter?: { connector?: string; statuses?: readonly JobStatus[] }): Promise<Job[]>;
}

/** One line per attempt (integration_sync_log): what was tried and how it ended. */
export type SyncLogEntry = {
  tenantId: number;
  connector: string;
  jobId: string;
  kind: string;
  attempt: number;
  outcome: "succeeded" | "retry" | "waiting" | "needs_attention" | "dead" | "lease_lost";
  code: IntegrationErrorCode | null;
  /** Already redacted. */
  message: string | null;
  /** Calls made to the provider in this attempt, for metering (§12.1 "Modules and money"). */
  calls: number;
  durationMs: number;
  at: number;
};

export interface SyncLog {
  append(entry: SyncLogEntry): Promise<void>;
}
