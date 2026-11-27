// Reports: the reasons a person can pick, which are serious, and how soon a
// moderator must act. Pure: no I/O.

export const REPORT_REASONS = ["spam", "harassment", "hate", "sexual", "violence", "self_harm", "child_safety", "scam", "prohibited_item", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportSeverity = "normal" | "serious";

/** What a report can be about. `listing` and `question` are the Marketplace's. */
export const TARGET_TYPES = ["profile", "post", "comment", "listing", "question"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/** Serious reports go to the platform queue and are due sooner. */
const SERIOUS: readonly ReportReason[] = ["child_safety", "sexual", "self_harm", "violence", "hate"];

const HOUR = 60 * 60 * 1000;
/** Hours a moderator has. 24 is Apple 1.2's limit; serious ones get half. */
export const REPORT_DUE_HOURS = { serious: 12, normal: 24 } as const satisfies Record<ReportSeverity, number>;

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value);
}

export function severityOf(reason: ReportReason): ReportSeverity {
  return SERIOUS.includes(reason) ? "serious" : "normal";
}

/** When a report filed at `createdAt` must have been handled. */
export function dueBy(createdAt: Date, severity: ReportSeverity): Date {
  return new Date(createdAt.getTime() + REPORT_DUE_HOURS[severity] * HOUR);
}
