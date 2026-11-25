// The runner: claims due jobs and runs each connector's handler (build plan
// §12.1 "Sync engine"). Called by a cron every few minutes, and straight
// after an event is queued. Everything it touches is passed in.
import { IntegrationError, redact, toIntegrationError } from "./errors.ts";
import { afterFailure, LEASE_MS, providerIdempotencyKey, type Job, type JobStore, type SyncLog, type SyncLogEntry } from "./jobs.ts";
import type { MappingStore } from "./mappings.ts";
import type { Connection, ConnectionStore } from "./tokens.ts";

export type JobContext = {
  job: Job;
  connection: Connection;
  mappings: MappingStore;
  /** Send with every write of this job; the same on every attempt. */
  idempotencyKey: (step?: string) => string;
  /** Count a call to the provider (metering and the per-run budget). */
  countCall: (n?: number) => void;
  now: () => number;
};

/** Does the job's work. Throws IntegrationError to say what went wrong; returning means it's done. */
export type JobHandler = (ctx: JobContext) => Promise<void>;

export type RunnerDeps = {
  jobs: JobStore;
  connections: ConnectionStore;
  mappings: MappingStore;
  log: SyncLog;
  /** connector id → job kind → handler. */
  handlers: Readonly<Record<string, Readonly<Record<string, JobHandler>>>>;
  /** The entitlement check (can(club, module)); false stops the sync without deleting anything (test plan §3.19). */
  entitled: (tenantId: number, connector: string) => Promise<boolean>;
  /** Metering: calls made for a club (§12.1 "Modules and money"). Must not throw. */
  meter?: (tenantId: number, connector: string, calls: number) => Promise<void>;
  now: () => number;
  /** Extra strings to scrub from anything stored (the framework can't know every secret). */
  secrets?: () => readonly string[];
};

export type RunSummary = { claimed: number; succeeded: number; retried: number; waiting: number; needsAttention: number; dead: number; leaseLost: number };

/**
 * Runs up to `limit` due jobs, one at a time.
 *
 * One at a time on purpose: jobs for one club often depend on each other (a
 * payment needs its invoice), and providers cap concurrent calls per club
 * (Xero: 5). Throughput comes from running the cron often, and per region.
 */
export async function runDueJobs(deps: RunnerDeps, options: { limit?: number; tenantId?: number; leaseMs?: number } = {}): Promise<RunSummary> {
  const summary: RunSummary = { claimed: 0, succeeded: 0, retried: 0, waiting: 0, needsAttention: 0, dead: 0, leaseLost: 0 };
  const limit = options.limit ?? 25;
  // Connections found paused or not connected during this run: their jobs are left unclaimed from then on.
  const skip: { tenantId: number; connector: string }[] = [];

  while (summary.claimed < limit) {
    const [job] = await deps.jobs.claimDue({ now: deps.now(), limit: 1, leaseMs: options.leaseMs ?? LEASE_MS, tenantId: options.tenantId, skip });
    if (!job) break;
    summary.claimed++;
    const outcome = await runOne(deps, job, skip);
    if (outcome === "succeeded") summary.succeeded++;
    else if (outcome === "retry") summary.retried++;
    else if (outcome === "waiting") summary.waiting++;
    else if (outcome === "needs_attention") summary.needsAttention++;
    else if (outcome === "dead") summary.dead++;
    else summary.leaseLost++;
  }
  return summary;
}

async function runOne(deps: RunnerDeps, job: Job, skip: { tenantId: number; connector: string }[]): Promise<SyncLogEntry["outcome"]> {
  const started = deps.now();
  let calls = 0;
  let error: IntegrationError | null = null;
  let connection: Connection | null = null;
  const scrub = (text: string) => redact(text, deps.secrets?.() ?? []);

  try {
    const handler = deps.handlers[job.connector]?.[job.kind];
    if (!handler) throw new IntegrationError("validation", `Nothing handles "${job.kind}" for ${job.connector}.`);
    if (!(await deps.entitled(job.tenantId, job.connector))) throw new IntegrationError("not_entitled", `The club's plan doesn't include ${job.connector}.`);
    connection = await deps.connections.get(job.tenantId, job.connector);
    if (!connection || connection.status === "disconnected") throw new IntegrationError("auth", `${job.connector} isn't connected.`);
    if (connection.status === "revoked") throw new IntegrationError("auth", `${job.connector} needs reconnecting.`);
    if (connection.pausedUntil !== null && connection.pausedUntil > started) {
      throw new IntegrationError("rate_limited", `${job.connector} asked us to wait.`, { retryAfterMs: connection.pausedUntil - started });
    }
    await handler({
      job,
      connection,
      mappings: deps.mappings,
      idempotencyKey: (step) => providerIdempotencyKey(job, step),
      countCall: (n = 1) => {
        calls += n;
      },
      now: deps.now,
    });
  } catch (err) {
    error = toIntegrationError(err);
  }

  const now = deps.now();
  const message = error ? scrub(error.message) : null;
  const transition = error ? afterFailure(job, error, message!, now) : ({ status: "succeeded" } as const);
  const recorded = await deps.jobs.finish(job, transition, now);

  let outcome: SyncLogEntry["outcome"];
  if (!recorded) outcome = "lease_lost";
  else if (transition.status === "succeeded") outcome = "succeeded";
  else if (transition.status === "pending") outcome = transition.countsAsFailure ? "retry" : "waiting";
  else outcome = transition.status;

  if (recorded && transition.status === "pending") {
    // The whole connection waits, not only this job: leave its other jobs unclaimed for the rest of the run.
    if ("pauseConnectionUntil" in transition && transition.pauseConnectionUntil !== undefined) {
      if (connection) await deps.connections.pauseUntil(connection, transition.pauseConnectionUntil, now);
      skip.push({ tenantId: job.tenantId, connector: job.connector });
    }
    if ("revokeConnection" in transition) {
      if (connection && connection.status === "connected") await deps.connections.setStatus(connection, "revoked", message, now);
      skip.push({ tenantId: job.tenantId, connector: job.connector });
    }
  }

  await deps.log.append({ tenantId: job.tenantId, connector: job.connector, jobId: job.id, kind: job.kind, attempt: job.attempts, outcome, code: error?.code ?? null, message, calls, durationMs: now - started, at: now });
  if (calls > 0 && deps.meter) await deps.meter(job.tenantId, job.connector, calls).catch(() => {});
  return outcome;
}
