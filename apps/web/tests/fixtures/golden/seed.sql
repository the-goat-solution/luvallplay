-- Golden master fixture: synthetic club data on the production schema
-- (applied after the migrations). Synthetic people only (test plan §7):
-- names and emails are made up, every email ends in .test.
--
-- Covers the awkward cases on purpose: mixed-case emails, a deleted account,
-- members without an account, expired and live sessions, guests, both play
-- days, paused days, past and future play days around "today".

-- People: 1 owner, 2 admin, 3 member (Mia), 4–24 players, 25 deleted.
INSERT INTO players (email, first_name, last_name, display_name, phone, phone_e164, phone_verified_at, lang, leaderboard_visible, minigame_name, created_via, claimed_at, welcome_sent_at, deleted_at)
SELECT
  CASE n WHEN 1 THEN 'olivia.owner@golden.test' WHEN 2 THEN 'adam.admin@golden.test' WHEN 3 THEN 'mia.member@golden.test' ELSE 'player' || n || '@golden.test' END,
  (ARRAY['Olivia','Adam','Mia','Pete','Quinn','Rua','Sione','Tama','Uma','Vic','Wiremu','Xia','Yuki','Zoe','Aroha','Ben','Cleo','Dan','Eru','Fern','Gus','Hana','Ivy','Jack','Kim'])[n],
  'Golden' || n,
  CASE WHEN n % 5 = 0 THEN 'Wolf ' || n END,
  CASE WHEN n % 3 = 0 THEN '021 555 ' || lpad(n::text, 4, '0') END,
  CASE WHEN n % 3 = 0 THEN '+6421555' || lpad(n::text, 4, '0') END,
  CASE WHEN n % 6 = 0 THEN now() - interval '30 days' END,
  CASE WHEN n % 4 = 0 THEN 'vi' ELSE 'en' END,
  n % 7 <> 0,
  CASE WHEN n BETWEEN 4 AND 12 THEN 'MG' || n END,
  CASE WHEN n % 2 = 0 THEN 'signup' ELSE 'member_import' END,
  CASE WHEN n % 8 <> 0 THEN now() - (n || ' days')::interval END,
  CASE WHEN n % 2 = 1 THEN now() - interval '20 days' END,
  CASE WHEN n = 25 THEN now() - interval '2 days' END
FROM generate_series(1, 25) n;

INSERT INTO club_roles (player_id, role) VALUES (1, 'owner'), (2, 'admin');
INSERT INTO platform_admins (player_id) VALUES (1);

INSERT INTO player_sessions (player_id, token_hash, user_agent, expires_at)
SELECT n, md5('golden-session-' || n), 'golden', now() + interval '60 days' FROM generate_series(1, 24) n;
INSERT INTO player_sessions (player_id, token_hash, user_agent, expires_at)
SELECT n, md5('golden-expired-' || n), 'golden', now() - interval '1 day' FROM generate_series(1, 24, 5) n;

INSERT INTO player_settings (key, value) VALUES ('sms_switch', 'off'), ('golden_flag', 'yes');

-- Play days: Wednesdays and Fridays from 5 weeks ago to 5 weeks ahead.
INSERT INTO sessions (date, max_spots, booked_spots, google_event_id, calendar_summary, event_start_time, event_end_time, event_location, courts, registration_locked, mini_game)
SELECT d::date, 16, (extract(doy FROM d)::int % 4),
  'golden-' || to_char(d, 'YYYYMMDD'),
  CASE WHEN extract(dow FROM d) = 5 THEN 'Friday badminton' ELSE 'Wednesday badminton' END,
  d::date + time '19:00', d::date + time '21:00', 'Pioneer Stadium',
  CASE WHEN extract(dow FROM d) = 5 THEN 4 ELSE 3 END,
  extract(doy FROM d)::int % 9 = 0,
  extract(dow FROM d) = 3 AND extract(doy FROM d)::int % 2 = 0
FROM generate_series(current_date - 35, current_date + 35, interval '1 day') d
WHERE extract(dow FROM d) IN (3, 5);

INSERT INTO session_alert_state (session_date, state, headcount)
SELECT date, 'ok', 10 FROM sessions WHERE date < current_date ORDER BY date LIMIT 3;

