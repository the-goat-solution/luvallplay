import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { upsertStripeLines } from "./finance-db";
import { lineForOfflineInvoice } from "./finance-stripe";
import { autoMatchBankTransactions, getOfflinePaymentReconciliation } from "./bank-db";
import { offlinePaymentRef, type OfflineMethod } from "./offline-payment";

// Server side of offline payments (see lib/offline-payment.ts): records the
// payment in Stripe as an invoice paid out of band, then puts it straight
// into the finance ledger so bank reconciliation can pick it up — for a
// bank transfer, matched to its bank line right away if that line has
// already come in, otherwise as soon as it does (every bank import and the
// nightly finance sync run the auto-matcher).

export type OfflinePaymentInput = {
  method: OfflineMethod;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  amountCents: number;
  /** Invoice line text, e.g. "Casual session — 21 Nov". The method is appended. */
  description: string;
  /** Invoice metadata; `source` is set from the method. */
  metadata: Record<string, string>;
  customerMetadata?: Record<string, string>;
};

export type RecordedOfflinePayment = {
  invoiceId: string;
  /** What the booking / membership row stores as its payment reference. */
  paymentRef: string;
  invoice: Stripe.Invoice;
};

export async function recordOfflinePayment(input: OfflinePaymentInput): Promise<RecordedOfflinePayment> {
  const stripe = getStripe();
  const { method, email, firstName, lastName, phone } = input;

  const customers = await stripe.customers.list({ email, limit: 1 });
  const customer =
    customers.data[0] ??
    (await stripe.customers.create({
      email,
      name: `${firstName} ${lastName}`,
      phone: phone || undefined,
      metadata: input.customerMetadata,
    }));

  await stripe.invoiceItems.create({
    customer: customer.id,
    amount: input.amountCents,
    currency: "nzd",
    description: `${input.description} — ${method === "cash" ? "cash" : "bank transfer"}`,
  });

  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: 1,
    auto_advance: false,
    pending_invoice_items_behavior: "include",
    metadata: { ...input.metadata, source: method },
  });

  if (!invoice.id) throw new Error("Failed to create invoice");
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  const paid = await stripe.invoices.pay(finalized.id!, { paid_out_of_band: true });
  const invoiceId = paid.id ?? finalized.id!;
  return { invoiceId, paymentRef: offlinePaymentRef(method, invoiceId), invoice: paid };
}

// "matched": a bank transfer already tied to its bank line.
// "pending": a bank transfer still waiting for its bank line.
// "cash":    cash — reconciled later as part of a cash deposit.
// null:      the ledger couldn't be updated (logged; the nightly sync
//            imports the invoice anyway, so nothing is lost).
export type OfflineReconcileResult = "matched" | "pending" | "cash" | null;

export async function reconcileOfflinePayment(
  recorded: RecordedOfflinePayment,
  method: OfflineMethod,
): Promise<OfflineReconcileResult> {
  try {
    const line = lineForOfflineInvoice(recorded.invoice);
    if (!line) return null;
    await upsertStripeLines([line]);
    if (method === "cash") return "cash";
    await autoMatchBankTransactions();
    const status = await getOfflinePaymentReconciliation([recorded.invoiceId]);
    return status.get(recorded.invoiceId)?.reconciled ? "matched" : "pending";
  } catch (err) {
    console.error("Failed to add offline payment to the finance ledger", err);
    return null;
  }
}
