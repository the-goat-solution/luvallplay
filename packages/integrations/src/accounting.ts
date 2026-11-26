// The accounting side of the framework (build plan §12.3, §12.4): one
// AccountingProvider interface (Xero first, MYOB second, QuickBooks third)
// and the rules that turn Luvallplay's money events into accounting
// documents. Pure: no I/O.
//
// Direction (decision AI): Luvallplay is the source of truth for
// transactions, the accounting system for the chart of accounts.
//
// The standard design for card payments (§12.3):
//   - each sale is an invoice, paid in full into a CLEARING account;
//   - the card fee is spend-money out of the clearing account;
//   - a refund is a credit note, refunded out of the clearing account;
//   - each payout is ONE transfer from clearing to the bank, equal to the
//     single line on the bank statement. Never income.
//   So the clearing account nets to zero once a payout has settled.
// Cash and bank-transfer payments go straight to the bank account.
//
// There is no delete anywhere in this file, and no provider method that
// deletes (test plan §3.19 "No deletes").
//
// NOT YET REVIEWED BY AN ACCOUNTANT (§12.3 "NZ specifics"): the GST
// treatment below is the plan's, with the tax codes left to the club's
// mapping. The fixtures in tests/integrations-accounting.test.ts need that
// review before a club uses the sync.
import { IntegrationError } from "./errors.ts";

// ── What the provider holds (read for the mapping screen) ──────────────────

export type LedgerAccount = { code: string; name: string; type: string; taxType: string | null; archived: boolean };
export type TaxRate = { taxType: string; name: string; /** Basis points: 1500 is 15%. */ rateBps: number; active: boolean };
export type TrackingCategory = { id: string; name: string; options: { id: string; name: string }[] };
export type BankAccount = { code: string; name: string; currency: string };
export type Organisation = {
  id: string;
  name: string;
  countryCode: string;
  baseCurrency: string;
  /** Nothing may be posted on or before this day (YYYY-MM-DD); null when no lock date is set. */
  lockDate: string | null;
};

// ── What we send ───────────────────────────────────────────────────────────

/** Only what the provider needs to match a payer (§12.1 "Privacy"): a name and an email. */
export type ContactDraft = { name: string; email: string };

export type DocumentLine = {
  description: string;
  /** Minor units, including tax when the document's amounts are tax-inclusive. */
  amount: number;
  accountCode: string;
  taxType: string;
  tracking?: { categoryId: string; optionId: string };
};

export type InvoiceDraft = {
  /** Our own reference, unique per sale; also how a connector finds an invoice it already made. */
  reference: string;
  contact: ContactDraft;
  /** YYYY-MM-DD in the club's time zone. */
  date: string;
  currency: string;
  amounts: "tax-inclusive" | "no-tax";
  lines: DocumentLine[];
  total: number;
};

export type PaymentDraft = { reference: string; invoiceReference: string; date: string; amount: number; currency: string; /** Clearing for cards, the bank for cash and transfers. */ accountCode: string };
/** A refund: a credit note against the sale, and the money going back out of the account it came into. */
export type CreditNoteDraft = InvoiceDraft & { invoiceReference: string; refundFromAccountCode: string };
/** Money spent: a card fee, or an expense from Finance (with its receipt). */
export type SpendDraft = { reference: string; date: string; currency: string; fromAccountCode: string; amounts: "tax-inclusive" | "no-tax"; lines: DocumentLine[]; total: number; payee: string };
export type TransferDraft = { reference: string; date: string; currency: string; fromAccountCode: string; toAccountCode: string; amount: number };

/** What the provider says it now holds. `version` is its own "last changed" stamp (for "edited externally"). */
export type ExternalDocument = { id: string; version: string | null; status: string };

export type WriteOptions = { idempotencyKey: string };

export interface AccountingProvider {
  readonly id: string;
  organisation(): Promise<Organisation>;
  listAccounts(): Promise<LedgerAccount[]>;
  listTaxRates(): Promise<TaxRate[]>;
  listTrackingCategories(): Promise<TrackingCategory[]>;
  listBankAccounts(): Promise<BankAccount[]>;
  /** Finds the contact by email, or creates it. Never changes an existing contact's details. */
  ensureContact(contact: ContactDraft, options: WriteOptions): Promise<ExternalDocument>;
  /** Finds a document we made earlier by our reference (so a lost answer doesn't become a duplicate). */
  findByReference(kind: "invoice" | "credit-note" | "spend" | "transfer" | "payment", reference: string): Promise<ExternalDocument | null>;
  createInvoice(invoice: InvoiceDraft, options: WriteOptions): Promise<ExternalDocument>;
  applyPayment(payment: PaymentDraft, invoice: ExternalDocument, options: WriteOptions): Promise<ExternalDocument>;
  createCreditNote(creditNote: CreditNoteDraft, invoice: ExternalDocument, options: WriteOptions): Promise<ExternalDocument>;
  createSpend(spend: SpendDraft, options: WriteOptions): Promise<ExternalDocument>;
  createTransfer(transfer: TransferDraft, options: WriteOptions): Promise<ExternalDocument>;
  attach(to: ExternalDocument, file: { name: string; contentType: string; bytes: Uint8Array }, options: WriteOptions): Promise<void>;
  /** The provider's current state of a document, to notice outside edits. */
  getDocument(kind: "invoice" | "credit-note" | "spend" | "transfer" | "payment", id: string): Promise<ExternalDocument | null>;
}

