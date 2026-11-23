// Scheduled jobs behind one interface (build plan §6.9; Phase 3 step 6).
//
// A job is a route that a scheduler calls with a secret. Which scheduler is
// the region's business:
//
//   Sydney (Vercel)      vercel.json "crons": Vercel Cron calls the path and
//                        sends "Authorization: Bearer $CRON_SECRET".
//   Hanoi (Kubernetes)   CronJobs that curl the same paths with the same
//                        header: scripts/cron/k8s.mjs prints the manifests.
//
// This list is the source of truth. tests/cron.test.ts fails when
// vercel.json, the route files, the module ownership table and this list
// disagree, so a job can't exist for one scheduler and not the other.

export type CronJob = {
  /** Stable name: the Kubernetes CronJob's name. */
  id: string;
  /** The route the scheduler calls (GET). */
  path: string;
  /** Five-field cron expression, UTC. */
  schedule: string;
  /** What it does, for the manifest and the runbook. */
  purpose: string;
};

export const CRON_JOBS: readonly CronJob[] = [
  { id: "sync-calendar", path: "/api/cron/sync-calendar", schedule: "0 2 * * *", purpose: "Play days from the club's calendar" },
  { id: "send-roster", path: "/api/cron/send-roster", schedule: "0 3 * * *", purpose: "Today's roster email, and the daily shadow-read record" },
  { id: "sync-finance", path: "/api/cron/sync-finance", schedule: "0 13 * * *", purpose: "Payments into the ledger" },
  { id: "headcount-alerts", path: "/api/cron/headcount-alerts", schedule: "0 18 * * *", purpose: "Low or full headcount alerts" },
  { id: "membership-reminders", path: "/api/cron/membership-reminders", schedule: "0 19 * * *", purpose: "Play-day and renewal reminders" },
];

/**
 * Whether the request comes from the scheduler: "Authorization: Bearer
 * <CRON_SECRET>". With no secret set, nothing is authorised in production;
 * outside production an unset secret lets a developer call the job by hand.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
