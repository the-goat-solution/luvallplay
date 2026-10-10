"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { FINANCE_CATEGORIES, formatCents, formatDateKey, methodLabel } from "@/lib/finance";
import styles from "./financials.module.css";

export type MatchCandidate = {
  id: number;
  name: string;
  date: string;
  signedCents: number;
  exact: boolean;
  method: string | null;
};

// "Match several…" for one bank line (Xero's Find & Match): tick any
// unlinked ledger entries; the running total must land exactly on the bank
// amount. If it doesn't — a transfer net of a bank fee, a payment that
// rounded differently — the gap can be booked as its own entry so the
// match still balances to the cent. The server re-checks all of it.
export function MatchManyPanel({
  bankTxnId,
  bankAmountCents,
  description,
  candidates,
  preselected,
  action,
}: {
  bankTxnId: number;
  bankAmountCents: number;
  description: string;
  candidates: MatchCandidate[];
  preselected: number[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(preselected));
  const [query, setQuery] = useState("");
  const [bookDifference, setBookDifference] = useState(false);

  const total = useMemo(
    () => candidates.filter((c) => picked.has(c.id)).reduce((t, c) => t + c.signedCents, 0),
    [candidates, picked],
  );
  const difference = bankAmountCents - total;
  const balanced = difference === 0;
  const diffKind = difference > 0 ? "received" : "spent";
  const diffCategories = FINANCE_CATEGORIES.filter((c) => c.kind === diffKind);
  const canSubmit = picked.size > 0 && (balanced || bookDifference);

  const visible = query.trim()
    ? candidates.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : candidates;

  if (!open) {
    return (
      <button type="button" className={styles.actionLink} onClick={() => setOpen(true)}>
        Match several…
      </button>
    );
  }

  return (
    <form action={action} className={styles.matchPanel}>
      <input type="hidden" name="id" value={bankTxnId} />
      {[...picked].map((id) => (
        <input key={id} type="hidden" name="entryId" value={id} />
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong>Match this bank line to several entries</strong>
        <button type="button" className={styles.actionLink} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {candidates.length > 0 && !candidates.some((c) => Math.sign(c.signedCents) === Math.sign(bankAmountCents)) ? (
        <p style={{ margin: "8px 0 0", color: "#b54708" }}>
          Nothing {bankAmountCents < 0 ? "spent" : "received"} in the ledger near this date. If this payment isn&apos;t
          recorded yet, close this and use “Record as new {bankAmountCents < 0 ? "expense" : "income"}”.
        </p>
      ) : null}

      {candidates.length > 6 ? (
        <input
          type="search"
          className={styles.input}
          style={{ width: "100%", marginTop: 8, boxSizing: "border-box" }}
          placeholder="Filter entries…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}

      <div className={styles.matchList}>
        {visible.length === 0 ? (
          <div style={{ padding: 10, color: "#6b7280" }}>
            No unmatched ledger entries within 4 months of this line — use “Record as new” instead.
          </div>
        ) : (
          visible.map((c) => (
            <label key={c.id} className={styles.matchItem}>
              <input
                type="checkbox"
                checked={picked.has(c.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setPicked(next);
                }}
              />
              <span className={styles.num}>{formatDateKey(c.date)}</span>
              <span>
                {c.name}
                {c.method ? <span className={styles.method}>{methodLabel(c.method)}</span> : null}
              </span>
              <span className={`${styles.num} ${c.signedCents < 0 ? styles.amountOut : styles.amountIn}`}>
                {formatCents(c.signedCents, { signed: true })}
              </span>
            </label>
          ))
        )}
      </div>

      <div className={styles.matchTotals}>
        <span>Bank line {formatCents(bankAmountCents, { signed: true })}</span>
        <span>
          Selected {formatCents(total, { signed: true })} ({picked.size})
        </span>
        <span className={balanced ? styles.balanced : styles.unbalanced}>
          {balanced ? "✓ Balances" : `Difference ${formatCents(difference, { signed: true })}`}
        </span>
      </div>

      {!balanced && picked.size > 0 ? (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              name="adjust"
              value="1"
              checked={bookDifference}
              onChange={(e) => setBookDifference(e.target.checked)}
            />
            Record the {formatCents(Math.abs(difference))} difference as money {diffKind}:
          </label>
          <select
            name="adjustCategory"
            className={styles.select}
            defaultValue={diffKind === "spent" ? "bank_fees" : "other_income"}
            disabled={!bookDifference}
            key={diffKind}
          >
            {diffCategories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            name="adjustName"
            className={styles.input}
            style={{ minWidth: 220 }}
            defaultValue={`Difference — ${description}`.slice(0, 200)}
            disabled={!bookDifference}
          />
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <SubmitButton loadingText="Matching…" className={styles.buttonPrimary} disabled={!canSubmit}>
          Match {picked.size} entr{picked.size === 1 ? "y" : "ies"}
        </SubmitButton>
      </div>
    </form>
  );
}
