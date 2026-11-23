import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { clubDateKeyForInstant } from "./dates";
import { getSyncState, markSyncFailed, markSyncSucceeded, upsertStripeLines, type StripeLedgerLine } from "./finance-db";
import type { FinanceKind } from "./finance";
import { upsertStripePayouts } from "./bank-db";
import { offlineMethodFromSource } from "./offline-payment";

// Imports the club's Stripe money movements into the finance ledger.
//
// Source of truth is Stripe's *balance transactions* — the same list Stripe
// itself reconciles payouts against — so every dollar that actually moved
// is counted exactly once:
//
//   charge / payment      → Received (gross amount) + a Spent "Stripe fee" line
//   refund                → Spent (the refunded amount)
//   stripe_fee & co.      → Spent (Stripe Billing/Invoicing usage fees)
//   adjustment (dispute)  → Received or Spent by sign, plus its dispute fee
//   payout / transfer …   → skipped: money moving between Stripe and the
//                            club's own bank account isn't income or expense
//
// Cash or a bank transfer the admin collects is recorded as a Stripe invoice
// "paid out of band" (see lib/offline-payment-stripe.ts). Those never create a
// balance transaction, so they're imported separately from the invoice list.
//
// Each line has a stable external_id derived from the Stripe object id, and
// the upsert is idempotent — overlapping sync windows are harmless.

const SYNC_KEY = "stripe";
// Re-scan a little before the last successful sync, so anything Stripe
// created with a slightly earlier timestamp (or a run that died mid-way)
// is still picked up. Duplicates are absorbed by the upsert.
const OVERLAP_SECONDS = 3 * 24 * 60 * 60;
// How stale the ledger may get before opening the Financials page triggers
// a sync on its own.
export const AUTO_SYNC_AFTER_MS = 10 * 60 * 1000;

const INCLUDED_TYPES = new Set<string>([
  "charge",
  "payment",
  "refund",
  "payment_refund",
  "payment_failure_refund",
  "refund_failure",
  "payment_reversal",
  "adjustment",
  "stripe_fee",
  "stripe_fx_fee",
  "tax_fee",
]);

const FEE_ONLY_TYPES = new Set(["stripe_fee", "stripe_fx_fee", "tax_fee"]);

function dashboardBase(): string {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const test = /^(sk|rk)_test_/.test(key);
  return `https://dashboard.stripe.com/${test ? "test/" : ""}`;
}

function dateKeyFromUnix(seconds: number): string {
  return clubDateKeyForInstant(new Date(seconds * 1000));
}

const TIER_LABEL: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly" };
const DAY_LABEL: Record<string, string> = { friday: "Friday", wednesday: "Wednesday" };