-- Memberships: Mia monthly Friday (live, recurring), others mixed.
INSERT INTO memberships (email, plan, first_name, last_name, phone, period_start, period_end, stripe_subscription_id, status, day, recurring, cancel_at_period_end, free_days_granted, renewal_token)
VALUES
  ('mia.member@golden.test', 'monthly', 'Mia', 'Golden3', '021 555 0003', current_date - 10, current_date + 18, 'sub_golden_mia', 'active', 'friday', TRUE, FALSE, 0, NULL),
  ('Player4@Golden.test', 'quarterly', 'Pete', 'Golden4', NULL, current_date - 40, current_date + 44, 'sub_golden_4', 'active', 'wednesday', TRUE, TRUE, 7, NULL),
  ('player5@golden.test', 'monthly', 'Quinn', 'Golden5', NULL, current_date - 20, current_date + 4, NULL, 'active', 'friday', FALSE, FALSE, 0, 'renew-golden-5'),
  ('player6@golden.test', 'monthly', 'Rua', 'Golden6', NULL, current_date - 60, current_date - 30, 'sub_golden_6', 'cancelled', 'friday', TRUE, FALSE, 0, NULL),
  ('player7@golden.test', 'monthly', 'Sione', 'Golden7', NULL, NULL, NULL, NULL, 'pending', 'wednesday', FALSE, FALSE, 0, NULL),
  ('no-account@golden.test', 'monthly', 'Nobody', 'Account', NULL, current_date - 5, current_date + 23, 'sub_golden_na', 'active', 'friday', TRUE, FALSE, 0, NULL),
  ('player8@golden.test', 'quarterly', 'Tama', 'Golden8', NULL, current_date - 80, current_date + 4, NULL, 'active', 'wednesday', FALSE, FALSE, 14, 'renew-golden-8');
UPDATE memberships SET stripe_payment_intent_id = 'pi_golden_m5' WHERE email = 'player5@golden.test';

INSERT INTO membership_reminders_sent (membership_id, session_date)
SELECT 1, date FROM sessions WHERE date < current_date AND extract(dow FROM date) = 5 ORDER BY date DESC LIMIT 2;

-- Casual bookings and guests.
INSERT INTO bookings (session_date, first_name, last_name, email, phone, payment_intent_id, status)
SELECT s.date, 'Guest' || g, 'Visitor', 'guest' || g || '@golden.test', NULL, 'pi_golden_' || to_char(s.date, 'MMDD') || '_' || g,
  CASE WHEN g = 3 THEN 'pending' ELSE 'confirmed' END
FROM sessions s, generate_series(1, 3) g
WHERE (extract(doy FROM s.date)::int + g) % 3 = 0;
INSERT INTO bookings (session_date, first_name, last_name, email, status)
SELECT date, 'Pete', 'Golden9', 'player9@golden.test', 'confirmed' FROM sessions WHERE date > current_date ORDER BY date LIMIT 2;

INSERT INTO waitlist (session_date, name, email)
SELECT date, 'Waiting ' || n, 'wait' || n || '@golden.test' FROM sessions, generate_series(1, 2) n WHERE date > current_date ORDER BY date LIMIT 4;

INSERT INTO session_fill_ins (session_date, membership_id, first_name, last_name, email)
SELECT date, 1, 'Fill', 'In', 'fill.in@golden.test' FROM sessions WHERE date > current_date AND extract(dow FROM date) = 5 ORDER BY date LIMIT 1;

-- Attendance (past days) and absences (future days).
INSERT INTO attendance (session_date, email, source, verified, removed)
SELECT s.date,
  CASE n WHEN 1 THEN 'olivia.owner@golden.test' WHEN 2 THEN 'adam.admin@golden.test' WHEN 3 THEN 'mia.member@golden.test' ELSE 'player' || n || '@golden.test' END,
  CASE WHEN n % 4 = 0 THEN 'board' ELSE 'admin' END,
  n % 11 <> 0, n = 13
FROM sessions s, generate_series(1, 24) n
WHERE s.date < current_date AND (n + extract(doy FROM s.date)::int) % 3 <> 0;

INSERT INTO player_absences (session_date, email)
SELECT date, 'mia.member@golden.test' FROM sessions WHERE date > current_date AND extract(dow FROM date) = 5 ORDER BY date LIMIT 1;

INSERT INTO day_signup_settings (day, paused) VALUES ('wednesday', FALSE), ('friday', FALSE), ('monday', TRUE);
INSERT INTO day_requests (day, name, email) VALUES ('monday', 'Monday Fan', 'monday@golden.test'), ('tuesday', 'Tue Fan', 'tue@golden.test');

