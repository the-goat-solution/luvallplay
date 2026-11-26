// Payment references for bank transfers, and matching incoming transfers to
// them (build plan §6.5, §11.4; test plan §3.16 "VietQR reference generation
// and matching").
//
// Pure: no I/O. The caller brings the open payments and the transfers (typed
// in by a treasurer, or from a bank feed) and stores the result.
//
// A reference has to survive a bank: transfer notes come back upper-cased,
// without accents, with the sending bank's own text around them
// ("MBVCB.7654321.LVP00004D2K.CT tu 0011... toi ..."), and sometimes with
// spaces or dots pushed into the middle. So a reference is:
//
//   prefix   2 to 4 letters, the same for every payment ("LVP")
//   body     the payment's number in a 32-character alphabet without the
//            letters people and scanners confuse (I, L, O, U), at least 7 long
//   check    one character, so a mistyped reference isn't mistaken for
//            another payment
//
// Money rule: a transfer is only ever matched automatically when the
// reference is found AND the amount is exactly right AND the payment is
// still open. Everything else goes to a person, with the reason.

import { stripDiacritics } from "./text-fold.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_MIN = 7;
export const DEFAULT_REFERENCE_PREFIX = "LVP";

function checkCharacter(body: string): string {
  // Luhn mod 32: catches every single wrong character and most swaps of two neighbours.
  let factor = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    const addend = factor * ALPHABET.indexOf(body[i]);
    sum += Math.floor(addend / 32) + (addend % 32);
    factor = factor === 2 ? 1 : 2;
  }
  return ALPHABET[(32 - (sum % 32)) % 32];
}

const validPrefix = (prefix: string) => /^[A-Z]{2,4}$/.test(prefix);

/** The reference for payment number `n` (a positive whole number, such as the payment row's id). */
export function makeReference(n: number, prefix: string = DEFAULT_REFERENCE_PREFIX): string {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("A reference needs a positive whole number");
  if (!validPrefix(prefix)) throw new Error("A reference prefix is 2 to 4 capital letters");
  let body = "";
  for (let rest = n; rest > 0; rest = Math.floor(rest / 32)) body = ALPHABET[rest % 32] + body;
  body = body.padStart(BODY_MIN, "0");
  return `${prefix}${body}${checkCharacter(body)}`;
}

/** Letters people type for the look-alike digit. */
const lenient = (text: string) => text.replace(/[IL]/g, "1").replace(/O/g, "0");

/**
 * The payment number in a reference, or null when it isn't one (wrong prefix,
 * wrong shape, or the check character doesn't fit). Forgives case and the
 * look-alikes I, L (read as 1) and O (read as 0).
 */
