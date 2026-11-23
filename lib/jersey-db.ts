import { db, sql } from "./database";
import { ensureTables } from "./db";
import { ensureFinanceTables, createManualEntry, deleteManualEntry } from "./finance-db";
import { matchBankLine, MatchError } from "./bank-db";
import {
  EARLY_BIRD_HOLD_HOURS,
  EARLY_BIRD_LIMIT,
  findRefCodes,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  priceCents,
  type JerseyStatus,
} from "./jersey";
import { generateRefCode } from "./jersey-server";
import { onceThisDeploy } from "./schema-gate";

export type JerseyRegistration = {
  id: number;
  // Null for entries the admin added as free: no code, no payment.
  refCode: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  size: string;
  printName: string | null;
  printNumber: number | null;
  printCountry: string | null;
  priceCents: number;
  earlyBird: boolean;
  status: JerseyStatus;
  paidCents: number | null;
  paidAt: string | null;
  paidBy: "auto" | "admin" | "free" | null;
  flags: string[];
  lang: "en" | "vi";
  expiresAt: string | null;
  createdAt: string;
};

let ensurePromise: Promise<void> | null = null;

export function ensureJerseyTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = onceThisDeploy("jersey", async () => {
      await ensureTables();
      await sql`
        CREATE TABLE IF NOT EXISTS jersey_registrations (
          id SERIAL PRIMARY KEY,
          ref_code TEXT NOT NULL UNIQUE,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          email TEXT NOT NULL,
          email_normalized TEXT NOT NULL,
          phone TEXT NOT NULL,
          phone_normalized TEXT NOT NULL,
          name_normalized TEXT NOT NULL,
          size TEXT NOT NULL,
          print_name TEXT,
          print_number INT,
          price_cents INT NOT NULL,
          early_bird BOOLEAN NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'paid', 'released', 'cancelled')),
          paid_cents INT,
          paid_at TIMESTAMPTZ,
          paid_by TEXT,
          bank_txn_id INT,
          entry_id INT,
          ip_hash TEXT,
          device_id TEXT,
          flags TEXT[] NOT NULL DEFAULT '{}',
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
      await sql`ALTER TABLE jersey_registrations ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'en';`;
      await sql`ALTER TABLE jersey_registrations ADD COLUMN IF NOT EXISTS print_country TEXT;`;
      // Free entries added by an admin have no reference code (the UNIQUE
      // constraint still allows many NULLs).
      await sql`ALTER TABLE jersey_registrations ALTER COLUMN ref_code DROP NOT NULL;`;
      // The database itself enforces one live registration per person, so
      // two near-simultaneous submissions can't both get in.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS jersey_one_per_email
        ON jersey_registrations (email_normalized) WHERE status IN ('pending', 'paid');
      `;
    }).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

type Row = Record<string, unknown>;

function toReg(r: Row): JerseyRegistration {
  const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);
  return {
    id: r.id as number,
    refCode: (r.ref_code as string | null) ?? null,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    email: r.email as string,
    phone: r.phone as string,
    size: r.size as string,
    printName: (r.print_name as string | null) ?? null,
    printNumber: (r.print_number as number | null) ?? null,
    printCountry: (r.print_country as string | null) ?? null,
    priceCents: r.price_cents as number,
    earlyBird: r.early_bird as boolean,
    status: r.status as JerseyStatus,
    paidCents: (r.paid_cents as number | null) ?? null,
    paidAt: iso(r.paid_at),
    paidBy: (r.paid_by as "auto" | "admin" | "free" | null) ?? null,
    flags: (r.flags as string[]) ?? [],
    lang: r.lang === "vi" ? "vi" : "en",
    expiresAt: iso(r.expires_at),
    createdAt: iso(r.created_at)!,
  };
}

// Unpaid early birds past their 48 hours go back to the pool.
export async function releaseExpired(): Promise<number> {
  await ensureJerseyTables();
  const { rowCount } = await sql`
    UPDATE jersey_registrations SET status = 'released'
    WHERE status = 'pending' AND early_bird AND expires_at IS NOT NULL AND expires_at < NOW();
  `;
  return rowCount ?? 0;
}

export async function earlyBirdsLeft(): Promise<number> {
  await releaseExpired();
  const { rows } = await sql`
    SELECT COUNT(*)::int AS n FROM jersey_registrations
    WHERE early_bird AND status IN ('pending', 'paid');
  `;
  return Math.max(0, EARLY_BIRD_LIMIT - (rows[0].n as number));
}

