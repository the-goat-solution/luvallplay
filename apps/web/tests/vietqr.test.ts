// Track V: VietQR codes with amount and reference, and matching incoming
// transfers to references (build plan §6.5, §11.4; test plan §3.16 "VietQR
// reference generation and matching ... have their own cases").

import { test } from "node:test";
import assert from "node:assert/strict";
import { VIETQR_BANKS, VIETQR_CAPABILITIES, VIETQR_NOTE_MAX, VietQRError, buildVietQR, crc16, parseVietQR, vietQRNote } from "@luvallplay/core/vietqr";
import { DEFAULT_REFERENCE_PREFIX, findReferences, makeReference, matchTransfer, matchTransfers, readReference, type ExpectedPayment } from "@luvallplay/core/vietqr-match";
import { foldForSearch, foldedIncludes, stripDiacritics } from "@luvallplay/core/text-fold";
import { requireCapability, assertValidPayment, PaymentError } from "@luvallplay/core/payments";

// The example published with the NAPAS VietQR profile: Sacombank (970403),
// account 0011012345678, 180,000 dong, a one-time code.
const NAPAS_EXAMPLE = "00020101021238570010A00000072701270006970403011300110123456780208QRIBFTTA530370454061800005802VN62340107NPS68690819thanh toan don hang63042E2E";

test("the checksum is CRC-16/CCITT-FALSE", () => {
  assert.equal(crc16("123456789"), "29B1"); // the algorithm's standard check value
  assert.equal(crc16(NAPAS_EXAMPLE.slice(0, -4)), "2E2E");
  assert.throws(() => crc16("Nguyễn"), VietQRError);
});

test("the published example reads back", () => {
  assert.deepEqual(parseVietQR(NAPAS_EXAMPLE), {
    bankBin: "970403",
    account: "0011012345678",
    toCard: false,
    amount: 180000,
    note: "thanh toan don hang",
    accountName: null,
    city: null,
    oneTime: true,
  });
});

test("a code with amount and reference, field by field", () => {
  const reference = makeReference(1234);
  const code = buildVietQR({ bankBin: "970436", account: "1023456789", amount: 50000, note: reference });
  assert.equal(
    code.slice(0, -4),
    "000201" + "010212" + "38540010A000000727" + "0124" + "0006970436" + "01101023456789" + "0208QRIBFTTA" + "5303704" + "540550000" + "5802VN" + `6215` + `0811${reference}` + "6304",
  );
  assert.equal(code.slice(-4), crc16(code.slice(0, -4)));
  assert.deepEqual(parseVietQR(code), { bankBin: "970436", account: "1023456789", toCard: false, amount: 50000, note: reference, accountName: null, city: null, oneTime: true });
});

test("amounts are whole dong: never cents, never a fraction", () => {
  const amountOf = (amount: number) => parseVietQR(buildVietQR({ bankBin: "970436", account: "1", amount })).amount;
  assert.equal(amountOf(1), 1);
  assert.equal(amountOf(50000), 50000);
  assert.equal(amountOf(1250000), 1250000);
  assert.equal(amountOf(9_999_999_999_999), 9_999_999_999_999);
  assert.ok(buildVietQR({ bankBin: "970436", account: "1", amount: 50000 }).includes("540550000"), "50,000 dong is written 50000, not 500.00 or 5000000");
  for (const bad of [0, -1, 10.5, Number.NaN, Number.POSITIVE_INFINITY, 10_000_000_000_000]) {
    assert.throws(() => buildVietQR({ bankBin: "970436", account: "1", amount: bad }), VietQRError, String(bad));
  }
});

test("a code without an amount is a many-times code", () => {
  const code = buildVietQR({ bankBin: "970422", account: "0987654321" });
  assert.ok(code.startsWith("000201010211"));
  const parsed = parseVietQR(code);
  assert.equal(parsed.amount, null);
  assert.equal(parsed.note, null);
  assert.equal(parsed.oneTime, false);
});