export function readReference(reference: string, prefix: string = DEFAULT_REFERENCE_PREFIX): number | null {
  const text = reference.trim().toUpperCase();
  if (!validPrefix(prefix) || !text.startsWith(prefix)) return null;
  const rest = lenient(text.slice(prefix.length));
  if (rest.length < BODY_MIN + 1 || rest.length > 14 || [...rest].some((c) => !ALPHABET.includes(c))) return null;
  const body = rest.slice(0, -1);
  if (checkCharacter(body) !== rest.at(-1)) return null;
  let n = 0;
  for (const c of body) n = n * 32 + ALPHABET.indexOf(c);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A transfer note as a bank would hand it back: upper case, no accents. */
const bankText = (text: string) => stripDiacritics(text).toUpperCase();

/**
 * Every well-formed reference written out in a transfer note, in the
 * canonical spelling, each once. Finds references standing as their own word
 * ("…/LVP00004D2K/…"); references a bank has broken up or glued to other
 * text are found by matchTransfer, which knows what it is looking for.
 */
export function findReferences(note: string, prefix: string = DEFAULT_REFERENCE_PREFIX): string[] {
  if (!validPrefix(prefix)) return [];
  const found = new Set<string>();
  const pattern = new RegExp(`(?<![0-9A-Z])${prefix}[0-9A-Z]{${BODY_MIN + 1},14}(?![0-9A-Z])`, "g");
  for (const m of bankText(note).matchAll(pattern)) {
    const n = readReference(m[0], prefix);
    if (n !== null) found.add(makeReference(n, prefix));
  }
  return [...found];
}

// ── Matching ────────────────────────────────────────────────────────────────

/** A payment the club is waiting for (or has already received). */
export type ExpectedPayment = {
  reference: string;
  /** Whole dong. */
  amount: number;
  /** True once a transfer has been matched to it. */
  paid: boolean;
};

/** Money that arrived in the club's account. */
export type IncomingTransfer = {
  /** The bank's own id for the transfer: the key for "have we seen this before". */
  id: string;
  /** Whole dong. */
  amount: number;
  /** The transfer note as the bank shows it. */
  note: string;
};

export type TransferMatch =
  /** Reference found, amount exact, payment open: safe to mark paid. */
  | { kind: "matched"; reference: string }
  /** Reference found but the amount is different. A person decides. `difference` is received minus expected. */
  | { kind: "wrong_amount"; reference: string; expected: number; difference: number }
  /** Reference found, but that payment is already paid: probably paid twice. */
  | { kind: "already_paid"; reference: string }
  /** The note names more than one open payment. */
  | { kind: "ambiguous"; references: string[] }
  /** A well-formed reference that isn't one of this club's payments. */
  | { kind: "unknown_reference"; reference: string }
  /** No reference. `sameAmount` lists open payments of exactly this amount, as a hint for the person matching by hand; never matched automatically. */
  | { kind: "no_reference"; sameAmount: string[] };

/** One transfer against the club's payments. Changes nothing: the caller records the outcome. */
export function matchTransfer(transfer: IncomingTransfer, expected: readonly ExpectedPayment[], prefix: string = DEFAULT_REFERENCE_PREFIX): TransferMatch {
  const note = bankText(transfer.note);
  // Banks sometimes push spaces or dots into a long word, or glue the note to their own text.
  const squeezed = note.replace(/[^0-9A-Z]/g, "");
  const written = new Set(findReferences(note, prefix));

  const named = expected.filter((p) => written.has(p.reference) || squeezed.includes(p.reference));
  if (named.length === 0) {
    const unknown = [...written][0];
    if (unknown) return { kind: "unknown_reference", reference: unknown };
    return { kind: "no_reference", sameAmount: expected.filter((p) => !p.paid && p.amount === transfer.amount).map((p) => p.reference) };
  }
  if (named.length > 1) return { kind: "ambiguous", references: named.map((p) => p.reference) };

  const payment = named[0];
  if (payment.paid) return { kind: "already_paid", reference: payment.reference };
  if (payment.amount !== transfer.amount) return { kind: "wrong_amount", reference: payment.reference, expected: payment.amount, difference: transfer.amount - payment.amount };
  return { kind: "matched", reference: payment.reference };
}

export type TransferOutcome = { transfer: IncomingTransfer; match: TransferMatch | { kind: "duplicate_transfer" } };

/**
 * A batch of transfers, in the order given. Safe to run again on the same
 * batch or an overlapping one:
 *   - a transfer id seen before (in `alreadyProcessed` or earlier in the
 *     batch) is reported as a duplicate and never pays anything twice;
 *   - once a transfer has paid a payment, a second transfer for the same
 *     reference is "already_paid", so two transfers can't both settle it.
 */
export function matchTransfers(
  transfers: readonly IncomingTransfer[],
  expected: readonly ExpectedPayment[],
  options: { prefix?: string; alreadyProcessed?: ReadonlySet<string> } = {},
): TransferOutcome[] {
  const seen = new Set(options.alreadyProcessed ?? []);
  const state = expected.map((p) => ({ ...p }));
  return transfers.map((transfer) => {
    if (seen.has(transfer.id)) return { transfer, match: { kind: "duplicate_transfer" as const } };
    seen.add(transfer.id);
    const match = matchTransfer(transfer, state, options.prefix);
    if (match.kind === "matched") state.find((p) => p.reference === match.reference)!.paid = true;
    return { transfer, match };
  });
}