export type RegisterInput = {
  firstName: string;
  lastName: string;
  email: string;
  emailNormalized: string;
  phone: string;
  phoneNormalized: string;
  nameNormalized: string;
  size: string;
  printName: string | null;
  printNumber: number | null;
  printCountry: string | null;
  ipHash: string | null;
  deviceId: string | null;
  lang: "en" | "vi";
};

export type RegisterResult =
  | { ok: true; registration: JerseyRegistration }
  | { ok: false; reason: "duplicate_email"; refCode: string };

export async function registerJersey(input: RegisterInput): Promise<RegisterResult> {
  await releaseExpired();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // One registration at a time, so the "first 10" can't be oversold when
    // dozens of people hit the form the moment it opens.
    await client.query("SELECT pg_advisory_xact_lock(7340211)");

    const dupe = await client.query(
      `SELECT ref_code FROM jersey_registrations
       WHERE email_normalized = $1 AND status IN ('pending', 'paid') LIMIT 1;`,
      [input.emailNormalized],
    );
    if (dupe.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "duplicate_email", refCode: (dupe.rows[0].ref_code as string | null) ?? "" };
    }

    const { rows: counts } = await client.query(
      `SELECT COUNT(*)::int AS n FROM jersey_registrations WHERE early_bird AND status IN ('pending', 'paid');`,
    );
    const earlyBird = (counts[0].n as number) < EARLY_BIRD_LIMIT;
    const price = priceCents(earlyBird, input.printName !== null);

    const { rows: similar } = await client.query(
      `SELECT
         BOOL_OR($1::text IS NOT NULL AND ip_hash = $1) AS same_ip,
         BOOL_OR($2::text IS NOT NULL AND device_id = $2) AS same_device,
         BOOL_OR(phone_normalized = $3) AS same_phone,
         BOOL_OR(name_normalized = $4) AS same_name
       FROM jersey_registrations WHERE status IN ('pending', 'paid');`,
      [input.ipHash, input.deviceId, input.phoneNormalized, input.nameNormalized],
    );
    const flags: string[] = [];
    const s = similar[0] ?? {};
    if (s.same_ip) flags.push("same_ip");
    if (s.same_device) flags.push("same_device");
    if (s.same_phone) flags.push("same_phone");
    if (s.same_name) flags.push("same_name");

    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateRefCode();
      await client.query("SAVEPOINT ins");
      try {
        const { rows } = await client.query(
          `INSERT INTO jersey_registrations
             (ref_code, first_name, last_name, email, email_normalized, phone, phone_normalized,
              name_normalized, size, print_name, print_number, price_cents, early_bird,
              ip_hash, device_id, flags, lang, print_country, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$18,$19,
             CASE WHEN $13 THEN NOW() + ($17 || ' hours')::interval ELSE NULL END)
           RETURNING *;`,
          [
            code, input.firstName, input.lastName, input.email, input.emailNormalized, input.phone,
            input.phoneNormalized, input.nameNormalized, input.size, input.printName, input.printNumber,
            price, earlyBird, input.ipHash, input.deviceId, flags, String(EARLY_BIRD_HOLD_HOURS), input.lang, input.printCountry,
          ],
        );
        await client.query("COMMIT");
        return { ok: true, registration: toReg(rows[0]) };
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT ins");
        // Code collision: try another one. Anything else is a real error.
        if ((err as { constraint?: string }).constraint !== "jersey_registrations_ref_code_key") throw err;
      }
    }
    throw new Error("Could not allocate a reference code");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listJerseyRegistrations(): Promise<JerseyRegistration[]> {
  await releaseExpired();
  const { rows } = await sql`SELECT * FROM jersey_registrations ORDER BY created_at ASC, id ASC;`;
  return rows.map(toReg);
}

export async function getJerseyRegistration(id: number): Promise<JerseyRegistration | null> {
  await ensureJerseyTables();
  const { rows } = await sql`SELECT * FROM jersey_registrations WHERE id = ${id};`;
  return rows[0] ? toReg(rows[0]) : null;
}

export type AdminJerseyInput = JerseyEdit & {
  // "code": a normal pending entry with a reference code to pay against.
  // "free": confirmed straight away, no code and no payment ($0).
  payment: "code" | "free";
  // Price tier for a coded entry: by early-bird count, or forced.
  priceMode: "auto" | "early" | "standard";
  lang: "en" | "vi";
};