// ── The club's mapping (§12.3 "Mapping and controls") ──────────────────────

export const INCOME_KINDS = ["membership", "casual", "shop", "donation"] as const;
export type IncomeKind = (typeof INCOME_KINDS)[number];

export type AccountMapping = {
  /** False for a club that isn't GST-registered: every line is posted with `noTaxType`. */
  gstRegistered: boolean;
  /** The provider's tax codes (Xero NZ: OUTPUT2 for 15% on income, INPUT2 on expenses, NONE). */
  salesTaxType: string;
  expenseTaxType: string;
  noTaxType: string;
  income: Partial<Record<IncomeKind, { accountCode: string; tracking?: { categoryId: string; optionId: string } }>>;
  /** Where card money sits between the sale and the payout. */
  clearingAccountCode: string;
  /** Where cash and bank transfers land, and where payouts arrive. */
  bankAccountCode: string;
  feeAccountCode: string;
  /** Whether the card provider's fee carries GST. Set by the club's accountant; off by default. */
  feesCarryGst: boolean;
  /** Nothing dated before this day is pushed (§12.3 "sync start date"), YYYY-MM-DD. */
  syncFrom: string;
};

export type Sale = {
  id: string;
  kind: IncomeKind;
  /** What the payer paid, minor units, GST included where it applies. */
  amount: number;
  currency: string;
  /** YYYY-MM-DD, club time. */
  date: string;
  description: string;
  payer: ContactDraft;
  method: "card" | "cash" | "bank";
};

export type RefundOfSale = { id: string; sale: Sale; amount: number; date: string };

/** New Zealand GST. */
export const NZ_GST_BPS = 1500;

/**
 * The tax inside a tax-inclusive amount, in minor units, rounded half up:
 * 15% GST is 3/23 of the total ($115.00 holds $15.00; $33.00 holds $4.30).
 * For the reconciliation report only: the provider works out the tax on the
 * documents itself from the tax code.
 */
export function taxInside(grossMinor: number, rateBps: number): number {
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0) throw new Error("The amount must be whole minor units, zero or more.");
  return Math.floor((grossMinor * rateBps * 2 + (10_000 + rateBps)) / ((10_000 + rateBps) * 2));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Refuses what must never be sent: before the club's start date, or on or before the provider's lock date (§12.3). */
export function assertPostable(date: string, mapping: Pick<AccountMapping, "syncFrom">, organisation: Pick<Organisation, "lockDate">): void {
  if (!DATE.test(date)) throw new IntegrationError("validation", `"${date}" isn't a date.`);
  if (date < mapping.syncFrom) throw new IntegrationError("validation", `${date} is before the sync start date (${mapping.syncFrom}).`, { detail: { syncFrom: mapping.syncFrom } });
  if (organisation.lockDate && date <= organisation.lockDate) {
    // Queued with a clear alert, never forced: the club's accountant moves the lock date or tells us to skip it.
    throw new IntegrationError("lock_date", `${date} is on or before the lock date (${organisation.lockDate}).`, { detail: { lockDate: organisation.lockDate, date } });
  }
}

function incomeLine(sale: Pick<Sale, "kind" | "description">, amount: number, mapping: AccountMapping): { line: DocumentLine; amounts: InvoiceDraft["amounts"] } {
  const target = mapping.income[sale.kind];
  if (!target) throw new IntegrationError("mapping_missing", `No account is chosen for ${sale.kind} income yet.`, { detail: { kind: sale.kind } });
  // Donations are outside GST whatever the club's registration (§12.3; check with an accountant).
  const taxed = mapping.gstRegistered && sale.kind !== "donation";
  return {
    line: { description: sale.description, amount, accountCode: target.accountCode, taxType: taxed ? mapping.salesTaxType : mapping.noTaxType, ...(target.tracking ? { tracking: target.tracking } : {}) },
    amounts: taxed ? "tax-inclusive" : "no-tax",
  };
}

const positive = (amount: number, what: string) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new IntegrationError("validation", `${what} must be a positive whole number of minor units.`);
};

export const saleReference = (sale: Pick<Sale, "kind" | "id">) => `LAP-${sale.kind}-${sale.id}`;

export function invoiceFor(sale: Sale, mapping: AccountMapping): InvoiceDraft {
  positive(sale.amount, "A sale's amount");
  const { line, amounts } = incomeLine(sale, sale.amount, mapping);
  return { reference: saleReference(sale), contact: sale.payer, date: sale.date, currency: sale.currency.toUpperCase(), amounts, lines: [line], total: sale.amount };
}

export function paymentFor(sale: Sale, mapping: AccountMapping): PaymentDraft {
  return { reference: `${saleReference(sale)}-PAY`, invoiceReference: saleReference(sale), date: sale.date, amount: sale.amount, currency: sale.currency.toUpperCase(), accountCode: sale.method === "card" ? mapping.clearingAccountCode : mapping.bankAccountCode };
}

