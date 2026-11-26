// VietQR: the code a member scans in their banking app to pay a club by bank
// transfer, with the amount and the payment reference already filled in
// (build plan §6.5, §11.4 decision X; test plan §3.16).
//
// Pure: no I/O. This file builds and reads the code's text; drawing it as a
// picture belongs to the screen that shows it. Matching incoming transfers to
// references is in ./vietqr-match.ts.
//
// The format is NAPAS's VietQR profile of the EMVCo merchant-presented QR
// specification: a list of fields, each "id (2 digits) + length (2 digits) +
// value", ending with a CRC-16 of everything before it.
//
//   00  payload format, always "01"
//   01  "11" a code used many times (no amount), "12" a code for one payment
//   38  the receiving account:
//         00  "A000000727" (NAPAS)
//         01  00 the bank's BIN (6 digits), 01 the account or card number
//         02  "QRIBFTTA" transfer to an account, "QRIBFTTC" to a card
//   53  currency, always "704" (VND)
//   54  amount in whole dong (VND has no smaller unit)
//   58  country, always "VN"
//   59  account holder's name, 60 city (both optional)
//   62  additional data: 08 the transfer note, where the reference goes
//   63  CRC-16/CCITT-FALSE over everything up to and including "6304"
//
// Not verified against NAPAS's own specification document, which isn't
// public: the layout follows the widely published profile and the example
// in tests/vietqr.test.ts, whose checksum this code reproduces. Before the
// first Vietnamese club, scan generated codes with several banks' real apps
// (the V gate).

import type { PaymentCapabilities } from "./payments.ts";
import { stripDiacritics } from "./text-fold.ts";

export const VIETQR_GUID = "A000000727";
export const VND_NUMERIC = "704";

/** What a VietQR bank transfer can and can't do, for the payments interface (§6.5). */
export const VIETQR_CAPABILITIES: PaymentCapabilities = {
  clientConfirmation: false,
  qr: true,
  // A bank transfer is always started by the payer: renewals are reminders with a new code.
  recurring: false,
  // Money goes straight into the club's own account; the club refunds from its bank.
  refunds: false,
  partialRefunds: false,
  // The bank doesn't tell us: transfers are matched by hand or from a bank feed.
  webhooks: false,
  payoutStatus: false,
  currencies: ["VND"],
};

/**
 * NAPAS bank identification numbers for the larger banks, so a club picks its
 * bank by name. Any six-digit BIN is accepted by buildVietQR: this list is a
 * convenience, not a gate. **Check** it against NAPAS's published member list
 * before launch.
 */
export const VIETQR_BANKS = [
  { bin: "970436", code: "VCB", name: "Vietcombank" },
  { bin: "970415", code: "ICB", name: "VietinBank" },
  { bin: "970418", code: "BIDV", name: "BIDV" },
  { bin: "970405", code: "VBA", name: "Agribank" },
  { bin: "970407", code: "TCB", name: "Techcombank" },
  { bin: "970422", code: "MB", name: "MB Bank" },
  { bin: "970416", code: "ACB", name: "ACB" },
  { bin: "970432", code: "VPB", name: "VPBank" },
  { bin: "970423", code: "TPB", name: "TPBank" },
  { bin: "970403", code: "STB", name: "Sacombank" },
  { bin: "970437", code: "HDB", name: "HDBank" },
  { bin: "970441", code: "VIB", name: "VIB" },
  { bin: "970443", code: "SHB", name: "SHB" },
  { bin: "970431", code: "EIB", name: "Eximbank" },
  { bin: "970426", code: "MSB", name: "MSB" },
  { bin: "970448", code: "OCB", name: "OCB" },
  { bin: "970440", code: "SEAB", name: "SeABank" },
  { bin: "970449", code: "LPB", name: "LPBank" },
] as const;

export type VietQRInput = {
  /** The receiving bank's NAPAS BIN: six digits. */
  bankBin: string;
  /** The receiving account number (or card number with `toCard`). Letters and digits only. */
  account: string;
  /** Whole dong. Omit for a code the payer types the amount into. */
  amount?: number;
  /** The transfer note: the payment reference. Accents are removed, because banks drop them. */
  note?: string;
  /** Shown by some banking apps. The bank still shows the real account holder before the payer confirms. */
  accountName?: string;
  city?: string;
  /** The number is a card number, not an account number. */
  toCard?: boolean;
};

/** The longest transfer note every bank passes through unshortened. */
export const VIETQR_NOTE_MAX = 50;
const AMOUNT_MAX = 9_999_999_999_999; // 13 digits, the field's limit

export class VietQRError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VietQRError";
  }
}

const tlv = (id: string, value: string): string => {
  if (value.length === 0 || value.length > 99) throw new VietQRError(`Field ${id} must be 1 to 99 characters`);
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
};

/** CRC-16/CCITT-FALSE (polynomial 0x1021, start 0xFFFF), as four upper-case hex digits. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) throw new VietQRError("Only plain ASCII can be checksummed");
    crc ^= code << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * What a bank keeps of a transfer note: no accents, and only letters, digits,
 * spaces and a few safe marks. "Phí tháng 12 – Nguyễn" → "Phi thang 12 Nguyen".
 */
