import { test } from "node:test";
import assert from "node:assert/strict";
import {
  offlineInvoiceIdFromRef,
  offlineMethodFromSource,
  offlinePaymentRef,
  parseOfflineMethod,
  paymentMethodFromRef,
} from "../lib/offline-payment.ts";
import { suggestForLine } from "../lib/bank-match.ts";

test("offline payment refs round-trip method and invoice id", () => {
  assert.equal(offlinePaymentRef("cash", "in_1"), "cash-invoice-in_1");
  assert.equal(offlinePaymentRef("bank_transfer", "in_2"), "transfer-invoice-in_2");
  assert.equal(paymentMethodFromRef("cash-invoice-in_1"), "cash");
  assert.equal(paymentMethodFromRef("transfer-invoice-in_2"), "bank_transfer");
  assert.equal(paymentMethodFromRef("pi_123"), "card");
  assert.equal(paymentMethodFromRef(null), "card");
  assert.equal(offlineInvoiceIdFromRef("cash-invoice-in_1"), "in_1");
  assert.equal(offlineInvoiceIdFromRef("transfer-invoice-in_2"), "in_2");
  assert.equal(offlineInvoiceIdFromRef("pi_123"), null);
});

test("offline method parsing defaults to cash", () => {
  assert.equal(parseOfflineMethod("bank_transfer"), "bank_transfer");
  assert.equal(parseOfflineMethod("cash"), "cash");
  assert.equal(parseOfflineMethod(null), "cash");
  assert.equal(offlineMethodFromSource("bank_transfer"), "bank_transfer");
  assert.equal(offlineMethodFromSource("cash"), "cash");
  assert.equal(offlineMethodFromSource("shop"), null);
});

test("a bank-transfer casual payment auto-matches its bank line by payer name", () => {
  const line = { id: 1, date: "2026-11-20", description: "JANE DOE", reference: "badminton", amountCents: 1000 };
  const entries = [
    { id: 10, date: "2026-11-20", name: "Casual session — 20 Nov 2026", person: "Jane Doe", notes: null, signedCents: 1000, method: "bank_transfer" },
    { id: 11, date: "2026-11-20", name: "Casual session — 20 Nov 2026", person: "Sam Lee", notes: null, signedCents: 1000, method: "bank_transfer" },
  ];
  const s = suggestForLine(line, entries, []);
  assert.equal(s?.kind, "entries");
  assert.deepEqual(s?.kind === "entries" && s.entryIds, [10]);
  assert.equal(s?.auto, true);
});

test("two candidates both named in the line stay a suggestion", () => {
  const line = { id: 1, date: "2026-11-20", description: "JANE DOE SAM LEE", reference: null, amountCents: 1000 };
  const entries = [
    { id: 10, date: "2026-11-20", name: "Casual", person: "Jane Doe", notes: null, signedCents: 1000, method: "bank_transfer" },
    { id: 11, date: "2026-11-20", name: "Casual", person: "Sam Lee", notes: null, signedCents: 1000, method: "bank_transfer" },
  ];
  assert.equal(suggestForLine(line, entries, [])?.auto, false);
});

test("accented names match unaccented bank text", () => {
  const line = { id: 1, date: "2026-11-20", description: "HOA NGUYEN", reference: null, amountCents: 3300 };
  const entries = [
    { id: 10, date: "2026-11-19", name: "Monthly membership (Friday)", person: "Hòa Nguyễn", notes: null, signedCents: 3300, method: "bank_transfer" },
    { id: 11, date: "2026-11-19", name: "Monthly membership (Friday)", person: "Đinh Minh", notes: null, signedCents: 3300, method: "bank_transfer" },
  ];
  const s = suggestForLine(line, entries, []);
  assert.deepEqual(s?.kind === "entries" && s.entryIds, [10]);
  assert.equal(s?.auto, true);
});
