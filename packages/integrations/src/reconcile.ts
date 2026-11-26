// The daily reconciliation report (build plan §12.1, §12.3; test plan §3.19
// "Totals: the daily reconciliation report matches to the cent").
//
// Luvallplay's totals for a day (or any range) are compared with the
// provider's, line by line. Money is whole minor units and never rounded
// here, so "matches" means exactly equal.

export type TotalLine = {
  /** What's being compared, the same on both sides: "sales:memberships", "fees", "refunds", "clearing". */
  key: string;
  /** ISO 4217, upper case. */
  currency: string;
  /** Minor units; negative for money out. */
  amount: number;
  /** How many items make it up. */
  count: number;
};

export type ReconciliationRow = {
  key: string;
  currency: string;
  local: { amount: number; count: number } | null;
  external: { amount: number; count: number } | null;
  /** external − local, minor units. */
  difference: number;
  status: "match" | "amount_differs" | "count_differs" | "missing_external" | "missing_local";
};

export type ReconciliationReport = {
  tenantId: number;
  connector: string;
  /** The range compared, ms since epoch, [from, to). */
  from: number;
  to: number;
  rows: ReconciliationRow[];
  balanced: boolean;
  /** Jobs for the range that haven't synced yet: a difference with open jobs is "still syncing", not an error. */
  openJobs: number;
  generatedAt: number;
};

function sum(lines: readonly TotalLine[]): Map<string, TotalLine> {
  const out = new Map<string, TotalLine>();
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amount) || !Number.isSafeInteger(l.count)) throw new Error(`reconciliation line ${l.key} isn't whole minor units`);
    const id = `${l.currency.toUpperCase()} ${l.key}`;
    const prev = out.get(id);
    out.set(id, { key: l.key, currency: l.currency.toUpperCase(), amount: (prev?.amount ?? 0) + l.amount, count: (prev?.count ?? 0) + l.count });
  }
  return out;
}

export function reconcile(input: { tenantId: number; connector: string; from: number; to: number; local: readonly TotalLine[]; external: readonly TotalLine[]; openJobs?: number; now: number }): ReconciliationReport {
  const local = sum(input.local);
  const external = sum(input.external);
  const rows: ReconciliationRow[] = [];
  for (const id of [...new Set([...local.keys(), ...external.keys()])].sort()) {
    const l = local.get(id) ?? null;
    const e = external.get(id) ?? null;
    const difference = (e?.amount ?? 0) - (l?.amount ?? 0);
    const status: ReconciliationRow["status"] = !e ? "missing_external" : !l ? "missing_local" : difference !== 0 ? "amount_differs" : l.count !== e.count ? "count_differs" : "match";
    rows.push({ key: (l ?? e)!.key, currency: (l ?? e)!.currency, local: l && { amount: l.amount, count: l.count }, external: e && { amount: e.amount, count: e.count }, difference, status });
  }
  return { tenantId: input.tenantId, connector: input.connector, from: input.from, to: input.to, rows, balanced: rows.every((r) => r.status === "match"), openJobs: input.openJobs ?? 0, generatedAt: input.now };
}

/**
 * The clearing account should net to zero once a payout has settled (§12.3):
 * payments in, less fees, refunds and the payout itself. A leftover points to
 * a missing fee, refund or timing item.
 */
export function clearingBalance(entries: readonly { amount: number }[]): number {
  return entries.reduce((total, e) => total + e.amount, 0);
}

export interface ReconciliationStore {
  save(report: ReconciliationReport): Promise<void>;
  latest(tenantId: number, connector: string): Promise<ReconciliationReport | null>;
}
