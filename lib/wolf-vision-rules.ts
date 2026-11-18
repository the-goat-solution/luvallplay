// Wolf Vision refund rules, kept free of database and Stripe imports so they
// can be tested with node --test. Used by lib/wolf-vision-db.ts.

/** How many automatic refunds a player can get in 30 days before an admin reviews the next one. */
export const AUTO_REFUNDS_PER_30_DAYS = 3;

/** Failures the app reports that are ours, not the player's. */
export const TECHNICAL_FAILURES = ["camera_failed", "model_failed", "engine_crashed", "tracking_lost", "quality_collapsed", "video_unreadable", "dropped"] as const;
export type TechnicalFailure = (typeof TECHNICAL_FAILURES)[number];

/**
 * Decides whether a failed paid session is refunded automatically: a
 * technical reason, a real payment not refunded yet, and fewer than
 * AUTO_REFUNDS_PER_30_DAYS automatic refunds for this player in the last 30
 * days (past that, an admin reviews it). Pure, for tests.
 */
export function refundDecision(input: { pricePaid: number; alreadyRefunded: boolean; reason: string; recentAutoRefunds: number }): "refund" | "review" | "none" {
  if (input.pricePaid <= 0 || input.alreadyRefunded) return "none";
  if (!(TECHNICAL_FAILURES as readonly string[]).includes(input.reason)) return "none";
  return input.recentAutoRefunds < AUTO_REFUNDS_PER_30_DAYS ? "refund" : "review";
}

/**
 * Quality-based failure for a finished session: if the capture quality was
 * too low for the numbers to mean much, or no player could be tracked, the
 * session counts as a technical failure (and a paid one is refunded).
 */
export function finishedSessionFailure(input: { quality: number; trackedPlayers: number; duration: number; hits: number }): TechnicalFailure | null {
  if (input.duration >= 60 && input.trackedPlayers === 0) return "tracking_lost";
  if (input.duration >= 60 && input.quality < 0.3) return "quality_collapsed";
  if (input.duration >= 120 && input.hits === 0) return "tracking_lost";
  return null;
}