test("transfer notes lose what a bank would drop; names and cards are carried", () => {
  assert.equal(vietQRNote("Phí tháng 12 – Nguyễn Thị Hương!"), "Phi thang 12 Nguyen Thi Huong");
  assert.equal(vietQRNote("  Đặng   Văn\tĐức "), "Dang Van Duc");
  const code = buildVietQR({ bankBin: "970407", account: "9704 0712 3456 7890", toCard: true, amount: 120000, note: "Hội phí tháng 12", accountName: "CLB Cầu lông Hà Nội", city: "Hà Nội" });
  assert.deepEqual(parseVietQR(code), { bankBin: "970407", account: "9704071234567890", toCard: true, amount: 120000, note: "Hoi phi thang 12", accountName: "CLB CAU LONG HA NOI", city: "HA NOI", oneTime: true });
  assert.match(code, /^[\x20-\x7e]+$/, "only plain ASCII goes into a code");
});

test("what a bank would refuse is refused here", () => {
  const ok = { bankBin: "970436", account: "1023456789" };
  assert.throws(() => buildVietQR({ ...ok, bankBin: "97043" }), /six digits/);
  assert.throws(() => buildVietQR({ ...ok, bankBin: "97O436" }), /six digits/);
  assert.throws(() => buildVietQR({ ...ok, account: "" }), /account number/);
  assert.throws(() => buildVietQR({ ...ok, account: "12-34" }), /account number/);
  assert.throws(() => buildVietQR({ ...ok, account: "1".repeat(20) }), /account number/);
  assert.throws(() => buildVietQR({ ...ok, note: "–!?" }), /nothing a bank would keep/);
  assert.throws(() => buildVietQR({ ...ok, note: "x".repeat(VIETQR_NOTE_MAX + 1) }), /at most 50/);
  assert.ok(buildVietQR({ ...ok, note: "x".repeat(VIETQR_NOTE_MAX) }));
});

