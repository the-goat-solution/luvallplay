import { createPool } from "@vercel/postgres";

const pool = createPool({ connectionString: process.env.POSTGRES_URL });

async function main() {
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL is required");
    process.exit(1);
  }

  await pool.sql`
    CREATE TABLE IF NOT EXISTS sessions (
      date DATE PRIMARY KEY,
      max_spots INT NOT NULL DEFAULT 8,
      booked_spots INT NOT NULL DEFAULT 0
    );
  `; // DEFAULT must be literal (no bind params in DDL)
  await pool.sql`
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
  await pool.sql`
    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY,
      session_date DATE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await pool.sql`
    CREATE TABLE IF NOT EXISTS memberships (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      plan TEXT NOT NULL,
      stripe_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await pool.sql`
    CREATE TABLE IF NOT EXISTS donations (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      amount_cents INT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'once',
      stripe_payment_intent_id TEXT UNIQUE,
      stripe_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await pool.sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS google_event_id TEXT;
  `;
  await pool.sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS calendar_summary TEXT;
  `;
  await pool.sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS event_start_time TIMESTAMPTZ;
  `;
  await pool.sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS event_end_time TIMESTAMPTZ;
  `;
  await pool.sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS event_location TEXT;
  `;
  await pool.sql`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
  `;
  await pool.sql`
    CREATE TABLE IF NOT EXISTS session_alert_state (
      session_date DATE PRIMARY KEY REFERENCES sessions(date),
      state TEXT NOT NULL DEFAULT 'ok',
      headcount INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  console.log("Database tables ready.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
