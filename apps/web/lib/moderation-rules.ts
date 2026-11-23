// SafeSearch decision rule, kept free of imports so it can be unit-tested.
// adult / violence / racy LIKELY or VERY_LIKELY → rejected; any POSSIBLE →
// needs_review; otherwise approved.

export type ModerationStatus = "approved" | "needs_review" | "rejected";

const LIKELIHOOD = ["UNKNOWN", "VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"] as const;
type Likelihood = (typeof LIKELIHOOD)[number];

function level(v: string | undefined): number {
  const i = LIKELIHOOD.indexOf((v ?? "UNKNOWN") as Likelihood);
  return i === -1 ? 0 : i;
}

export function decide(annotation: Record<string, string>): ModerationStatus {
  const watched = ["adult", "violence", "racy"].map((k) => level(annotation[k]));
  if (watched.some((l) => l >= level("LIKELY"))) return "rejected";
  if (watched.some((l) => l >= level("POSSIBLE"))) return "needs_review";
  return "approved";
}