test("a damaged or foreign code is refused when read", () => {
  const code = buildVietQR({ bankBin: "970436", account: "1023456789", amount: 50000, note: "LVP1" });
  assert.throws(() => parseVietQR(code.replace("50000", "90000")), /checksum doesn't match/);
  assert.throws(() => parseVietQR(code.slice(0, -4)), /checksum/);
  assert.throws(() => parseVietQR("hello"), /checksum/);
  const reseal = (body: string) => body + crc16(body);
  assert.throws(() => parseVietQR(reseal(code.slice(0, -4).replace("A000000727", "A000000999"))), /NAPAS/);
  assert.throws(() => parseVietQR(reseal(code.slice(0, -4).replace("5303704", "5303554"))), /dong/);
  assert.throws(() => parseVietQR(reseal(code.slice(0, -4).replace("5802VN", "5802NZ"))), /Vietnamese/);
  assert.throws(() => parseVietQR(reseal(code.slice(0, -4).replace("QRIBFTTA", "QRPUSHXX"))), /transfer/);
  assert.throws(() => parseVietQR(reseal("000201" + "000201" + "6304")), /twice/);
  assert.throws(() => parseVietQR(reseal("0099ab" + "6304")), /cut short|four digits/);
  assert.equal(parseVietQR(`  ${code}\n`).amount, 50000, "white space around a pasted code is fine");
});

test("the bank list has well-formed, distinct BINs", () => {
  assert.ok(VIETQR_BANKS.length >= 10);
  assert.equal(new Set(VIETQR_BANKS.map((b) => b.bin)).size, VIETQR_BANKS.length);
  assert.equal(new Set(VIETQR_BANKS.map((b) => b.code)).size, VIETQR_BANKS.length);
  for (const b of VIETQR_BANKS) assert.match(b.bin, /^\d{6}$/);
});

test("VietQR's capabilities: a QR code in dong, and nothing the bank can't do", () => {
  assert.deepEqual(VIETQR_CAPABILITIES.currencies, ["VND"]);
  assert.equal(VIETQR_CAPABILITIES.qr, true);
  const provider = { id: "vietqr", capabilities: VIETQR_CAPABILITIES };
  // No recurring billing: renewals are reminders with a new code (test plan §3.16 "recurring-billing absence").
  for (const missing of ["recurring", "refunds", "partialRefunds", "webhooks", "payoutStatus", "clientConfirmation"] as const) {
    assert.throws(() => requireCapability(provider, missing), (e: unknown) => e instanceof PaymentError && e.code === "unsupported", missing);
  }
  requireCapability(provider, "qr");
  const input = { amount: 50000, currency: "VND", description: "Casual", metadata: {}, idempotencyKey: "k" };
  assertValidPayment(provider, input);
  assert.throws(() => assertValidPayment(provider, { ...input, currency: "NZD" }), (e: unknown) => e instanceof PaymentError && e.code === "currency_not_supported");
});

// ── References ──────────────────────────────────────────────────────────────

test("a reference: prefix, the payment's number, a check character", () => {
  assert.equal(DEFAULT_REFERENCE_PREFIX, "LVP");
  const r = makeReference(1234);
  assert.match(r, /^LVP[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(r.slice(0, -1), "LVP000016J"); // 1234 = 1·32² + 6·32 + 18
  assert.equal(readReference(r), 1234);
  assert.equal(makeReference(1234), r, "the same payment always gets the same reference");
  assert.equal(readReference(makeReference(7, "TW"), "TW"), 7);
  assert.equal(readReference(makeReference(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  assert.ok(makeReference(Number.MAX_SAFE_INTEGER).length <= VIETQR_NOTE_MAX);
  for (const bad of [0, -1, 1.5, Number.NaN]) assert.throws(() => makeReference(bad));
  for (const bad of ["L", "LVPXX", "lvp", "L1"]) assert.throws(() => makeReference(1, bad));
});

test("references round-trip, are all different, and fit in a code", () => {
  const seen = new Set<string>();
  for (let n = 1; n <= 5000; n++) {
    const r = makeReference(n);
    assert.equal(readReference(r), n);
    seen.add(r);
  }
  assert.equal(seen.size, 5000);
  const code = buildVietQR({ bankBin: "970436", account: "1023456789", amount: 50000, note: makeReference(4999) });
  assert.equal(parseVietQR(code).note, makeReference(4999));
});

test("one wrong character is always caught; look-alikes and case are forgiven", () => {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  for (const n of [1, 1234, 987654, 2 ** 40]) {
    const r = makeReference(n);
    for (let i = 3; i < r.length; i++) {
      for (const c of alphabet) {
        if (c === r[i]) continue;
        const typo = r.slice(0, i) + c + r.slice(i + 1);
        assert.equal(readReference(typo), null, `${r} → ${typo}`);
      }
    }
  }
  const r = makeReference(32 + 1); // body ends "…011": has 0 and 1 in it
  assert.ok(/[01]/.test(r));
  assert.equal(readReference(r.toLowerCase()), 33);
  assert.equal(readReference(` ${r} `), 33);
  assert.equal(readReference("LVP" + r.slice(3).replace(/0/g, "O").replace(/1/g, "I")), 33);
  assert.equal(readReference("LVP" + r.slice(3).replace(/1/g, "l")), 33);
  assert.equal(readReference(r, "TW"), null);
  assert.equal(readReference("LVP"), null);
  assert.equal(readReference("LVP" + "0".repeat(30)), null);
  assert.equal(readReference("LVP0000000U"), null, "U isn't in the alphabet");
});

test("references are found in what banks hand back", () => {
  const r = makeReference(1234);
  assert.deepEqual(findReferences(`MBVCB.7654321.${r}.CT tu 0011004567890 NGUYEN VAN A toi 1023456789 CLB CAU LONG`), [r]);
  assert.deepEqual(findReferences(`nguyễn văn a ck ${r.toLowerCase()} hội phí`), [r]);
  assert.deepEqual(findReferences(`${r} ${r}`), [r]);
  assert.deepEqual(findReferences(`${makeReference(1)}/${makeReference(2)}`), [makeReference(1), makeReference(2)]);
  assert.deepEqual(findReferences("NGUYEN VAN A chuyen tien"), []);
  assert.deepEqual(findReferences("LVPBANK0001 chuyen tien"), [], "a word that only looks like one fails the check character");
  assert.deepEqual(findReferences(`X${r}`), [], "glued to other text: left to matchTransfer, which knows the open payments");
});

// ── Matching ────────────────────────────────────────────────────────────────

const open = (n: number, amount: number, paid = false): ExpectedPayment => ({ reference: makeReference(n), amount, paid });
const expected = [open(1, 50000), open(2, 50000), open(3, 1200000), open(4, 80000, true)];
const transfer = (note: string, amount: number, id = "t1") => ({ id, amount, note });

test("matched: the reference is there, the amount is exact, the payment is open", () => {
  assert.deepEqual(matchTransfer(transfer(`MBVCB.1.${makeReference(3)}.CT tu 001 toi 102`, 1200000), expected), { kind: "matched", reference: makeReference(3) });
  assert.deepEqual(matchTransfer(transfer(makeReference(1).toLowerCase(), 50000), expected), { kind: "matched", reference: makeReference(1) });
});

test("matched even when the bank breaks the reference up or glues it to its own text", () => {
  const r = makeReference(3);
  assert.deepEqual(matchTransfer(transfer(`${r.slice(0, 5)} ${r.slice(5, 8)}.${r.slice(8)}`, 1200000), expected), { kind: "matched", reference: r });
  assert.deepEqual(matchTransfer(transfer(`IBFT${r}NGUYENVANA`, 1200000), expected), { kind: "matched", reference: r });
});

test("a wrong amount is never matched: a person decides", () => {
  assert.deepEqual(matchTransfer(transfer(makeReference(3), 1000000), expected), { kind: "wrong_amount", reference: makeReference(3), expected: 1200000, difference: -200000 });
  assert.deepEqual(matchTransfer(transfer(makeReference(1), 500000), expected), { kind: "wrong_amount", reference: makeReference(1), expected: 50000, difference: 450000 });
  // The classic slip between currencies: 50,000 dong is not 5,000,000 "cents".
  assert.equal(matchTransfer(transfer(makeReference(1), 5000000), expected).kind, "wrong_amount");
});

test("a payment already paid isn't paid again", () => {
  assert.deepEqual(matchTransfer(transfer(makeReference(4), 80000), expected), { kind: "already_paid", reference: makeReference(4) });
});

test("two payments named in one transfer: ambiguous", () => {
  assert.deepEqual(matchTransfer(transfer(`${makeReference(1)} ${makeReference(2)}`, 100000), expected), { kind: "ambiguous", references: [makeReference(1), makeReference(2)] });
});

test("a well-formed reference that isn't this club's: unknown", () => {
  assert.deepEqual(matchTransfer(transfer(makeReference(999), 50000), expected), { kind: "unknown_reference", reference: makeReference(999) });
  // Another club's prefix means nothing here.
  assert.equal(matchTransfer(transfer(makeReference(1, "TW"), 50000), expected).kind, "no_reference");
});

test("no reference: never matched by amount alone, only hinted", () => {
  assert.deepEqual(matchTransfer(transfer("NGUYEN VAN A chuyen tien", 50000), expected), { kind: "no_reference", sameAmount: [makeReference(1), makeReference(2)] });
  assert.deepEqual(matchTransfer(transfer("NGUYEN VAN A chuyen tien", 1200000), expected), { kind: "no_reference", sameAmount: [makeReference(3)] }, "even a unique amount is only a hint");
  assert.deepEqual(matchTransfer(transfer("", 80000), expected), { kind: "no_reference", sameAmount: [] }, "paid payments aren't hinted");
  // A mistyped reference fails its check character, so it can't land on someone else's payment.
  const typo = makeReference(1).slice(0, -1) + (makeReference(1).endsWith("Z") ? "Y" : "Z");
  assert.equal(matchTransfer(transfer(typo, 50000), expected).kind, "no_reference");
});

test("a batch: replayed transfers and second transfers never pay twice", () => {
  const batch = [
    transfer(makeReference(1), 50000, "a"),
    transfer(makeReference(1), 50000, "a"), // the bank feed delivered it twice
    transfer(makeReference(1), 50000, "b"), // the member really did pay twice
    transfer(makeReference(3), 1200000, "c"),
    transfer("no note", 50000, "d"),
  ];
  const kinds = (out: ReturnType<typeof matchTransfers>) => out.map((o) => o.match.kind);
  const first = matchTransfers(batch, expected);
  assert.deepEqual(kinds(first), ["matched", "duplicate_transfer", "already_paid", "matched", "no_reference"]);
  // Open payment 2 is still hinted for the unreferenced 50,000; payment 1 no longer is.
  assert.deepEqual(first[4].match, { kind: "no_reference", sameAmount: [makeReference(2)] });
  assert.equal(expected[0].paid, false, "the caller's list isn't changed");

  // Out of order gives the same payments paid, once each.
  const reversed = matchTransfers([...batch].reverse(), expected);
  assert.deepEqual(reversed.filter((o) => o.match.kind === "matched").map((o) => (o.match as { reference: string }).reference).sort(), [makeReference(1), makeReference(3)].sort());

  // The whole batch again, after it was stored: nothing new happens.
  const again = matchTransfers(batch, expected.map((p) => ({ ...p, paid: p.paid || [makeReference(1), makeReference(3)].includes(p.reference) })), { alreadyProcessed: new Set(["a", "b", "c", "d"]) });
  assert.deepEqual(kinds(again), Array(5).fill("duplicate_transfer"));
});

test("a club's own prefix is honoured", () => {
  const mine = [{ reference: makeReference(5, "HNB"), amount: 70000, paid: false }];
  assert.deepEqual(matchTransfer(transfer(`ck ${makeReference(5, "HNB")}`, 70000), mine, "HNB"), { kind: "matched", reference: makeReference(5, "HNB") });
  assert.deepEqual(matchTransfers([transfer(makeReference(5, "HNB"), 70000)], mine, { prefix: "HNB" })[0].match, { kind: "matched", reference: makeReference(5, "HNB") });
});

// ── Accent folding (shared with search) ─────────────────────────────────────

test("accents fold away, composed or decomposed", () => {
  assert.equal(stripDiacritics("Nguyễn Thị Hương"), "Nguyen Thi Huong");
  assert.equal(stripDiacritics("Đặng Đức"), "Dang Duc");
  assert.equal(stripDiacritics("Nguyễn".normalize("NFD")), "Nguyen");
  assert.equal(foldForSearch("  NGUYỄN   văn A "), "nguyen van a");
  assert.equal(foldedIncludes("Nguyễn Thị Hương", "nguyen"), true);
  assert.equal(foldedIncludes("Nguyễn Thị Hương", "HUONG nguyen"), true);
  assert.equal(foldedIncludes("Nguyễn Thị Hương", "Nguyễn"), true);
  assert.equal(foldedIncludes("Nguyễn Thị Hương", "tran"), false);
  assert.equal(foldedIncludes("Nguyễn Thị Hương", "  "), false);
  // Every Vietnamese letter with every tone folds to a plain ASCII letter.
  const vowels = "aăâeêioôơuưy";
  const tones = ["", "̀", "́", "̉", "̃", "̣"];
  for (const v of vowels) for (const t of tones) for (const s of [v, v.toUpperCase()]) assert.match(stripDiacritics((s + t).normalize("NFC")), /^[A-Za-z]$/, s + t);
});