-- Round robin results and the mini game draw.
INSERT INTO mini_game_draws (teams, matches, locked_until, archived_at)
VALUES ('[{"id":1,"players":["MG4","MG5"]},{"id":2,"players":["MG6","MG7"]}]', '[{"id":"m1","round":1,"number":1,"teamA":1,"teamB":2}]', now() - interval '7 days', now() - interval '7 days'),
       ('[{"id":1,"players":["MG8","MG9"]},{"id":2,"players":["MG10","MG11"]}]', '[{"id":"m1","round":1,"number":1,"teamA":1,"teamB":2}]', now() + interval '2 hours', NULL);
INSERT INTO mini_game_scores (draw_id, match_id, score_a, score_b) VALUES (1, 'm1', 21, 17);
INSERT INTO rr_results (draw_id, mg_name, session_date, team_id, wins, losses, points_for, points_against, rr_points, finish_place, teams_count)
SELECT 1, 'MG' || n, (SELECT max(date) FROM sessions WHERE date < current_date), CASE WHEN n < 6 THEN 1 ELSE 2 END,
  CASE WHEN n < 6 THEN 1 ELSE 0 END, CASE WHEN n < 6 THEN 0 ELSE 1 END, CASE WHEN n < 6 THEN 21 ELSE 17 END,
  CASE WHEN n < 6 THEN 17 ELSE 21 END, CASE WHEN n < 6 THEN 3 ELSE 1 END, CASE WHEN n < 6 THEN 1 ELSE 2 END, 2
FROM generate_series(4, 7) n;

-- Arena: pairs, members, challenges in every state, ranks.
INSERT INTO arena_pairs (player_low, player_high, name, formed_at)
VALUES (4, 5, 'Fast Fours', now() - interval '30 days'), (6, 7, NULL, now() - interval '25 days'),
       (8, 9, 'Night Owls', now() - interval '20 days'), (10, 11, NULL, now() - interval '15 days');