export function creditNoteFor(refund: RefundOfSale, mapping: AccountMapping): CreditNoteDraft {
  positive(refund.amount, "A refund's amount");
  if (refund.amount > refund.sale.amount) throw new IntegrationError("validation", "A refund can't be more than the sale.");
  const { line, amounts } = incomeLine({ kind: refund.sale.kind, description: `Refund: ${refund.sale.description}` }, refund.amount, mapping);
  return {
    reference: `LAP-refund-${refund.id}`,
    invoiceReference: saleReference(refund.sale),
    contact: refund.sale.payer,
    date: refund.date,
    currency: refund.sale.currency.toUpperCase(),
    amounts,
    lines: [line],
    total: refund.amount,
    refundFromAccountCode: refund.sale.method === "card" ? mapping.clearingAccountCode : mapping.bankAccountCode,
  };
}

export function feeFor(fee: { id: string; amount: number; currency: string; date: string; provider: string }, mapping: AccountMapping): SpendDraft {
  positive(fee.amount, "A fee");
  const taxed = mapping.gstRegistered && mapping.feesCarryGst;
  return {
    reference: `LAP-fee-${fee.id}`,
    date: fee.date,
    currency: fee.currency.toUpperCase(),
    fromAccountCode: mapping.clearingAccountCode,
    amounts: taxed ? "tax-inclusive" : "no-tax",
    lines: [{ description: `${fee.provider} fee`, amount: fee.amount, accountCode: mapping.feeAccountCode, taxType: taxed ? mapping.expenseTaxType : mapping.noTaxType }],
    total: fee.amount,
    payee: fee.provider,
  };
}

// ── Settlement: one payout, one bank line (§12.3) ──────────────────────────

export type PayoutItem = { type: "charge" | "refund" | "fee" | "adjustment"; /** Positive minor units for charges; refunds and fees are positive too (they're subtracted). Adjustments carry their own sign. */ amount: number };
export type Payout = { id: string; /** What reaches the bank, minor units. */ amount: number; currency: string; /** The day it arrives, YYYY-MM-DD. */ date: string; items: readonly PayoutItem[] };

export type Settlement = {
  transfer: TransferDraft;
  /** What the payout's items add up to. */
  itemsNet: number;
  /** itemsNet − the payout's amount. Zero when everything is accounted for; anything else is flagged, and the transfer still equals the bank line. */
  leftover: number;
};

/**
 * A payout as one transfer from clearing to the bank, equal to the bank line.
 * `leftover` is what would stay in the clearing account: a missing fee,
 * refund or timing item, which the daily report flags.
 */
export function settle(payout: Payout, mapping: AccountMapping): Settlement {
  if (!Number.isSafeInteger(payout.amount)) throw new IntegrationError("validation", "A payout must be whole minor units.");
  if (payout.amount <= 0) throw new IntegrationError("validation", "A payout that takes money back (zero or negative) needs a person to look at it.");
  let itemsNet = 0;
  for (const i of payout.items) {
    if (!Number.isSafeInteger(i.amount)) throw new IntegrationError("validation", "Payout items must be whole minor units.");
    itemsNet += i.type === "charge" || i.type === "adjustment" ? i.amount : -i.amount;
  }
  return {
    transfer: { reference: `LAP-payout-${payout.id}`, date: payout.date, currency: payout.currency.toUpperCase(), fromAccountCode: mapping.clearingAccountCode, toAccountCode: mapping.bankAccountCode, amount: payout.amount },
    itemsNet,
    leftover: itemsNet - payout.amount,
  };
}

/** Problems with a mapping before the first sync: accounts that don't exist or are archived, unknown tax codes. */
export function checkMapping(mapping: AccountMapping, ledger: { accounts: readonly LedgerAccount[]; taxRates: readonly TaxRate[] }): string[] {
  const problems: string[] = [];
  const account = (code: string, what: string) => {
    const a = ledger.accounts.find((x) => x.code === code);
    if (!a) problems.push(`${what}: account ${code} doesn't exist.`);
    else if (a.archived) problems.push(`${what}: account ${code} (${a.name}) is archived.`);
  };
  for (const kind of INCOME_KINDS) {
    const target = mapping.income[kind];
    if (target) account(target.accountCode, `${kind} income`);
  }
  account(mapping.clearingAccountCode, "clearing");
  account(mapping.bankAccountCode, "bank");
  account(mapping.feeAccountCode, "fees");
  if (new Set([mapping.clearingAccountCode, mapping.bankAccountCode]).size === 1) problems.push("The clearing account and the bank account must be different.");
  const taxTypes = mapping.gstRegistered ? [mapping.salesTaxType, mapping.expenseTaxType, mapping.noTaxType] : [mapping.noTaxType];
  for (const t of taxTypes) if (!ledger.taxRates.some((r) => r.taxType === t && r.active)) problems.push(`Tax code ${t} isn't active.`);
  if (!DATE.test(mapping.syncFrom)) problems.push("The sync start date isn't a date.");
  return problems;
}