export function vietQRNote(note: string): string {
  return stripDiacritics(note)
    .replace(/[^A-Za-z0-9 .\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The text of a VietQR code. Throws VietQRError on anything a bank would refuse. */
export function buildVietQR(input: VietQRInput): string {
  if (!/^\d{6}$/.test(input.bankBin)) throw new VietQRError("The bank BIN is six digits");
  const account = input.account.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9]{1,19}$/.test(account)) throw new VietQRError("The account number is 1 to 19 letters and digits");

  const hasAmount = input.amount !== undefined;
  if (hasAmount && (!Number.isSafeInteger(input.amount) || input.amount! <= 0 || input.amount! > AMOUNT_MAX)) {
    throw new VietQRError("The amount is a positive whole number of dong");
  }

  const note = input.note === undefined ? "" : vietQRNote(input.note);
  if (input.note !== undefined && note.length === 0) throw new VietQRError("The transfer note has nothing a bank would keep");
  if (note.length > VIETQR_NOTE_MAX) throw new VietQRError(`The transfer note is at most ${VIETQR_NOTE_MAX} characters`);

  const beneficiary = tlv("00", input.bankBin) + tlv("01", account);
  const merchantAccount = tlv("00", VIETQR_GUID) + tlv("01", beneficiary) + tlv("02", input.toCard ? "QRIBFTTC" : "QRIBFTTA");

  let out = tlv("00", "01") + tlv("01", hasAmount ? "12" : "11") + tlv("38", merchantAccount) + tlv("53", VND_NUMERIC);
  if (hasAmount) out += tlv("54", String(input.amount));
  out += tlv("58", "VN");
  if (input.accountName) out += tlv("59", vietQRNote(input.accountName).toUpperCase().slice(0, 25));
  if (input.city) out += tlv("60", vietQRNote(input.city).toUpperCase().slice(0, 15));
  if (note) out += tlv("62", tlv("08", note));
  out += "6304";
  return out + crc16(out);
}

export type ParsedVietQR = {
  bankBin: string;
  account: string;
  toCard: boolean;
  /** Whole dong, or null for a code without an amount. */
  amount: number | null;
  note: string | null;
  accountName: string | null;
  city: string | null;
  /** True for a code made for one payment (field 01 is "12"). */
  oneTime: boolean;
};

function readFields(text: string, where: string): Map<string, string> {
  const fields = new Map<string, string>();
  let i = 0;
  while (i < text.length) {
    const head = text.slice(i, i + 4);
    if (!/^\d{4}$/.test(head)) throw new VietQRError(`${where}: a field header isn't four digits`);
    const id = head.slice(0, 2);
    const length = Number(head.slice(2));
    const value = text.slice(i + 4, i + 4 + length);
    if (value.length !== length) throw new VietQRError(`${where}: field ${id} is cut short`);
    if (fields.has(id)) throw new VietQRError(`${where}: field ${id} appears twice`);
    fields.set(id, value);
    i += 4 + length;
  }
  return fields;
}

/**
 * Reads a VietQR code's text back, checking the checksum and that it is a
 * dong transfer through NAPAS. Throws VietQRError otherwise.
 */
export function parseVietQR(payload: string): ParsedVietQR {
  const text = payload.trim();
  const tail = /6304([0-9A-Fa-f]{4})$/.exec(text);
  if (!tail) throw new VietQRError("The code doesn't end with a checksum");
  if (crc16(text.slice(0, -4)) !== tail[1].toUpperCase()) throw new VietQRError("The checksum doesn't match");

  const top = readFields(text, "code");
  if (top.get("00") !== "01") throw new VietQRError("Not a version 01 code");
  const merchant = top.get("38");
  if (!merchant) throw new VietQRError("No receiving account (field 38)");
  const account = readFields(merchant, "field 38");
  if (account.get("00") !== VIETQR_GUID) throw new VietQRError("Not a NAPAS VietQR code");
  const beneficiary = readFields(account.get("01") ?? "", "field 38-01");
  const bankBin = beneficiary.get("00") ?? "";
  const number = beneficiary.get("01") ?? "";
  if (!/^\d{6}$/.test(bankBin) || !number) throw new VietQRError("No bank or account number");
  const service = account.get("02");
  if (service !== "QRIBFTTA" && service !== "QRIBFTTC") throw new VietQRError("Not a transfer code");
  if (top.get("53") !== VND_NUMERIC) throw new VietQRError("Not in dong");
  if (top.get("58") !== "VN") throw new VietQRError("Not a Vietnamese code");

  const amountText = top.get("54");
  if (amountText !== undefined && !/^[1-9]\d{0,12}$/.test(amountText)) throw new VietQRError("The amount isn't whole dong");
  const extra = top.has("62") ? readFields(top.get("62")!, "field 62") : new Map<string, string>();
  return {
    bankBin,
    account: number,
    toCard: service === "QRIBFTTC",
    amount: amountText === undefined ? null : Number(amountText),
    note: extra.get("08") ?? null,
    accountName: top.get("59") ?? null,
    city: top.get("60") ?? null,
    oneTime: top.get("01") === "12",
  };
}