// Adds an entry on an admin's behalf. Same one-live-registration-per-email
// rule as the public form, but no duplicate flags and no 48-hour hold (the
// admin is in charge of chasing it). Free entries never count toward the
// early-bird ten.
export async function createJerseyByAdmin(
  input: AdminJerseyInput,
): Promise<{ ok: true; registration: JerseyRegistration } | { ok: false; reason: "duplicate_email" }> {
  await releaseExpired();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7340211)");

    const emailNormalized = normalizeEmail(input.email);
    const dupe = await client.query(
      `SELECT 1 FROM jersey_registrations WHERE email_normalized = $1 AND status IN ('pending', 'paid') LIMIT 1;`,
      [emailNormalized],
    );
    if (dupe.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "duplicate_email" };
    }

    const free = input.payment === "free";
    let earlyBird = false;
    if (!free) {
      if (input.priceMode === "early") earlyBird = true;
      else if (input.priceMode === "auto") {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS n FROM jersey_registrations WHERE early_bird AND status IN ('pending', 'paid');`,
        );
        earlyBird = (rows[0].n as number) < EARLY_BIRD_LIMIT;
      }
    }
    const price = free ? 0 : priceCents(earlyBird, input.printName !== null);

    const values = (code: string | null) => [
      code, input.firstName, input.lastName, input.email, emailNormalized, input.phone,
      normalizePhone(input.phone), normalizeName(input.firstName, input.lastName), input.size,
      input.printName, input.printNumber, input.printCountry, price, earlyBird,
      free ? "paid" : "pending", free ? 0 : null, free ? "free" : null, input.lang,
    ];
    const insert = `INSERT INTO jersey_registrations
      (ref_code, first_name, last_name, email, email_normalized, phone, phone_normalized, name_normalized,
       size, print_name, print_number, print_country, price_cents, early_bird, status, paid_cents, paid_by, lang, paid_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, ${free ? "NOW()" : "NULL"})
      RETURNING *;`;

    if (free) {
      const { rows } = await client.query(insert, values(null));
      await client.query("COMMIT");
      return { ok: true, registration: toReg(rows[0]) };
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      await client.query("SAVEPOINT ins");
      try {
        const { rows } = await client.query(insert, values(generateRefCode()));
        await client.query("COMMIT");
        return { ok: true, registration: toReg(rows[0]) };
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT ins");
        if ((err as { constraint?: string }).constraint !== "jersey_registrations_ref_code_key") throw err;
      }
    }
    throw new Error("Could not allocate a reference code");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type JerseyEdit = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  size: string;
  printName: string | null;
  printNumber: number | null;
  printCountry: string | null;
};

// Admin edit of a registration's details. The search keys (normalised email,
// phone, name) are recomputed, and the price follows the printing option
// (early-bird or standard base, plus the print fee). Paid amounts and status
// are left alone. Another live registration with the same email is refused.
export async function updateJerseyRegistration(
  id: number,
  e: JerseyEdit,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "duplicate_email" }> {
  await ensureJerseyTables();
  const { rows: cur } = await sql`SELECT early_bird, paid_by FROM jersey_registrations WHERE id = ${id};`;
  if (!cur[0]) return { ok: false, reason: "not_found" };
  // A free entry stays free whatever the printing option.
  const price = cur[0].paid_by === "free" ? 0 : priceCents(cur[0].early_bird as boolean, e.printName !== null);
  try {
    await sql`
      UPDATE jersey_registrations SET
        first_name = ${e.firstName}, last_name = ${e.lastName},
        email = ${e.email}, email_normalized = ${normalizeEmail(e.email)},
        phone = ${e.phone}, phone_normalized = ${normalizePhone(e.phone)},
        name_normalized = ${normalizeName(e.firstName, e.lastName)},
        size = ${e.size}, print_name = ${e.printName}, print_number = ${e.printNumber},
        print_country = ${e.printCountry}, price_cents = ${price}
      WHERE id = ${id};
    `;
  } catch (err) {
    if ((err as { constraint?: string }).constraint === "jersey_one_per_email") {
      return { ok: false, reason: "duplicate_email" };
    }
    throw err;
  }
  return { ok: true };
}

export async function markJerseyPaid(id: number, paidCents: number | null): Promise<boolean> {
  await ensureJerseyTables();
  const { rowCount } = await sql`
    UPDATE jersey_registrations
    SET status = 'paid', paid_by = 'admin', paid_at = NOW(),
        paid_cents = COALESCE(${paidCents}, price_cents), expires_at = NULL
    WHERE id = ${id} AND status IN ('pending', 'released');
  `;
  return Boolean(rowCount);
}

export async function markJerseyUnpaid(id: number): Promise<boolean> {
  await ensureJerseyTables();
  const { rowCount } = await sql`
    UPDATE jersey_registrations
    SET status = 'pending', paid_by = NULL, paid_at = NULL, paid_cents = NULL, expires_at = NULL
    WHERE id = ${id} AND status = 'paid' AND bank_txn_id IS NULL AND paid_by IS DISTINCT FROM 'free';
  `;
  return Boolean(rowCount);
}

export async function setJerseyStatus(id: number, status: "cancelled" | "released"): Promise<boolean> {
  await ensureJerseyTables();
  const { rowCount } = await sql`
    UPDATE jersey_registrations SET status = ${status}
    WHERE id = ${id} AND (status IN ('pending', 'released') OR (${status} = 'cancelled' AND paid_by = 'free'));
  `;
  return Boolean(rowCount);
}

export type PaidNotice = { registration: JerseyRegistration; paidCents: number };

// Reads the bank feed for payments carrying a registration's 5-digit code.
// Paid in full (or more — the extra is a donation to club funds) → the
// registration is marked paid and the money is booked to the ledger and
// reconciled against the bank line. Less than the price → flagged for the
// admin, never paid automatically.
export async function matchJerseyPayments(): Promise<{ paid: PaidNotice[]; underpaid: number }> {
  await ensureJerseyTables();
  await ensureFinanceTables();
  const { rows: lines } = await sql`
    SELECT id, txn_date::text AS d, description, reference, amount_cents
    FROM bank_transactions WHERE status = 'unmatched' AND amount_cents > 0
    ORDER BY txn_date ASC, id ASC;
  `;
  const paid: PaidNotice[] = [];
  let underpaid = 0;

  for (const line of lines) {
    const text = `${line.description ?? ""} ${line.reference ?? ""}`;
    const codes = findRefCodes(text);
    if (codes.length === 0) continue;
    const { rows } = await sql.query(
      `SELECT * FROM jersey_registrations WHERE ref_code = ANY($1::text[]) AND status = 'pending';`,
      [codes],
    );
    if (rows.length !== 1) continue; // none, or ambiguous — leave to a human
    const reg = toReg(rows[0]);
    const amount = Number(line.amount_cents);

    if (amount < reg.priceCents) {
      if (!reg.flags.includes("underpaid")) {
        await sql`UPDATE jersey_registrations SET flags = array_append(flags, 'underpaid') WHERE id = ${reg.id};`;
        underpaid++;
      }
      continue;
    }

    const extra = amount - reg.priceCents;
    let entryId: number | null = null;
    try {
      entryId = await createManualEntry({
        kind: "received",
        name: `Club jersey — ${reg.firstName} ${reg.lastName} (${reg.refCode ?? ""})`,
        category: "merchandise",
        method: "bank_transfer",
        person: `${reg.firstName} ${reg.lastName}`,
        entryDate: line.d as string,
        amountCents: amount,
        notes: extra > 0 ? `Includes $${(extra / 100).toFixed(2)} over the price, kept as club funds.` : null,
      });
      await matchBankLine(line.id as number, [entryId], {
        auto: true,
        reason: `Jersey code ${reg.refCode ?? ""}`,
      });
    } catch (err) {
      if (entryId !== null) await deleteManualEntry(entryId).catch(() => {});
      if (err instanceof MatchError) continue;
      throw err;
    }
    const { rowCount } = await sql`
      UPDATE jersey_registrations
      SET status = 'paid', paid_by = 'auto', paid_at = NOW(), paid_cents = ${amount},
          bank_txn_id = ${line.id as number}, entry_id = ${entryId}, expires_at = NULL
      WHERE id = ${reg.id} AND status = 'pending';
    `;
    if (rowCount) paid.push({ registration: { ...reg, status: "paid", paidCents: amount }, paidCents: amount });
  }
  return { paid, underpaid };
}

// Match jersey payments, then tell each person their payment landed. Safe
// to call after any bank import: it never throws, so a jersey problem can't
// break the bank sync that called it.
export async function matchAndNotifyJersey(): Promise<number> {
  if (!process.env.POSTGRES_URL) return 0;
  try {
    const { paid } = await matchJerseyPayments();
    for (const n of paid) {
      try {
        const { sendJerseyPaidEmail } = await import("./email");
        await sendJerseyPaidEmail({
          to: n.registration.email,
          firstName: n.registration.firstName,
          refCode: n.registration.refCode ?? "",
          paidCents: n.paidCents,
          priceCents: n.registration.priceCents,
          lang: n.registration.lang,
        });
      } catch (err) {
        console.error("Jersey paid email failed", n.registration.id, err);
      }
    }
    return paid.length;
  } catch (err) {
    console.error("Jersey payment matching failed", err);
    return 0;
  }
}
