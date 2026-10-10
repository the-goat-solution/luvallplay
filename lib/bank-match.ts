// Smart bank reconciliation — the scoring brain, kept free of the database
// so it can be unit-tested.
//
// Modelled on how Xero / QuickBooks bank feeds work, sized for a small club:
//
// 1. Candidate matching (Xero "suggested match" / QBO "match found").
//    For each unreconciled bank line, unlinked ledger entries are scored on
//      - amount  — must be exact (to the cent) to count as a match at all;
//      - date    — closer is better, fading to nothing over 14 days;
//      - words   — overlap between the bank description/reference and the
//                  entry's name/person/notes ("PIONEER STADIUM" ↔ "Court
//                  hire — Pioneer Stadium").
// 2. Many-to-one (Xero "Find & Match").  When no single entry has the
//    amount, a bounded subset-sum search looks for 2–5 nearby entries that
//    add up to it exactly (e.g. one bank transfer paying two invoices).
// 3. Bank rules (Xero bank rules / QBO "memorised" transactions).  Each
//    time the treasurer records or classifies a bank line, the payee is
//    remembered; the next line from that payee gets the same treatment
//    suggested — or applied automatically, if the treasurer switched that
//    rule to automatic.
//
// Only a clear single match is ever applied without a human: the exact
// amount, within 10 days, and well ahead of any other candidate.
// Everything else is a one-click suggestion that shows its reasons.

export type MatchLine = {
  id: number;
  date: string;
  description: string;
  reference: string | null;
  amountCents: number; // signed: + in, − out
};

export type MatchEntry = {
  id: number;
  date: string;
  name: string;
  person: string | null;
  notes: string | null;
  signedCents: number; // + received, − spent
};

export type MatchRule = {
  id: number;
  pattern: string;
  direction: "in" | "out";
  action: "create" | "classify";
  status: string | null;
  category: string | null;
  name: string | null;
  method: string | null;
  person: string | null;
  auto: boolean;
  hits: number;
};

export type Suggestion =
  | {
      kind: "entries";
      entryIds: number[];
      score: number; // 0–1
      reasons: string[];
      auto: boolean; // safe to apply without asking
    }
  | { kind: "rule"; rule: MatchRule; reasons: string[]; auto: boolean };

export const AUTO_MATCH_DAYS = 10;
const DATE_FADE_DAYS = 14;
const COMBO_WINDOW_DAYS = 10;
const COMBO_MAX_SIZE = 5;
const COMBO_MAX_CANDIDATES = 18;
const COMBO_MAX_STEPS = 20_000;
// How far ahead of the runner-up a single match must be to auto-apply.
const AUTO_MARGIN = 0.15;

// ── Text ──────────────────────────────────────────────────────────────────

// Words that carry no identity on a bank statement line.
const NOISE = new Set([
  "pos", "eftpos", "visa", "debit", "credit", "card", "payment", "pay", "bill",
  "billpay", "ap", "dc", "dd", "ft", "tfr", "transfer", "to", "from", "the", "and",
  "of", "for", "nz", "nzl", "nzd", "ltd", "limited", "inc", "co", "online",
  "purchase", "deposit", "withdrawal", "direct", "automatic", "ref", "reference",
  "particulars", "code", "anz", "bank", "acc", "account", "a", "an", "at", "on",
  "in", "via",
]);

export function tokens(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    // Drop numbers (card digits, dates, invoice numbers change each time)
    // and anything too short to mean much.
    .filter((t) => t.length >= 3 && !/\d/.test(t) && !NOISE.has(t));
}

// 0–1: how much of the smaller word set appears in the other. "Pioneer
// Stadium" vs "Court hire — Pioneer Stadium, October" scores 1.
export function textSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let common = 0;
  for (const t of A) {
    if (B.has(t)) common++;
    // Prefix match catches truncated statement text ("STADIU" / "stadium").
    else if (t.length >= 5 && [...B].some((u) => u.length >= 5 && (u.startsWith(t) || t.startsWith(u)))) {
      common += 0.8;
    }
  }
  return Math.min(1, common / Math.min(A.size, B.size));
}

// The payee "fingerprint" a bank rule is keyed on: the identifying words of
// the description, in order, numbers and noise stripped, max 4 words.
// "EFTPOS PIONEER STADIUM 4471 CHCH" → "pioneer stadium chch".
export function payeeKey(description: string): string {
  return tokens(description).slice(0, 4).join(" ");
}

