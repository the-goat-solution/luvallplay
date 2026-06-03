import { sql } from "@vercel/postgres";
import { MAX_CASUAL } from "./constants";

export async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      date DATE PRIMARY KEY,
      max_spots INT NOT NULL DEFAULT ${MAX_CASUAL},
      booked_spots INT NOT NULL DEFAULT 0
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      session_date DATE NOT NULL REFERENCES sessions(date),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      payment_intent_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY,
      session_date DATE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS memberships (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      plan TEXT NOT NULL,
      stripe_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

export async function ensureSession(date: string) {
  await sql`
    INSERT INTO sessions (date, max_spots, booked_spots)
    VALUES (${date}, ${MAX_CASUAL}, 0)
    ON CONFLICT (date) DO NOTHING;
  `;
}

export async function getAvailableSpots(date: string): Promise<number> {
  await ensureSession(date);
  const { rows } = await sql`
    SELECT max_spots, booked_spots FROM sessions WHERE date = ${date};
  `;
  if (!rows[0]) return MAX_CASUAL;
  const row = rows[0] as { max_spots: number; booked_spots: number };
  return Math.max(0, row.max_spots - row.booked_spots);
}

export async function reserveBookingSlot(
  date: string,
  booking: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    paymentIntentId: string;
  },
): Promise<boolean> {
  await ensureSession(date);
  const { rowCount } = await sql`
    UPDATE sessions
    SET booked_spots = booked_spots + 1
    WHERE date = ${date} AND booked_spots < max_spots;
  `;
  if (!rowCount) return false;

  await sql`
    INSERT INTO bookings (session_date, first_name, last_name, email, phone, payment_intent_id, status)
    VALUES (
      ${date},
      ${booking.firstName},
      ${booking.lastName},
      ${booking.email},
      ${booking.phone ?? null},
      ${booking.paymentIntentId},
      'confirmed'
    )
    ON CONFLICT (payment_intent_id) DO NOTHING;
  `;
  return true;
}
