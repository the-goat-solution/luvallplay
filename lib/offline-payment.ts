// Offline payments: money an admin collects outside the online checkout —
// cash at a session, or a bank transfer straight into the club account.
//
// Both are recorded in Stripe as an invoice "paid out of band", so Stripe
// stays the single list of who paid for what. The booking / membership row
// points back at that invoice through its payment reference, whose prefix
// also says how the money moved:
//
//   cash-invoice-<invoice id>      cash
//   transfer-invoice-<invoice id>  bank transfer
//
// The invoice's metadata.source carries the same method ("cash" /
// "bank_transfer"), which is how the finance ledger knows whether to expect
// the money on the bank statement line by line (transfer) or inside a cash
// deposit (cash). Pure helpers only — safe to import from client code.

export type OfflineMethod = "cash" | "bank_transfer";
export type PaymentMethod = "card" | OfflineMethod;

const PREFIX: Record<OfflineMethod, string> = {
  cash: "cash-invoice-",
  bank_transfer: "transfer-invoice-",
};

export const OFFLINE_METHOD_LABEL: Record<OfflineMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "Card",
  ...OFFLINE_METHOD_LABEL,
};

export function parseOfflineMethod(value: unknown): OfflineMethod {
  return value === "bank_transfer" ? "bank_transfer" : "cash";
}

/** The invoice metadata.source value → method, or null for anything else. */
export function offlineMethodFromSource(source: string | null | undefined): OfflineMethod | null {
  return source === "cash" || source === "bank_transfer" ? source : null;
}

export function offlinePaymentRef(method: OfflineMethod, invoiceId: string): string {
  return `${PREFIX[method]}${invoiceId}`;
}

export function paymentMethodFromRef(ref: string | null | undefined): PaymentMethod {
  if (ref?.startsWith(PREFIX.cash)) return "cash";
  if (ref?.startsWith(PREFIX.bank_transfer)) return "bank_transfer";
  return "card";
}

/** The Stripe invoice id behind an offline payment reference, or null. */
export function offlineInvoiceIdFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  for (const prefix of Object.values(PREFIX)) {
    if (ref.startsWith(prefix)) return ref.slice(prefix.length) || null;
  }
  return null;
}
