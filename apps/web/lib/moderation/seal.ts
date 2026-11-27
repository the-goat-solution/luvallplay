// Sealing what a report holds in words (shared by Social and the Marketplace).
//
// Two things are sealed, both with MODERATION_KEKS and each bound to its own
// report, so one report's text can't be opened as another's and neither kind
// can be opened as the other, even by copying the database row:
//
//   content_reports.details_sealed   what the reporter wrote, bound to
//                                    ["report", reportId];
//   moderation_evidence.sealed       a copy of the content of a child-safety
//                                    report, bound to ["evidence", reportId].
//
// MODERATION_KEKS holds the keys ("id:base64key[,id:base64key…]", 32 bytes
// each, newest first), a secret of the deployment with keys of its own. With
// no key nothing is sealed and nothing is stored in its place: the caller
// asks `available()` first. A MALFORMED list throws, here and in
// `available()`: a bad paste must never quietly become "no encryption".
//
// The envelope is @luvallplay/crypto. Both columns are listed in
// lib/crypto-purposes.ts, so a key rotation re-seals them.
import { createSeal, parseKeks, type Binding } from "@luvallplay/crypto";

type Env = Record<string, string | undefined>;

export type ModerationSeal = {
  /** Whether anything can be sealed here: MODERATION_KEKS holds a key. Throws when the list is malformed. */
  available(): boolean;
  /** A reporter's words, for this report. Throws SealError with no key. */
  seal(reportId: number, text: string): string;
  /** Opens a report's details. Throws SealError for another report's text, changed text, or a key that isn't listed. */
  open(reportId: number, sealed: string): string;
  /** A copy of reported content, for this report. */
  sealEvidence(reportId: number, text: string): string;
  openEvidence(reportId: number, sealed: string): string;
};

/** What a report's details are bound to. lib/crypto-purposes.ts re-seals with the same. */
export const reportBinding = (reportId: number): Binding => ["report", reportId];
/** What a report's evidence is bound to. */
export const evidenceBinding = (reportId: number): Binding => ["evidence", reportId];

/** The deployment's seal, from MODERATION_KEKS. */
export function moderationSeal(env: Env = process.env): ModerationSeal {
  const keks = () => parseKeks(env.MODERATION_KEKS, "MODERATION_KEKS");
  const envelope = createSeal({ purpose: "MODERATION_KEKS", keks });
  return {
    available: () => keks().length > 0,
    seal: (reportId, text) => envelope.seal(reportBinding(reportId), text),
    open: (reportId, sealed) => envelope.open(reportBinding(reportId), sealed),
    sealEvidence: (reportId, text) => envelope.seal(evidenceBinding(reportId), text),
    openEvidence: (reportId, sealed) => envelope.open(evidenceBinding(reportId), sealed),
  };
}