function shortDate(key: string | undefined): string {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  const [y, m, d] = key.split("-").map(Number);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${d} ${month} ${y}`;
}

function personFrom(meta: Stripe.Metadata | null | undefined, fallback?: string | null): string | null {
  const name = [meta?.firstName, meta?.lastName].filter(Boolean).join(" ").trim();
  return name || fallback?.trim() || null;
}

type Described = { name: string; category: string; person: string | null };

// Names a payment from the metadata this app attaches when it creates the
// PaymentIntent / subscription / invoice (see app/api/create-*).
function describeFromMetadata(
  meta: Stripe.Metadata | null | undefined,
  { renewal = false, subscription = false }: { renewal?: boolean; subscription?: boolean } = {},
): Omit<Described, "person"> | null {
  if (!meta) return null;
  if (meta.type === "casual") {
    const when = shortDate(meta.sessionDate);
    return { name: when ? `Casual session — ${when}` : "Casual session", category: "casual" };
  }
  if (meta.type === "shop") {
    return { name: meta.items ? `Shop — ${meta.items}` : "Shop order", category: "merchandise" };
  }
  if (meta.type === "donation") {
    return { name: subscription ? "Monthly donation" : "Donation", category: "donation" };
  }
  // Membership subscriptions carry plan/day but no `type` (see
  // app/api/create-subscription), one-time and cash ones carry both.
  if (meta.type === "membership" || meta.plan) {
    const tier = TIER_LABEL[meta.plan ?? ""] ?? "";
    const day = DAY_LABEL[meta.day ?? ""];
    let name = `${tier ? `${tier} membership` : "Membership"}${day ? ` (${day})` : ""}`;
    if (renewal) name += " — renewal";
    else if (meta.recurring === "false") name += " — one-time";
    return { name, category: "membership" };
  }
  return null;
}

// Charges for subscription invoices (membership renewals, monthly
// donations) carry no metadata of their own; the subscription's metadata
// lives on the invoice that the payment settled. Cached per run since a
// refund and its original charge resolve to the same invoice.
async function describeCharge(
  stripe: Stripe,
  charge: Stripe.Charge,
  cache: Map<string, Described>,
): Promise<Described> {
  const cached = cache.get(charge.id);
  if (cached) return cached;

  const fallbackPerson =
    charge.billing_details?.name || charge.receipt_email || charge.billing_details?.email || null;

  let described: Described | null = null;
  const fromCharge = describeFromMetadata(charge.metadata);
  if (fromCharge) {
    described = { ...fromCharge, person: personFrom(charge.metadata, fallbackPerson) };
  } else {
    const piId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (piId) {
      try {
        const payments = await stripe.invoicePayments.list({
          payment: { type: "payment_intent", payment_intent: piId },
          expand: ["data.invoice"],
          limit: 1,
        });
        const invoice = payments.data[0]?.invoice;
        if (invoice && typeof invoice === "object" && !("deleted" in invoice && invoice.deleted)) {
          const inv = invoice as Stripe.Invoice;
          const subMeta = inv.parent?.subscription_details?.metadata ?? null;
          const meta = { ...(inv.metadata ?? {}), ...(subMeta ?? {}) };
          const fromInvoice = describeFromMetadata(meta, {
            renewal: inv.billing_reason === "subscription_cycle",
            subscription: Boolean(inv.parent?.subscription_details),
          });
          if (fromInvoice) {
            described = {
              ...fromInvoice,
              person: personFrom(meta, inv.customer_name || inv.customer_email || fallbackPerson),
            };
          } else {
            const line = inv.lines?.data[0]?.description;
            described = {
              name: line || charge.description || "Stripe payment",
              category: "other_income",
              person: inv.customer_name || inv.customer_email || fallbackPerson,
            };
          }
        }
      } catch (err) {
        // Non-fatal: fall through to a generic description. The next sync
        // that overlaps this payment will retry and refresh the name.
        console.error("Finance sync: could not resolve invoice for", piId, err);
      }
    }
  }

  described ??= {
    name: charge.description || "Stripe payment",
    category: "other_income",
    person: fallbackPerson,
  };
  cache.set(charge.id, described);
  return described;
}

function paymentUrl(charge: Stripe.Charge | null): string | null {
  if (!charge) return null;
  const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  return `${dashboardBase()}payments/${pi ?? charge.id}`;
}

async function linesForBalanceTransaction(
  stripe: Stripe,
  bt: Stripe.BalanceTransaction,
  cache: Map<string, Described>,
): Promise<StripeLedgerLine[]> {
  if (!INCLUDED_TYPES.has(bt.type)) return [];

  const entryDate = dateKeyFromUnix(bt.created);
  const source = bt.source && typeof bt.source === "object" ? bt.source : null;
  const lines: StripeLedgerLine[] = [];

  // Work out which charge (if any) this movement belongs to, for naming.
  // Refunds and disputes only carry the charge id; they're rare enough that
  // fetching it is cheaper than expanding it on every balance transaction.
  let charge: Stripe.Charge | null = null;
  if (source?.object === "charge") {
    charge = source as Stripe.Charge;
  } else if (source?.object === "refund" || source?.object === "dispute") {
    const ref = (source as Stripe.Refund | Stripe.Dispute).charge;
    if (ref && typeof ref === "object") {
      charge = ref;
    } else if (typeof ref === "string") {
      charge = await stripe.charges.retrieve(ref).catch(() => null);
    }
  }
  const described = charge ? await describeCharge(stripe, charge, cache) : null;
  const url = paymentUrl(charge) ?? `${dashboardBase()}balance/overview`;
  const isPayment = bt.type === "charge" || bt.type === "payment";
  const isRefund = !isPayment && source?.object === "refund";

  if (bt.amount !== 0) {
    const kind: FinanceKind = bt.amount > 0 ? "received" : "spent";
    let name: string;
    let category: string;
    if (isPayment && described) {
      name = described.name;
      category = described.category;
    } else if (isRefund) {
      name = `Refund — ${described?.name ?? "Stripe payment"}`;
      category = kind === "spent" ? "refunds" : "other_income";
    } else if (FEE_ONLY_TYPES.has(bt.type)) {
      name = bt.description || "Stripe fee";
      category = "stripe_fees";
    } else {
      name = bt.description || (described ? `${described.name} (adjustment)` : "Stripe adjustment");
      category = kind === "received" ? "other_income" : "other_expense";
    }
    lines.push({
      externalId: `stripe-bt:${bt.id}`,
      kind,
      name,
      category,
      method: "stripe",
      person: described?.person ?? null,
      entryDate,
      amountCents: Math.abs(bt.amount),
      externalUrl: url,
    });
  }

  // Stripe's processing fee (incl. GST) is netted off the payout, so it's
  // money the club never sees — record it as its own Spent line so the net
  // total here matches what lands in the bank. A negative fee is a fee
  // Stripe handed back (e.g. on some refunds).
  if (bt.fee !== 0) {
    lines.push({
      externalId: `stripe-fee:${bt.id}`,
      kind: bt.fee > 0 ? "spent" : "received",
      name: `${bt.fee > 0 ? "Stripe fee" : "Stripe fee returned"}${described ? ` — ${described.name}` : bt.description ? ` — ${bt.description}` : ""}`,
      category: "stripe_fees",
      method: "stripe",
      person: described?.person ?? null,
      entryDate,
      amountCents: Math.abs(bt.fee),
      externalUrl: url,
    });
  }

  return lines;
}

// An offline payment (cash or bank transfer) the admin recorded as an
// invoice paid out of band. The method decides how bank reconciliation
// treats it: a transfer is matched to its own bank line, cash to the
// deposit that banked it.
export function lineForOfflineInvoice(invoice: Stripe.Invoice): StripeLedgerLine | null {
  const method = offlineMethodFromSource(invoice.metadata?.source);
  if (invoice.status !== "paid" || !method || !invoice.id) return null;
  const described = describeFromMetadata(invoice.metadata);
  const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
  return {
    externalId: `stripe-invoice:${invoice.id}`,
    kind: "received",
    name: `${described?.name ?? invoice.lines?.data[0]?.description ?? (method === "cash" ? "Cash payment" : "Bank transfer")}`,
    category: described?.category ?? "other_income",
    method,
    person: personFrom(invoice.metadata, invoice.customer_name || invoice.customer_email),
    entryDate: dateKeyFromUnix(paidAt),
    amountCents: invoice.total,
    externalUrl: `${dashboardBase()}invoices/${invoice.id}`,
  };
}

export type StripeSyncResult = { imported: number; scanned: number };

export async function syncStripeFinance({ full = false } = {}): Promise<StripeSyncResult> {
  const stripe = getStripe();
  const startedAt = new Date();
  const state = await getSyncState(SYNC_KEY);
  const since =
    !full && state.lastStartedAt
      ? Math.floor(state.lastStartedAt.getTime() / 1000) - OVERLAP_SECONDS
      : undefined;
  const created = since ? { gte: since } : undefined;

  try {
    const cache = new Map<string, Described>();
    const lines: StripeLedgerLine[] = [];
    let scanned = 0;

    const payouts: Parameters<typeof upsertStripePayouts>[0] = [];
    for await (const bt of stripe.balanceTransactions.list({
      limit: 100,
      ...(created ? { created } : {}),
      expand: ["data.source"],
    })) {
      scanned++;
      lines.push(...(await linesForBalanceTransaction(stripe, bt, cache)));
      // Payouts aren't income or expense, but bank reconciliation needs
      // them to recognise the matching credit on the bank statement.
      const source = bt.source && typeof bt.source === "object" ? bt.source : null;
      if (bt.type === "payout" && source?.object === "payout") {
        const payout = source as Stripe.Payout;
        payouts.push({
          id: payout.id,
          amountCents: Math.abs(bt.amount),
          createdDate: dateKeyFromUnix(bt.created),
          arrivalDate: dateKeyFromUnix(payout.arrival_date),
          status: payout.status,
        });
      }
    }
    await upsertStripePayouts(payouts);

    for await (const invoice of stripe.invoices.list({
      limit: 100,
      status: "paid",
      ...(created ? { created } : {}),
    })) {
      scanned++;
      const line = lineForOfflineInvoice(invoice);
      if (line) lines.push(line);
    }

    const imported = await upsertStripeLines(lines);
    await markSyncSucceeded(SYNC_KEY, startedAt);
    return { imported, scanned };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markSyncFailed(SYNC_KEY, message).catch(() => {});
    throw err;
  }
}

export async function getStripeSyncState() {
  return getSyncState(SYNC_KEY);
}

// Money currently held by Stripe for the club (available + pending, NZD) —
// one of the three pots in the bank reconciliation's "money held".
export async function getStripeBalanceCents(): Promise<number> {
  const balance = await getStripe().balance.retrieve();
  const sum = (list: { amount: number; currency: string }[] | undefined) =>
    (list ?? []).filter((b) => b.currency === "nzd").reduce((t, b) => t + b.amount, 0);
  return sum(balance.available) + sum(balance.pending);
}
