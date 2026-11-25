// The accounting rules every accounting connector shares (build plan §12.3,
// §12.4; test plan §3.19 "Sync correctness" and "NZ tax").
//
// The NZ GST fixtures here follow the plan and Inland Revenue's 3/23 rule.
// THEY HAVE NOT BEEN REVIEWED BY AN ACCOUNTANT YET, which test plan §3.19
// requires before a club uses the sync.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  IntegrationError,
  NZ_GST_BPS,
  assertPostable,
  checkMapping,
  clearingBalance,
  creditNoteFor,
  feeFor,
  invoiceFor,
  paymentFor,
  settle,
  taxInside,
  type AccountMapping,
  type Sale,
} from "@luvallplay/integrations";

const mapping: AccountMapping = {
  gstRegistered: true,
  salesTaxType: "OUTPUT2",
  expenseTaxType: "INPUT2",
  noTaxType: "NONE",
  income: { membership: { accountCode: "200" }, casual: { accountCode: "201", tracking: { categoryId: "cat", optionId: "fri" } }, donation: { accountCode: "270" } },
  clearingAccountCode: "610",
  bankAccountCode: "090",
  feeAccountCode: "404",
  feesCarryGst: false,
  syncFrom: "2026-11-01",
};
const payer = { name: "Mia Tran", email: "mia@example.com" };
const sale = (over: Partial<Sale> = {}): Sale => ({ id: "77", kind: "membership", amount: 115_00, currency: "nzd", date: "2026-11-26", description: "Term membership", payer, method: "card", ...over });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as IntegrationError).code;
  }
  return null;
};

test("GST at 15% is 3/23 of the total, to the cent, rounded half up", () => {
  assert.equal(taxInside(115_00, NZ_GST_BPS), 15_00);
  assert.equal(taxInside(33_00, NZ_GST_BPS), 4_30); // 4.3043…
  assert.equal(taxInside(10_00, NZ_GST_BPS), 1_30); // 1.3043…
  assert.equal(taxInside(1, NZ_GST_BPS), 0);
  assert.equal(taxInside(4, NZ_GST_BPS), 1); // 0.5217… rounds up
  assert.equal(taxInside(0, NZ_GST_BPS), 0);
  assert.throws(() => taxInside(1.5, NZ_GST_BPS));
});

test("a GST-registered club: a sale is one tax-inclusive invoice line on the mapped account, with the payer's name and email only", () => {
  const inv = invoiceFor(sale(), mapping);
  assert.deepEqual(inv, {
    reference: "LAP-membership-77",
    contact: payer,
    date: "2026-11-26",
    currency: "NZD",
    amounts: "tax-inclusive",
    lines: [{ description: "Term membership", amount: 115_00, accountCode: "200", taxType: "OUTPUT2" }],
    total: 115_00,
  });
  assert.deepEqual(invoiceFor(sale({ kind: "casual" }), mapping).lines[0].tracking, { categoryId: "cat", optionId: "fri" });
});

test("a club that isn't GST-registered posts everything with no tax", () => {
  const inv = invoiceFor(sale(), { ...mapping, gstRegistered: false });
  assert.deepEqual([inv.amounts, inv.lines[0].taxType, inv.total], ["no-tax", "NONE", 115_00]);
  assert.equal(feeFor({ id: "f1", amount: 3_65, currency: "NZD", date: "2026-11-26", provider: "Stripe" }, { ...mapping, gstRegistered: false, feesCarryGst: true }).lines[0].taxType, "NONE");
});

test("donations are outside GST, even for a registered club", () => {
  const inv = invoiceFor(sale({ kind: "donation", amount: 50_00 }), mapping);
  assert.deepEqual([inv.amounts, inv.lines[0].taxType, inv.lines[0].accountCode], ["no-tax", "NONE", "270"]);
});

test("an income type nobody mapped waits in the error queue instead of landing in a guessed account", () => {
  assert.equal(code(() => invoiceFor(sale({ kind: "shop" }), mapping)), "mapping_missing");
  assert.equal(code(() => invoiceFor(sale({ amount: 0 }), mapping)), "validation");
});

test("card money goes to clearing; cash and bank transfers go straight to the bank", () => {
  assert.equal(paymentFor(sale(), mapping).accountCode, "610");
  assert.equal(paymentFor(sale({ method: "cash" }), mapping).accountCode, "090");
  assert.equal(paymentFor(sale({ method: "bank" }), mapping).accountCode, "090");
  assert.deepEqual([paymentFor(sale(), mapping).invoiceReference, paymentFor(sale(), mapping).amount], ["LAP-membership-77", 115_00]);
});