INSERT INTO arena_pair_members (pair_id, player_id, active) VALUES (1, 4, TRUE), (1, 5, TRUE), (2, 6, TRUE), (2, 7, TRUE), (3, 8, TRUE), (3, 9, TRUE), (4, 10, TRUE), (4, 11, TRUE);
INSERT INTO arena_challenges (posting_pair, p1, p2, accepting_pair, a1, a2, note, status, available_until, posted_by, posted_at, accepted_by, accepted_at, checked_in_at, played_on, score_posting, score_accepting, entered_by, entered_at, confirmed_by, completed_at)
VALUES
  (1, 4, 5, 2, 6, 7, 'first', 'completed', now() - interval '20 days', 4, now() - interval '22 days', 6, now() - interval '21 days', now() - interval '21 days', current_date - 21, 21, 15, 4, now() - interval '21 days', 6, now() - interval '21 days'),
  (3, 8, 9, 1, 4, 5, NULL, 'completed', now() - interval '10 days', 8, now() - interval '12 days', 4, now() - interval '11 days', now() - interval '11 days', current_date - 11, 18, 21, 8, now() - interval '11 days', 4, now() - interval '11 days'),
  (2, 6, 7, NULL, NULL, NULL, 'anyone?', 'open', now() + interval '3 days', 6, now() - interval '1 day', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (4, 10, 11, 3, 8, 9, NULL, 'accepted', now() + interval '2 days', 10, now() - interval '2 days', 8, now() - interval '1 day', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO arena_challenges (posting_pair, p1, p2, accepting_pair, a1, a2, status, available_until, posted_by, posted_at, accepted_by, accepted_at, checked_in_at, played_on, score_posting, score_accepting, entered_by, entered_at, disputed_by, disputed_at, dispute_note)
VALUES (1, 4, 5, 4, 10, 11, 'disputed', now() - interval '3 days', 4, now() - interval '5 days', 10, now() - interval '4 days', now() - interval '4 days', current_date - 4, 21, 19, 4, now() - interval '4 days', 10, now() - interval '3 days', 'not that score');
INSERT INTO arena_after_game (challenge_id, player_id, keep_pair, again) VALUES (1, 4, TRUE, TRUE), (1, 6, FALSE, TRUE);
INSERT INTO arena_player_ranks (player_id, seen_index, peak_index, was_tarnished) VALUES (4, 1, 2, FALSE), (6, 0, 1, TRUE);
INSERT INTO arena_match_stats (challenge_id, recorded_by, stats) VALUES (1, 4, '{"rallies": 40}');

-- Messages.
INSERT INTO message_threads (player_id, subject, status, started_by, unread_for_admin, unread_for_player)
VALUES (3, 'Welcome to Fridays', 'open', 'admin', FALSE, TRUE), (4, 'Can I swap days?', 'open', 'player', TRUE, FALSE), (5, 'Old question', 'closed', 'player', FALSE, FALSE);
INSERT INTO messages (thread_id, sender, body) VALUES (1, 'admin', 'See you on Friday!'), (2, 'player', 'Wednesday instead?'), (2, 'admin', 'Sure.'), (3, 'player', 'Thanks');

-- Photos.
INSERT INTO player_photos (player_id, original_url, display_url, thumb_url, width, height, bytes, status, featured, consent_at, caption)
SELECT (n % 6) + 3, 'https://blob.test/o/' || n, 'https://blob.test/d/' || n, 'https://blob.test/t/' || n, 1200, 800, 100000 + n,
  (ARRAY['approved', 'pending', 'needs_review', 'approved'])[(n % 4) + 1], n = 2, now() - interval '3 days', 'Photo ' || n
FROM generate_series(1, 10) n;

-- Shop.
INSERT INTO shop_products (slug, kind, name_en, name_vi, desc_en, desc_vi, price_cents, has_fit, has_sizes, active, sort)
VALUES ('club-tee', 'merch', 'Club tee', 'Áo câu lạc bộ', 'Soft tee', 'Áo mềm', 3500, TRUE, TRUE, TRUE, 1),
       ('grip', 'merch', 'Grip tape', 'Quấn cán', 'Tacky', '', 800, FALSE, FALSE, TRUE, 2),
       ('old-hat', 'merch', 'Old hat', '', '', '', 2000, FALSE, FALSE, FALSE, 3);
INSERT INTO shop_variants (product_id, fit, size, stock, reserved, sold) VALUES
  (1, 'men', 'M', 5, 1, 2), (1, 'women', 'S', 3, 0, 1), (2, '', '', 20, 2, 5), (3, '', '', 0, 0, 4);
INSERT INTO shop_orders (player_id, email, name, status, payment_method, total_cents, stripe_payment_intent_id, cash_invoice_id, hold_expires_at, paid_at)
VALUES (3, 'mia.member@golden.test', 'Mia Golden3', 'paid', 'card', 3500, 'pi_golden_shop1', NULL, NULL, now() - interval '5 days'),
       (4, 'player4@golden.test', 'Pete Golden4', 'reserved_cash', 'cash', 800, NULL, NULL, now() + interval '2 days', NULL),
       (5, 'player5@golden.test', 'Quinn Golden5', 'pending_payment', 'card', 800, 'pi_golden_shop3', NULL, NULL, NULL);
INSERT INTO shop_order_items (order_id, product_id, variant_id, qty, unit_price_cents, label) VALUES (1, 1, 1, 1, 3500, 'Club tee · men M'), (2, 2, 3, 1, 800, 'Grip tape'), (3, 2, 3, 1, 800, 'Grip tape');
INSERT INTO shop_stock_log (variant_id, change, stock_after) VALUES (1, '+5', 5), (3, '+20', 20);

-- Finance and bank.
INSERT INTO finance_entries (kind, name, category, method, person, entry_date, amount_cents, notes, origin, external_id)
SELECT CASE WHEN n % 4 = 0 THEN 'spent' ELSE 'received' END,
  'Entry ' || n, (ARRAY['membership', 'casual', 'court_hire', 'shuttles', 'merch'])[(n % 5) + 1],
  (ARRAY['card', 'cash', 'bank_transfer'])[(n % 3) + 1], CASE WHEN n % 2 = 0 THEN 'Person ' || n END,
  current_date - (n * 3), 1000 + n * 37, CASE WHEN n % 5 = 0 THEN 'note ' || n END,
  CASE WHEN n % 6 = 0 THEN 'stripe' ELSE 'manual' END, CASE WHEN n % 6 = 0 THEN 'ch_golden_' || n END
FROM generate_series(1, 30) n;
INSERT INTO bank_transactions (source, external_id, account, txn_date, description, reference, amount_cents, balance_cents, status, entry_id)
SELECT 'csv', 'bank-golden-' || n, '12-3456-7890123-00', current_date - (n * 3), 'BANK LINE ' || n, CASE WHEN n % 2 = 0 THEN 'REF' || n END,
  CASE WHEN n % 4 = 0 THEN -(1000 + n * 37) ELSE 1000 + n * 37 END, 500000 + n * 100,
  CASE WHEN n <= 3 THEN 'matched' ELSE 'unmatched' END, CASE WHEN n <= 3 THEN n END
FROM generate_series(1, 12) n;
INSERT INTO bank_matches (bank_txn_id, entry_id) VALUES (1, 1), (2, 2), (3, 3);
INSERT INTO bank_rules (pattern, direction, action, status, category, name, method, auto, hits)
VALUES ('BANK LINE 1', 'in', 'create', NULL, 'casual', 'Casual play', 'bank_transfer', TRUE, 3), ('COURT HIRE', 'out', 'classify', 'ignored', NULL, NULL, NULL, FALSE, 0);
INSERT INTO stripe_payouts (id, amount_cents, created_date, arrival_date, status) VALUES ('po_golden_1', 12345, current_date - 9, current_date - 7, 'paid');
INSERT INTO finance_settings (key, value) VALUES ('opening_balances', '{"bank": 100000, "cash": 5000, "date": "2026-01-01"}');
INSERT INTO finance_sync_state (key, last_started_at, last_finished_at) VALUES ('stripe', now() - interval '1 hour', now() - interval '59 minutes');

-- Jersey pre-orders.
INSERT INTO jersey_registrations (ref_code, first_name, last_name, email, email_normalized, phone, phone_normalized, name_normalized, size, print_name, print_number, price_cents, early_bird, status, expires_at, lang)
VALUES ('TWJ-001', 'Mia', 'Golden3', 'Mia.Member@golden.test', 'mia.member@golden.test', '021 555 0003', '0215550003', 'mia golden3', 'M', 'MIA', 3, 4500, TRUE, 'paid', NULL, 'en'),
       ('TWJ-002', 'Pete', 'Golden4', 'player4@golden.test', 'player4@golden.test', '021 555 0004', '0215550004', 'pete golden4', 'L', NULL, NULL, 5000, FALSE, 'pending', now() + interval '3 days', 'vi');

-- Wolf Vision, integrations, misc.
INSERT INTO wv_passes (player_id, kind, status, amount_cents, test, stripe_session, paid_at) VALUES (3, 'upload', 'paid', 200, FALSE, 'cs_golden_1', now() - interval '1 day'), (4, 'live', 'pending', 500, TRUE, 'cs_golden_2', NULL);
INSERT INTO wv_models (kind, weights, n, sessions) VALUES ('checker', '{"w":[0.1,0.2]}', 10, 2);
INSERT INTO api_tokens (player_id, name, scopes, token_hash, prefix) VALUES (3, 'Golden token', ARRAY['me:read'], md5('golden-token'), 'tw_gold');
INSERT INTO webhook_endpoints (player_id, url, secret, events) VALUES (3, 'https://hooks.golden.test/a', 'whsec_golden', ARRAY['attendance.recorded']);
INSERT INTO webhook_deliveries (endpoint_id, event, payload, status, attempts, next_attempt_at) VALUES (1, 'attendance.recorded', '{"ok":true}', 'pending', 1, now() + interval '1 hour');
INSERT INTO player_events (player_id, event, detail) VALUES (3, 'login', 'email'), (4, 'login', 'sms');
INSERT INTO donations (email, first_name, last_name, amount_cents, frequency, status) VALUES ('donor@golden.test', 'Don', 'Or', 2000, 'once', 'paid');
INSERT INTO cancellation_feedback (player_id, membership_id, action, reason, comment) VALUES (6, 4, 'cancel', 'moving', 'bye');
INSERT INTO casual_play_profiles (email, tier, nickname) VALUES ('player9@golden.test', 2, 'Niner');
INSERT INTO sms_sends (purpose, phone_hash, ip_hash) VALUES ('signin', md5('+64215550006'), md5('127.0.0.1'));
INSERT INTO admin_audit_log (actor_player_id, actor_kind, action, target) VALUES (1, 'player', 'golden.seed', 'all');

-- Each account's place in the club (the app writes this row whenever it
-- creates an account; the fixture writes accounts directly).
INSERT INTO club_members (tenant_id, user_id, role, status)
SELECT 1, p.id, COALESCE((SELECT r.role FROM club_roles r WHERE r.player_id = p.id), 'member'), 'active'
FROM players p WHERE p.deleted_at IS NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;
