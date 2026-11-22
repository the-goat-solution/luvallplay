-- A small copy of the club database for data-guard tests. Table definitions
-- are copied from the app (lib/player-db.ts, lib/stats-db.ts, lib/photos-db.ts,
-- lib/messages-db.ts, lib/shop-db.ts, lib/arena-db.ts, scripts/migrate.mjs),
-- trimmed to the columns that matter for access and personal data.
-- Seed data is deterministic and covers the awkward cases on purpose:
-- mixed-case/padded emails, deleted accounts, expired sessions, memberships
-- and bookings with no account, verified phones, a table without a primary key.

CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone_e164 TEXT,
  phone_verified_at TIMESTAMPTZ,
  leaderboard_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT '2026-01-01T00:00:00Z',
  deleted_at TIMESTAMPTZ
);
CREATE TABLE player_sessions (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT '2026-11-01T00:00:00Z',
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE sessions (
  date DATE PRIMARY KEY,
  courts INT NOT NULL DEFAULT 2
);
CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  session_date DATE NOT NULL REFERENCES sessions(date),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  payment_intent_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE memberships (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  plan TEXT NOT NULL,
  day TEXT NOT NULL DEFAULT 'friday',
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  period_start DATE,
  period_end DATE
);
CREATE TABLE attendance (
  session_date DATE NOT NULL,
  email TEXT NOT NULL,
  source TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (session_date, email)
);
CREATE TABLE player_photos (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  consent_at TIMESTAMPTZ NOT NULL DEFAULT '2026-02-01T00:00:00Z'
);
CREATE TABLE message_threads (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  thread_id INT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE shop_orders (
  id SERIAL PRIMARY KEY,
  player_id INT REFERENCES players(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  total_cents INT NOT NULL
);
CREATE TABLE arena_challenges (
  id SERIAL PRIMARY KEY,
  p1 INT NOT NULL,
  p2 INT NOT NULL,
  a1 INT,
  a2 INT,
  status TEXT NOT NULL DEFAULT 'open',
  score_posting INT,
  score_accepting INT
);
CREATE TABLE finance_entries (
  id SERIAL PRIMARY KEY,
  entry_date DATE NOT NULL,
  kind TEXT NOT NULL,
  amount_cents INT NOT NULL,
  note TEXT
);
-- No primary key on purpose (exercises the sorted-set comparison).
CREATE TABLE legacy_notes (
  email TEXT,
  note TEXT NOT NULL
);

-- 200 accounts. Every 7th email is stored with capitals and spaces (the app
-- normalizes on sign-in), every 50th account is deleted, every 5th has a
-- verified phone.
INSERT INTO players (email, first_name, last_name, phone_e164, phone_verified_at, deleted_at)
SELECT CASE WHEN n % 7 = 0 THEN ' Player' || n || '@Example.TEST ' ELSE 'player' || n || '@example.test' END,
       'First' || n, 'Last' || n,
       CASE WHEN n % 5 = 0 THEN '+6421' || lpad(n::text, 6, '0') END,
       CASE WHEN n % 5 = 0 THEN '2026-03-01T00:00:00Z'::timestamptz END,
       CASE WHEN n % 50 = 0 THEN '2026-06-01T00:00:00Z'::timestamptz END
FROM generate_series(1, 200) n;

-- Two thirds signed in on a device (live for 60 days); the rest expired.
INSERT INTO player_sessions (player_id, token_hash, expires_at)
SELECT n, md5('session' || n), CASE WHEN n % 3 = 0 THEN now() - interval '5 days' ELSE now() + interval '60 days' END
FROM generate_series(1, 200) n;
INSERT INTO player_sessions (player_id, token_hash, expires_at)
SELECT n, md5('tablet' || n), now() + interval '30 days' FROM generate_series(1, 200, 11) n;

INSERT INTO sessions (date) SELECT d::date FROM generate_series('2026-09-04'::date, '2026-11-27'::date, interval '7 days') d;

-- Memberships link by email (sometimes typed differently from the account).
INSERT INTO memberships (email, plan, day, stripe_subscription_id, status, period_start, period_end)
SELECT CASE WHEN n % 4 = 0 THEN upper('player' || n || '@example.test') ELSE 'player' || n || '@example.test' END,
       CASE WHEN n % 3 = 0 THEN 'quarterly' ELSE 'monthly' END,
       CASE WHEN n % 2 = 0 THEN 'wednesday' ELSE 'friday' END,
       'sub_' || n,
       CASE WHEN n % 9 = 0 THEN 'cancelled' WHEN n % 13 = 0 THEN 'expired' ELSE 'active' END,
       '2026-10-01', '2026-10-28'
FROM generate_series(1, 120) n;
-- Paying members who never made an account (must surface as a warning).
INSERT INTO memberships (email, plan, status) VALUES ('no-account-1@example.test', 'monthly', 'active'), ('no-account-2@example.test', 'quarterly', 'active');

-- Casual bookings, including guests with no account.
INSERT INTO bookings (session_date, first_name, last_name, email, payment_intent_id, status)
SELECT s.date, 'First' || n, 'Last' || n, 'player' || n || '@example.test', 'pi_' || n || '_' || to_char(s.date, 'MMDD'),
       CASE WHEN n % 10 = 0 THEN 'cancelled' ELSE 'confirmed' END
FROM sessions s, generate_series(120, 160) n WHERE (n + extract(doy FROM s.date)::int) % 4 = 0;
INSERT INTO bookings (session_date, first_name, last_name, email, status)
SELECT date, 'Guest', 'Visitor', 'guest' || to_char(date, 'MMDD') || '@example.test', 'confirmed' FROM sessions;

INSERT INTO attendance (session_date, email, source)
SELECT s.date, 'player' || n || '@example.test', CASE WHEN n % 2 = 0 THEN 'board' ELSE 'admin' END
FROM sessions s, generate_series(1, 150) n WHERE (n + extract(doy FROM s.date)::int) % 3 = 0;

INSERT INTO player_photos (player_id, original_url, status)
SELECT n, 'https://blob.example/p' || n || '-' || k || '.jpg', CASE WHEN k = 1 THEN 'approved' ELSE 'pending' END
FROM generate_series(1, 200, 3) n, generate_series(1, 2) k;

INSERT INTO message_threads (player_id, subject) SELECT n, 'Question ' || n FROM generate_series(2, 200, 4) n;
INSERT INTO messages (thread_id, sender, body) SELECT t.id, s.sender, 'Hello from ' || s.sender FROM message_threads t, (VALUES ('player'), ('admin')) s(sender);

INSERT INTO shop_orders (player_id, email, status, payment_method, total_cents)
SELECT n, 'player' || n || '@example.test', CASE WHEN n % 3 = 0 THEN 'collected' ELSE 'paid' END, CASE WHEN n % 2 = 0 THEN 'cash' ELSE 'card' END, 3000
FROM generate_series(1, 200, 6) n;

INSERT INTO arena_challenges (p1, p2, a1, a2, status, score_posting, score_accepting)
SELECT n, n + 1, n + 2, n + 3, CASE WHEN n % 2 = 0 THEN 'confirmed' ELSE 'open' END, 21, 15 + n % 6
FROM generate_series(1, 190, 5) n;

INSERT INTO finance_entries (entry_date, kind, amount_cents, note)
SELECT '2026-09-01'::date + n, CASE WHEN n % 4 = 0 THEN 'expense' ELSE 'income' END, 1000 + n * 37, 'entry ' || n FROM generate_series(1, 80) n;

INSERT INTO legacy_notes (email, note) SELECT 'player' || n || '@example.test', 'note ' || n FROM generate_series(1, 30) n;