function dayGap(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

function dateScore(gap: number): number {
  return Math.max(0, 1 - gap / DATE_FADE_DAYS);
}

const lineWords = (l: MatchLine) => tokens(`${l.description} ${l.reference ?? ""}`);
const entryWords = (e: MatchEntry) => tokens(`${e.name} ${e.person ?? ""} ${e.notes ?? ""}`);

// ── Single-entry scoring ──────────────────────────────────────────────────

export function scoreEntry(line: MatchLine, entry: MatchEntry): { score: number; reasons: string[]; gap: number } {
  const gap = dayGap(line.date, entry.date);
  const text = textSimilarity(lineWords(line), entryWords(entry));
  const exact = entry.signedCents === line.amountCents;
  const score = (exact ? 0.5 : 0) + 0.3 * dateScore(gap) + 0.2 * text;
  const reasons: string[] = [];
  if (exact) reasons.push("same amount");
  reasons.push(gap === 0 ? "same day" : `${gap} day${gap === 1 ? "" : "s"} apart`);
  if (text >= 0.5) reasons.push("description matches");
  return { score, reasons, gap };
}

// ── Many-to-one: entries that add up to the bank amount ───────────────────

// Bounded depth-first subset-sum over the nearest candidates. Small clubs
// have a handful of open entries in any 10-day window, so this is cheap;
// the step cap keeps a pathological month from ever being slow.
export function findCombination(target: number, entries: MatchEntry[]): MatchEntry[][] {
  const pool = entries.slice(0, COMBO_MAX_CANDIDATES);
  const found: MatchEntry[][] = [];
  let steps = 0;
  const pick: MatchEntry[] = [];

  function walk(start: number, sum: number) {
    if (found.length >= 3 || ++steps > COMBO_MAX_STEPS) return;
    if (pick.length >= 2 && sum === target) {
      found.push([...pick]);
      return;
    }
    if (pick.length >= COMBO_MAX_SIZE) return;
    for (let i = start; i < pool.length; i++) {
      pick.push(pool[i]);
      walk(i + 1, sum + pool[i].signedCents);
      pick.pop();
    }
  }
  walk(0, 0);
  return found;
}

// ── Putting it together ───────────────────────────────────────────────────

// Best suggestion for one bank line, or null. `entries` must already be
// limited to unlinked ledger entries that could plausibly be in the bank
// (not Stripe, not cash). Order matters: anything already in the ledger —
// one exact entry, or several adding up exactly — outranks a bank rule, so
// a rule (even an automatic one) never records a payment twice.
export function suggestForLine(
  line: MatchLine,
  entries: MatchEntry[],
  rules: MatchRule[],
): Suggestion | null {
  const direction = line.amountCents > 0 ? "in" : "out";
  const key = payeeKey(line.description);
  const rule = key ? rules.find((r) => r.pattern === key && r.direction === direction) : undefined;

  // Single exact-amount candidates, best first.
  const singles = entries
    .filter((e) => e.signedCents === line.amountCents)
    .map((e) => ({ e, ...scoreEntry(line, e) }))
    .sort((a, b) => b.score - a.score || a.gap - b.gap || a.e.id - b.e.id);

  if (singles.length > 0) {
    const [best, second] = singles;
    const clearLead = !second || best.score - second.score >= AUTO_MARGIN;
    return {
      kind: "entries",
      entryIds: [best.e.id],
      score: best.score,
      reasons: second && !clearLead ? [...best.reasons, `${singles.length} similar entries`] : best.reasons,
      auto: best.gap <= AUTO_MATCH_DAYS && clearLead,
    };
  }

  // Several entries adding up to the line. Only same-direction entries in a
  // short window — a combo mixing money in and out is too speculative to
  // suggest (the treasurer can still build one by hand).
  const near = entries
    .filter(
      (e) =>
        Math.sign(e.signedCents) === Math.sign(line.amountCents) &&
        Math.abs(e.signedCents) < Math.abs(line.amountCents) &&
        dayGap(line.date, e.date) <= COMBO_WINDOW_DAYS,
    )
    .sort((a, b) => dayGap(line.date, a.date) - dayGap(line.date, b.date));
  const combos = findCombination(line.amountCents, near);
  if (combos.length > 0) {
    const scored = combos
      .map((c) => {
        const avgDate = c.reduce((t, e) => t + dateScore(dayGap(line.date, e.date)), 0) / c.length;
        const text = textSimilarity(lineWords(line), c.flatMap(entryWords));
        return { c, score: 0.45 + 0.3 * avgDate + 0.2 * text - 0.03 * (c.length - 2) };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    return {
      kind: "entries",
      entryIds: best.c.map((e) => e.id),
      score: best.score,
      reasons: [
        `${best.c.length} entries add up to this amount`,
        ...(combos.length > 1 ? ["other combinations also fit"] : []),
      ],
      // Never automatic: a combination is a guess worth a glance.
      auto: false,
    };
  }

  if (rule) {
    return {
      kind: "rule",
      rule,
      reasons: [`seen ${rule.hits}× before from this payee`],
      auto: rule.auto,
    };
  }

  return null;
}