test("a refund is a credit note against the sale, paid back out of where the money went; never more than the sale", () => {
  const cn = creditNoteFor({ id: "r9", sale: sale(), amount: 40_00, date: "2026-11-28" }, mapping);
  assert.deepEqual([cn.reference, cn.invoiceReference, cn.total, cn.refundFromAccountCode, cn.lines[0].accountCode, cn.lines[0].taxType], ["LAP-refund-r9", "LAP-membership-77", 40_00, "610", "200", "OUTPUT2"]);
  assert.equal(creditNoteFor({ id: "r9", sale: sale({ method: "cash" }), amount: 40_00, date: "2026-11-28" }, mapping).refundFromAccountCode, "090");
  assert.equal(code(() => creditNoteFor({ id: "r9", sale: sale(), amount: 115_01, date: "2026-11-28" }, mapping)), "validation");
});

test("a payout with sales, fees and a refund nets to the bank line, and the clearing account ends at zero", () => {
  const fee = feeFor({ id: "f1", amount: 3_65, currency: "nzd", date: "2026-11-26", provider: "Stripe" }, mapping);
  assert.deepEqual([fee.fromAccountCode, fee.lines[0].accountCode, fee.lines[0].taxType, fee.amounts], ["610", "404", "NONE", "no-tax"]);
  assert.equal(feeFor({ id: "f1", amount: 3_65, currency: "nzd", date: "2026-11-26", provider: "Stripe" }, { ...mapping, feesCarryGst: true }).lines[0].taxType, "INPUT2");

  const payout = { id: "po_1", amount: 203_70, currency: "nzd", date: "2026-11-30", items: [{ type: "charge", amount: 115_00 }, { type: "charge", amount: 135_00 }, { type: "fee", amount: 3_65 }, { type: "fee", amount: 2_65 }, { type: "refund", amount: 40_00 }] as const };
  const s = settle(payout, mapping);
  assert.deepEqual(s.transfer, { reference: "LAP-payout-po_1", date: "2026-11-30", currency: "NZD", fromAccountCode: "610", toAccountCode: "090", amount: 203_70 });
  assert.deepEqual([s.itemsNet, s.leftover], [203_70, 0]);
  // Clearing: payments in, fees and the refund out, the transfer out.
  assert.equal(clearingBalance([{ amount: 115_00 }, { amount: 135_00 }, { amount: -3_65 }, { amount: -2_65 }, { amount: -40_00 }, { amount: -s.transfer.amount }]), 0);

  // A fee we never heard about: the transfer still equals the bank line, and the difference is flagged.
  const short = settle({ ...payout, amount: 201_05 }, mapping);
  assert.deepEqual([short.transfer.amount, short.leftover], [201_05, 2_65]);
  assert.equal(code(() => settle({ ...payout, amount: -5_00 }, mapping)), "validation");
});

test("nothing is posted before the sync start date or on or before the lock date", () => {
  assert.doesNotThrow(() => assertPostable("2026-11-26", mapping, { lockDate: "2026-10-31" }));
  assert.doesNotThrow(() => assertPostable("2026-11-26", mapping, { lockDate: null }));
  assert.equal(code(() => assertPostable("2026-11-26", mapping, { lockDate: "2026-11-30" })), "lock_date");
  assert.equal(code(() => assertPostable("2026-11-30", mapping, { lockDate: "2026-11-30" })), "lock_date");
  assert.equal(code(() => assertPostable("2026-10-31", mapping, { lockDate: null })), "validation");
  assert.equal(code(() => assertPostable("26/11/2026", mapping, { lockDate: null })), "validation");
});

test("the mapping is checked against the club's chart: missing or archived accounts and inactive tax codes are named", () => {
  const accounts = ["200", "201", "270", "610", "090", "404"].map((c) => ({ code: c, name: `Account ${c}`, type: "REVENUE", taxType: null, archived: false }));
  const taxRates = ["OUTPUT2", "INPUT2", "NONE"].map((t) => ({ taxType: t, name: t, rateBps: t === "NONE" ? 0 : 1500, active: true }));
  assert.deepEqual(checkMapping(mapping, { accounts, taxRates }), []);
  const problems = checkMapping(
    { ...mapping, bankAccountCode: "610", income: { membership: { accountCode: "999" }, casual: { accountCode: "201" } } },
    { accounts: accounts.map((a) => (a.code === "201" ? { ...a, archived: true } : a)), taxRates: taxRates.filter((t) => t.taxType !== "INPUT2") },
  );
  assert.deepEqual(problems, [
    "membership income: account 999 doesn't exist.",
    "casual income: account 201 (Account 201) is archived.",
    "The clearing account and the bank account must be different.",
    "Tax code INPUT2 isn't active.",
  ]);
});

test("no deletes: the accounting interface has no way to delete or void by hand", () => {
  const src = readFileSync(new URL("../../../packages/integrations/src/accounting.ts", import.meta.url), "utf8");
  const iface = src.slice(src.indexOf("export interface AccountingProvider"), src.indexOf("// ── The club's mapping"));
  const methods = [...iface.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(methods, ["organisation", "listAccounts", "listTaxRates", "listTrackingCategories", "listBankAccounts", "ensureContact", "findByReference", "createInvoice", "applyPayment", "createCreditNote", "createSpend", "createTransfer", "attach", "getDocument"]);
  assert.ok(!/delete|remove|void/i.test(methods.join(" ")));
});
