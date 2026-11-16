# Plan: Player accounts, profiles, shop, leaderboard & photo sharing

Status: **approved direction, ready to build**. Nothing has been built yet.

**Decided (16 Nov):**
- email **and** SMS login codes from day one. SMS is **capped at the free allowance**, and only email sign-in is shown once it's used up;
- **every current active member gets an account created for them** and can sign in straight away with their membership email. Their membership and stats come from what's already in the database (§4a);
- attendance comes from the court board, the round robin and admin ticks;
- the round robin leaderboard ranks by RR points (2 per win), with ties broken by point difference;
- the leaderboard shows everyone by default, and each player can opt out in their profile;
- the cancel/downgrade flow has the extra steps but **no discount offer**;
- upgrades take effect at the **next renewal**;
- player photos are stored in **Vercel Blob** for now;
- the shop jersey is **$30, no customisation**, paid **by card online or cash at a play day**, with stock editable per size in admin;
- **q.buzz has no API yet**, so we build the generic API, webhooks and MCP server and add a q.buzz-specific link later.

Still needed from you: the new men's and women's **size charts** (§5.2 works without them until then).

---

## 1. Summary

Players get a Three Wolves account and sign in **without a password**, using a 6-digit code sent to their email or phone. The profile has three tabs:

| Tab | What it does |
|---|---|
| **Account** | Edit name and phone. Email is shown but can't be edited. Message thread with the admins. |
| **Membership** | Current plan, upgrade or downgrade (downgrade has a few extra steps), auto-renew on/off, payment method and invoices, play calendar to book and pay, **Shop** (club jersey plus later merchandise). |
| **Player profile** | Play days attended, round robin results, streaks and charts, photo uploads that feed the main site Gallery after an automatic safety check. |

**Works like an app on phones.** The profile can be added to the home screen and opens full screen. A short guide (shown once, for about 45 seconds) walks each player through adding it. It's designed for touch and fast on mobile, with layouts for tablets, iPad multitasking and foldables, including the iPhone Duo (§5a).

Other new pieces:
- a public **/leaderboard** page;
- three new admin pages: **Inbox**, **Shop** and **Photos**;
- a versioned **API with webhooks and an MCP server**, so habit trackers such as q.buzz can read and write player activity.

**Current members don't have to sign up.** An account is created for every active member using the email on their membership. They get a welcome email, sign in with a code sent to that email, and immediately see their membership and their play history (§4a).

Changes to the main site:
- the emailed cancellation flow is removed;
- a membership sign-up now creates an account;
- casual bookings still work as guest checkout, with an invitation to create an account;
- the Gallery lightbox gets a **Download original** button.

**Expected running cost: $0/month** on the current stack. SMS codes are capped at Google's free 10 texts per day. Once those are used, only email sign-in is offered, so texts never cost money (§3).

---

## 2. What we're building on (current platform)

Everything below reuses services the club already runs. No new hosting is needed.

| Already in place | Used for |
|---|---|
| Next.js 15 App Router on Vercel (Hobby, `syd1`) | All new pages and API routes |
| Vercel Postgres (Neon) with the memoised `ensure*Tables()` DDL pattern | Accounts, sessions, messages, stock, attendance, photos |
| Resend (`lib/email.ts`, `lib/email-layout.ts`) | Login codes, message notifications, order and photo alerts |
| Stripe (customers, subscriptions, PaymentIntents, webhook) | Membership changes, shop payments, payment method updates |
| Vercel Blob (a **private** store today, for receipts) | Shop product images; possibly player photos (see §7.4) |
| Google service account (Calendar sync) | Reused for the **Cloud Vision SafeSearch** photo check |
| Cloudflare Turnstile | Bot protection on "send me a code" |
| Sanity | Existing curated gallery photos stay there |
| `lib/i18n.ts` EN/VI, brand tokens in `app/globals.css` (navy `#184467`, cream, bronze, Copperplate + Montserrat) | Every new screen is bilingual and on brand |
| Court board (`lib/casual-play*.ts`): per-player `games` count and `concludedAt` per play day, keyed by email | **Attendance source** |
| Mini game (`lib/mini-game*.ts`): round robin draws and locked scores | **Round robin results source**. Today it uses a hard-coded list of 16 names, which must be linked to accounts (§6.2). |

There are no user accounts today. Players are identified by **email** everywhere: memberships, bookings, jersey registrations, court board profiles and Stripe customers. That makes linking straightforward: when someone signs in with an email, everything already recorded under that email becomes theirs.

---

## 3. Sign-in without a password: email and phone codes

### Findings

| Option | Cost | Verdict |
|---|---|---|
| **Email code (6 digits) plus a one-tap link in the same email, built in-house on Postgres and Resend** | **Free.** Resend's free plan is 3,000 emails/month with a 100/day cap. | ✅ **Recommended for launch** |
| SMS via Firebase / Google Identity Platform | First **10 SMS/day free**, then about **US$0.08 per SMS to NZ** | ✅ **Chosen for SMS, capped at the free 10** so it never costs money. Needs a Google Cloud billing account and reCAPTCHA (CSP changes). |
| SMS via Twilio Verify | About **US$0.05 per verification plus the NZ SMS fee**; failed sends are still charged | ❌ Costs more than Firebase |
| Telegram Gateway | About **US$0.01 per delivered code**; undelivered codes are refunded | Cheap, but only works for players who use Telegram |
| Clerk, Auth0, Supabase Auth | Email codes free on their free tiers; SMS always paid | ❌ Adds a vendor, off-brand screens, and doesn't solve SMS cost |

**Decision:** launch with **email codes and SMS codes**.
- **Email codes** are built in-house and are free.
- **SMS codes** use **Firebase Authentication (phone)**. The first 10 texts a day are free; after that Google would charge about US$0.08 per text to NZ.
- **SMS is capped at the free allowance, so it never costs money.** Once the free texts are used up, the login screen only offers email codes until texts are free again. See *SMS free-tier cap* below.
- Sessions last **90 days and extend with use**, so most players sign in only a few times a year. At club size the cap should rarely be reached.
- **Setup needed from you:** a Firebase project under the same Google Cloud project as the Calendar service account, with Phone sign-in enabled and a billing account attached. I'll provide the step-by-step guide.

### Design (in-house, about 300 lines, same style as `lib/admin-session.ts`)

1. The player enters an email (Turnstile-protected) and receives an email with a **6-digit code** and a **"Sign in" button**. The code works on a different device; the button is one tap on the same device.
2. Each code:
   - is stored **hashed** (HMAC-SHA256);
   - expires after **10 minutes**;
   - allows **5 attempts**;
   - is rate limited: 3 codes per email per 15 minutes, plus a per-IP limit.
3. On success, a random session token goes into an `httpOnly; Secure; SameSite=Lax` cookie. Only its hash is stored in `player_sessions`.
   - The session lasts 90 days and extends with use.
   - "Sign out of all devices" is available.
4. The first sign-in **is** sign-up. If the email is new, the player is asked for first name, last name and phone.
5. The same email check is built into the membership sign-up modal, so joining never leaves the flow (§10).

**SMS code flow (Firebase):**
1. The login screen has two options: **Email me a code** and **Text me a code**.
2. For a text, the browser only completes a reCAPTCHA check, loaded **only on the login page** to keep other pages fast. **Our server** then sends the code through Google and later checks it. This is what makes the hard cap below possible.
3. When the code is correct, Google returns the confirmed phone number to our server.
4. That phone number is matched to `players.phone_e164`, and the server issues our **own** session cookie, exactly as for email. Firebase is only used to deliver and check the code, not to hold accounts.
5. **New players signing in by phone** still need an email: it's the key for Stripe and club emails. After the text code they enter their email and confirm it with an email code, once only. After that, either login method works.
6. **Existing players** add or confirm their phone from the Account tab, which sends a text code to verify it. Phone numbers must be unique across accounts.
7. CSP is updated, only where needed, for Firebase and reCAPTCHA (`www.gstatic.com`, `www.google.com/recaptcha`, `*.googleapis.com`).

### SMS free-tier cap: never pay for texts

**Rule:** at most **10 texts in any rolling 24 hours**. Once 10 have gone out, the site **only shows email sign-in** until the oldest of those texts is more than 24 hours old.

**Why a rolling 24 hours instead of "per day":** Google doesn't publish exactly when its daily free count resets (UTC, Pacific time or something else). Capping any 24-hour window at 10 guarantees no calendar day, in any time zone, can go over 10. So we stay free whatever Google's reset time is. The cost is that SMS may occasionally come back a few hours later than it strictly needs to.

**What counts:** every text Google sends for us:
- sign-in codes;
- **Resend code**;
- phone confirmation on the Account tab.

They all share the one allowance. A text is counted when it's **sent**, whether or not the player enters the code, because Google bills per text sent.

**How it's enforced (our server is the only thing that can send a text):**
1. A small table, `sms_sends (id, purpose, phone_hash, sent_at)`, records every text.
2. Before sending, the server **reserves a slot** in one database transaction. It locks the counter, checks that fewer than 10 texts went out in the last 24 hours, and records the new send. Two people tapping "Text me a code" at the same moment can't both take the 10th slot.
3. **Only if a slot was reserved** does the server ask Google to send the text, using the Identity Platform REST API (`accounts:sendVerificationCode`) with the reCAPTCHA token from the player's browser.
   - The code is also checked on the server (`accounts:signInWithPhoneNumber`), so no Firebase sign-in code runs in the browser.
   - The Google API key stays **server-only** (not a `NEXT_PUBLIC_` variable), so nobody can use it to send texts around our counter.
   - If Google refuses the send, the slot is released.
4. Per-number and per-IP limits still apply on top: 3 texts per number per hour, plus Turnstile.

**What the player sees:**
- **SMS available:** the login screen offers **Email me a code** and **Text me a code**.
- **SMS used up:** the login screen shows **only** the email option.
  - The page is rendered with the right options already in place, so the text button never flashes up and then disappears.
  - No "SMS unavailable" message is shown on the normal login screen. It simply looks like an email login.
- **Used up between loading the page and tapping "Text me a code"** (someone else took the last slot): the server refuses, the screen switches to the email form with any typed email kept, and shows one line: *"Text codes aren't available right now, so we'll email your code instead."*
- **Resend code** after the cap is hit: offers "Email me a code instead".
- **Account tab phone confirmation:** while SMS is used up, the **Confirm phone** button is hidden and replaced with *"Phone confirmation is available again later today."*
- **Players who normally sign in by phone** are never stuck: every account has a confirmed email (§3, step 5), so email always works.

**Admin view:**
- `/admin/players` shows **Texts in the last 24 hours: 7 / 10** and when the next slot frees up.
- Admins get **one email the first time the cap is hit** in a 24-hour period, so you can tell if it happens often.
- **Turn SMS sign-in off** switch, for example if Google changes its free allowance. The site then shows email only.
- The cap is a setting (`SMS_FREE_LIMIT_24H`, default 10). Setting it to 0 also turns SMS off.

**Backstops in Google Cloud** (set up once, covered in the setup guide):
- SMS region policy allows only NZ, AU and VN numbers.
- A **budget alert at US$1**, so any charge, however it happened, is emailed to you straight away.
- At setup I'll check whether Google lets server-side sending work with the reCAPTCHA token, as planned in step 3.
  - **If it doesn't** (sending would have to happen in the browser with a public API key), the counter still controls everything our own pages do. To keep that safe, the API key gets an HTTP-referrer restriction to the club's domain, and Firebase **App Check** is turned on, so other sites and scripts can't use it.
  - I'll tell you which way it went before anything goes live.

New env vars: `PLAYER_SESSION_SECRET`, `FIREBASE_API_KEY` (server-only), `FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `SMS_FREE_LIMIT_24H` (default 10).

---

## 4. Data model (new Postgres tables)

All tables are created idempotently in a new `lib/player-db.ts`, following the existing `ensure*Tables()` pattern.

```
players              id, email (unique, lowercased), first_name, last_name, display_name,
                     phone_e164 (unique), phone_verified_at, lang, stripe_customer_id, minigame_name, leaderboard_visible,
                     avatar_url, created_via (member_import|signup|admin), claimed_at,
                     welcome_sent_at, install_hint_shown_at, installed_at, created_at, deleted_at
auth_codes           id, email, code_hash, link_token_hash, attempts, expires_at, consumed_at, ip_hash
player_sessions      id, player_id, token_hash, user_agent, created_at, last_seen_at, expires_at

message_threads      id, player_id, subject, status (open|closed), last_message_at,
                     unread_for_admin, unread_for_player
messages             id, thread_id, sender (player|admin), body, created_at, read_at

products             id, slug, kind (jersey|merch), name_en, name_vi, desc_en, desc_vi,
                     price_cents, images jsonb, has_fit (men/women), active, sort, created_at
product_variants     id, product_id, fit (men|women|unisex), size (S|M|L|XL|2XL|3XL),
                     stock, reserved, UNIQUE(product_id, fit, size)
orders               id, player_id, status (pending|paid|collected|cancelled|refunded),
                     total_cents, stripe_payment_intent_id, hold_expires_at, paid_at, collected_at
order_items          id, order_id, variant_id, qty, unit_price_cents, print_name, print_number

attendance           session_date, player_id, source (board|minigame|admin|api), recorded_at,
                     PRIMARY KEY (session_date, player_id)
rr_results           draw_id, session_date, player_id, team_id, wins, losses,
                     points_for, points_against, rr_points, placing

player_photos        id, player_id, original_key, display_key, thumb_key, width, height, bytes,
                     status (pending|approved|needs_review|rejected|hidden), safesearch jsonb,
                     caption, session_date, consent_at, created_at, reviewed_by, reviewed_at

api_tokens           id, player_id, name, scopes text[], token_hash, last_used_at, revoked_at
webhook_endpoints    id, player_id, url, secret, events text[], active
webhook_deliveries   id, endpoint_id, event, payload jsonb, status, attempts, next_attempt_at
sms_sends            id, purpose (login|phone_confirm), phone_hash, sent_at   -- rolling 24h cap (§3)
cancellation_feedback id, player_id, membership_id, action (downgrade|cancel|autorenew_off),
                     reason, comment, created_at
```

Linking existing records:
- A nullable `player_id` column is added to `memberships`, `bookings`, `jersey_registrations` and `session_fill_ins`.
- These are backfilled by email whenever an account is created.
- Accounts for all current active members are created up front (§4a).

**Stock is held in Postgres, not Sanity**, so that two people can't both buy the last shirt. Reserving a shirt is a single conditional `UPDATE … SET reserved = reserved + n WHERE stock - reserved >= n`. Unpaid holds are released after 15 minutes, the same idea as `PENDING_MEMBERSHIP_HOLD_MINUTES`.

---

## 4a. Accounts for every current member (created up front)

Every player with an **active membership** gets an account before launch. They don't have to sign up: they sign in with the email on their membership and their profile is already filled in.

### Who gets an account
- Every row in `memberships` that currently grants access. That covers:
  - auto-renewing and one-time memberships, paid by card or cash;
  - Friday and Wednesday;
  - memberships set to cancel at period end, while they're still running.
- **One account per email.** Emails are compared lower-cased and trimmed, so a member with several membership rows (e.g. past renewals) gets a single account.
- **Near-duplicates are flagged, not merged.** Emails that only differ by Gmail dots or `+tags` (using the existing `normalizeEmail` rule from the jersey page) are listed on `/admin/players` for an admin to merge or leave.
- Expired members and past casual players are **not** pre-created. If they sign up themselves later, everything under their email links to their new account automatically.

### What's filled in from the database
| Profile field | Source |
|---|---|
| Name and phone | The member's most recent `memberships` row |
| Display name (leaderboard and photo credits) | First name plus last initial, e.g. "Hòa N." The player can change it. |
| Stripe customer | Read from the member's Stripe subscription or payment, not looked up by email, so it's exact |
| Membership history | Every `memberships` row with that email, including expired ones |
| Casual bookings | Every `bookings` row with that email |
| Jersey registration | `jersey_registrations` with that email |
| Court board tier | `casual_play_profiles` with that email |
| **Play days attended** | Past saved court boards (`casual_play_sessions`). The board identifies each player by a hash of their email, so each player can be matched exactly. |
| **Round robin results** | Past mini game draws, once an admin has matched each of the 16 mini game names to a member on `/admin/players` (§6.2) |

**Attendance before the court board existed:** for older play days with no saved board, the import offers one extra source: **confirmed casual bookings** for that date count as attended (`source = booking_history`), because the player paid for that day. Members aren't counted for those days, since there's no record of whether they came. The import shows a preview per player before anything is saved, and admins can correct any day afterwards.

### Phone numbers
Phone numbers come over from the membership form but have **never been verified**. So:
- they're imported as *unverified*;
- **SMS sign-in only works once the player has confirmed their number**. They do this once from the Account tab, with a text code.

This stops someone getting into another person's account through a mistyped number.

### Running the import
- **Two parts:** accounts and membership/booking links are created in Phase 1. The play-day and round robin backfill runs in Phase 5, together with the stats screens. Both parts are safe to re-run.
- **Admin preview:** on `/admin/players`, **Import members** shows:
  - who will get an account;
  - any duplicate or suspicious emails;
  - each person's backfilled play-day and round robin counts.

  Then **Create accounts** runs it.
- **Safe to run again:** re-running only adds members who don't have an account yet and links any new history. It never changes details a player has edited.

### Welcome email
- **Timing:** accounts are created in Phase 1, but welcome emails are held until **Phase 5 (stats and leaderboard)** is live. That way members' first sign-in already shows their membership **and** their stats, not empty tabs. Admins can still sign in as a test member before then.
- Sent from `/admin/players` with **Send welcome emails**. You choose the timing and can send yourself a preview first.
- Bilingual (EN/VI), using the existing branded email layout. It says:
  - "Your Three Wolves account is ready";
  - how to sign in: go to the site, tap Log in, enter this email, and type the code;
  - what's inside: membership, play days, leaderboard and the shop;
  - **a one-click link to hide them from the leaderboard**, because pre-created accounts appear there by default.
- Sending is spread to stay under Resend's free limit of 100 emails a day. Each member is emailed once (`welcome_sent_at`), and failed sends are retried.

### Keeping it automatic after launch
New members are linked to an account at every point a membership can be created:
- online sign-up, which now requires an account;
- **Add cash member** on `/admin/members`;
- the Stripe webhook;
- the "restored from Stripe" step in `lib/stripe-sync.ts`.

All four call one helper, `ensurePlayerForEmail()`. It creates the account if needed, links the membership, and queues the welcome email for new accounts.

### What the member sees on first sign-in
- Their membership card in the **Membership** tab: plan, day, renewal or end date, and card on file.
- Their play days and round robin results in the **Player profile** tab.
- A one-time "Welcome" card asking them to:
  - check their name and display name;
  - confirm their phone, which turns on SMS sign-in;
  - choose whether to appear on the leaderboard.

`/admin/players` shows each member as **Not signed in yet** or **Active since …**, so you can see who has started using their account.

---

## 5. The profile: `/profile` (three tabs)

Routes:
- `/profile/account`
- `/profile/membership`
- `/profile/player`

Each tab is its own server-rendered route, so only that tab's data loads, and each streams in with a skeleton. On a phone the tabs are a sticky segmented control under the nav; on desktop they sit under a profile header showing name, membership badge and "member since". Styling uses the existing tokens: navy and cream surfaces, bronze accents, Copperplate headings and the same card shadows as the pricing cards.

`middleware.ts` gets a second matcher for `/profile/:path*`. It only checks that the cookie exists; the session itself is verified in the page.

### 5.1 Account tab
- **Details:** first name, last name, display name (shown on the leaderboard and photo credits), phone and language (EN/VI).
- **Email:** shown read-only with a lock icon and the note *"Your email is linked to your payments. To change it, send us a message."*
  - Admins can change it from the admin side. That updates `players.email`, every linked row, **and** the Stripe customer's email together.
- **Messages:**
  - The player sees a list of conversations and can start a new one or reply.
  - The open thread refreshes every 20 seconds while the tab is visible. That's free and needs no websockets; the court board already works the same way.
  - The player gets an email when an admin replies. Admins get an email for each new player message (`ALERT_ADMIN_EMAILS`).
  - A red badge on the Account tab shows unread messages.
- **Privacy:**
  - **Show me on the leaderboard** is on by default, with a toggle to turn it off. Turning it off removes the player from every period straight away.
  - Download my data (JSON).
  - Delete my account. Payment records are kept as the law requires.
- **Signed-in devices:** sign out of all devices.

### 5.2 Membership tab

**If the player has a membership:**
- **Plan card:**
  - plan (Monthly or Quarterly) and day (Friday or Wednesday), with status;
  - next renewal or end date and the next charge amount;
  - card on file (brand and last 4 digits);
  - play days left this cycle.
- **Upgrade** (Monthly → Quarterly):
  - one screen showing the saving, then one confirm;
  - applied **at the next renewal** (decided) with a Stripe subscription schedule. There's no charge now; the next invoice is the quarterly price.
  - **Downgrade** (Quarterly → Monthly) also applies at the next renewal, after the extra steps below.
- **Change day** (Friday ↔ Wednesday): uses the same capacity checks as sign-up and respects paused days.
- **Downgrade, turn off auto-renew or cancel:** deliberately takes more steps, but stays honest and clear. NZ consumer law, and good faith, mean cancelling must stay possible online in a few steps, with no tricks.
  1. **What you'll miss:** play days left, your current price, your attendance streak and leaderboard position. A **"Keep my membership"** button is the main, highlighted action.
  2. **Alternatives:** switch day, take a free month (if eligible), or message the admins.
  3. **Why are you leaving?** A required reason with an optional comment, saved to `cancellation_feedback` and shown to admins. There's **no discount offer**, by decision.
  4. **Final confirm**, with a clear summary: *"Your membership will end on Fri 12 Dec. You won't be charged again."* A confirmation email goes to the player, and the admins are notified.

  Cancelling or turning off auto-renew sets `cancel_at_period_end`; the player keeps access until the period ends. **Resume** is one tap any time before then.
- **One-time memberships** (card or cash):
  - the end date is shown, with **Renew** (replacing the current emailed `/renew-membership` link flow) and **Turn on auto-renew**;
  - turning on auto-renew creates a subscription whose first charge is on the current end date.
- **Payment method and invoices:**
  - **Update card** opens Stripe's free hosted Customer Portal, limited to the update-card flow (`flow_data.payment_method_update`) so it can't bypass the cancellation steps above;
  - **invoices and receipts** are listed from Stripe with PDF links.

**If the player has no membership:**
- **All plans** are shown as on-brand cards from the existing Sanity `pricingPlan` data, with Quarterly marked "Best value".
- Joining uses the existing payment form with the player's details pre-filled, so it's just plan → day → pay.

**Play calendar (everyone):**
- Reuses `SessionCalendarPicker`.
- **Members** see the days their membership covers marked "Included" and can tap **"Can't make it"**. That frees the spot for a casual player (the existing waitlist notification applies) and doesn't count against their attendance streak.
- **Everyone** can book and pay for a casual session ($10) in two taps, with details pre-filled. Upcoming and past bookings are listed.

**Shop (while stock lasts):**
- **Club jersey** card using the cropped front image (`/uploads/shop/jersey-port-hills-dawn-front.webp`, cut from `public/uploads/jersey/design.webp`). The back view is a second image in a swipeable gallery.
- **Price: $30.** No name or number printing.
- **Men's / Women's** toggle, then a **size picker S, M, L, XL, 2XL, 3XL**:
  - each size shows a stock badge ("3 left", "Sold out");
  - sold-out sizes are disabled;
  - a **Size guide** link opens the chart for that fit. Until the new charts are uploaded, it says "Size guide coming soon: ask us at a play day".
- **Two ways to pay:**
  - **Card now (Stripe).** The shirt is held for 15 minutes during checkout. Once paid, the order shows **"Paid: collect at your next play day"**.
  - **Cash at a play day.** The shirt is reserved and the order shows **"Reserved: bring $30 cash to your next play day"**. The reservation lasts until the end of the player's next play day, or 14 days if they have none booked. After that it's released automatically and the player gets an email first. The player can cancel it themselves.
- **At the play day:** admins open the order list on their phone and tap **Paid cash and collected**, or **Collected** for card orders.
  - A cash payment is recorded the same way as **Add cash member** today: a Stripe invoice marked paid outside Stripe. Financials picks it up as *Cash* under *Jersey & merchandise* with no extra steps.
- The product card disappears automatically when every size is sold out.
- **More merchandise later:** admins add products (name EN/VI, description, price, photos, sizes on or off, stock) in `/admin/shop`. Nothing in the code is jersey-specific.
- Payments carry `metadata.kind = "shop"`, so `lib/finance-stripe.ts` automatically files them under **Jersey & merchandise** in Financials.

### 5.3 Player profile tab
- **Stat tiles:**
  - play days attended (this month, this quarter, this year, lifetime);
  - current streak and best streak, counted in weeks played;
  - round robin days played, total RR points, win rate and best placing;
  - leaderboard rank for each period.
- **Attendance heatmap:** a calendar grid of weeks, coloured on attended play days.
- **Round robin trend:** a small line chart of RR points per round robin day.
- **History:** a list of each play day, with round robin results where they apply.
- **My photos:** upload, caption and delete (§7). Each photo shows its status: *Shared in Gallery*, *Under review* or *Not shared*.
- **Connected apps:** create and revoke API tokens and webhook URLs, with instructions for connecting habit trackers or an AI assistant (MCP). See §8.

Charts are small hand-written SVG components with no chart library, which keeps the page bundle small.

---

## 5a. Mobile: an app on the home screen, built for touch

The profile is designed **phone first**. Most players will open it at the hall, on a phone, between games. Tablets and foldables get their own layouts, chosen by the actual screen or window width rather than by guessing the device.

### 5a.1 Make it installable ("add to home screen")
- **Web app manifest** (`app/manifest.ts`):
  - name "Three Wolves", short name "3 Wolves";
  - opens at `/profile`, falling back to sign-in if the player isn't signed in;
  - `scope: "/"`, so the leaderboard and gallery open inside the app too;
  - `display: "standalone"` (no browser bars);
  - navy theme colour (`#184467`) and cream background (`#fcfbf2`);
  - wolf-logo icons at 192 and 512 px, plus a "maskable" version for Android's rounded icon shapes. The existing `app/apple-icon.png` stays the iPhone icon.
- **iPhone/iPad settings:** `apple-mobile-web-app-title` and a status bar style that blends into the navy header. On iOS 26 and later, anything added to the Home Screen opens as a web app by default.
- **Small service worker**, offline-safe:
  - it caches only the app's static files (JavaScript, fonts, icons), so opening from the home screen is near-instant after the first visit;
  - it **never caches signed-in pages or data**, so nobody can see stale or another person's details;
  - with no signal, it shows a branded "You're offline" screen with a Retry button.
- **Opened from the home screen:** the start link carries `?source=homescreen`, so we can record `players.installed_at` and show admins how many players have installed it.
- **iPhone note:** a home-screen web app keeps its own sign-in, separate from Safari, so players sign in once more inside the app. Sessions then last 90 days. The install guide says this up front. I'll confirm the exact behaviour on a real iPhone during the build.

### 5a.2 The install guide overlay
**When it appears:**
- **once per player**, on their **first signed-in session on a phone or tablet**;
- it's skipped if the profile is already open as an installed app, or the device has no touch screen (e.g. a laptop);
- "shown" is stored on the player's account (`players.install_hint_shown_at`), so it doesn't come back on a new phone or after clearing the browser;
- it can be reopened any time from **Account → Add to Home Screen**.

**How long:**
- it stays for **about 45 seconds**, then fades away on its own;
- a thin bronze progress bar along the top shows the time left;
- the timer **pauses** while the player's finger is on the overlay, or the app is in the background, then carries on;
- **Got it**, the ✕, or tapping the dimmed background closes it straight away.

**What it looks like:**
- a **bottom sheet** (thumb-reachable) over a dimmed profile, with the wolf app icon at the top;
- *"Put Three Wolves on your home screen: one tap to your membership, play days and leaderboard"*;
- a short animated arrow pointing at the real button the player needs to tap. With reduced motion turned on, the arrow is still.
- EN/VI, following the site language.

**Instructions are matched to the browser:**

| Device / browser | What the overlay shows |
|---|---|
| **iPhone, Safari** (iOS 26+) | 1. Tap **⋯** (bottom right) → **Share**; 2. **Add to Home Screen**; 3. keep **Open as Web App** on → **Add**. The arrow points to the bottom bar. |
| **iPhone, older iOS** | 1. Tap **Share** ⬆︎; 2. **Add to Home Screen**; 3. **Add**. |
| **iPad, Safari** | The same steps, with the arrow pointing to the **Share button at the top right**. |
| **iPhone/iPad, Chrome or Edge** | Share (top right of the address bar) → **Add to Home Screen**. |
| **Android, Chrome / Edge / Samsung Internet** | A single **Install app** button that opens the phone's own install prompt. When it's accepted, the overlay shows "Done! Find Three Wolves on your home screen" and closes. If the browser doesn't offer it, the steps are shown: ⋮ → **Add to Home screen** / **Install app**. |
| **Facebook, Messenger or Instagram in-app browser** (common, since the club posts links on Facebook) | Those browsers can't add to the home screen, so the overlay says *"Open this page in Safari/Chrome first"*. It has a **Copy link** button and shows where the "Open in browser" option is. |

The overlay works with screen readers, traps focus while it's open and closes with Escape. It also records shown / dismissed / installed events, so admins can see how well it works.

### 5a.3 When it runs as an app (installed)
- **App shell:**
  - a compact navy header with the wolf logo and the player's avatar;
  - a fixed **bottom tab bar** (Account · Membership · Player), sized for thumbs and with unread and status badges;
  - the main site's marketing footer and nav are hidden.
- **Safe areas:** with `viewport-fit=cover` and `env(safe-area-inset-*)` padding, nothing sits under the notch or Dynamic Island, the home indicator, or rounded corners in landscape.
- **Back buttons on inner screens:** a message thread, the checkout and the cancel steps all get an in-app ‹ Back. An installed app has no browser back button, and the iOS edge-swipe still works.
- **Pull to refresh** on Messages, Membership and Player. Installed iPhone web apps don't have it built in.
- **Links outside the club site** (Stripe receipts, Google Maps to the venue) open in the system browser.

### 5a.4 Touch optimisation (all screens)
- **Tap targets:** at least **44 × 44 pt** (Apple's guideline; 48 dp on Android), with at least 8 px between them. An automated check in the end-to-end tests fails the build if any button or link is smaller.
- **No hover-only features:** hover effects are only applied when the device has a mouse (`@media (hover: hover)`). Every button has a visible pressed state.
- **No tap delay:** `touch-action: manipulation` removes the double-tap-to-zoom delay.
- **Thumb zone:** the main action on each screen (Pay, Send, Confirm) sits in a **sticky bottom action bar**. Choices such as size, plan, day and the cancel steps open as **bottom sheets** that can be swiped down to close.
- **Forms:**
  - text inputs are at least 16 px, so iPhones don't zoom in;
  - each field has the right keyboard and autofill (`email`, `tel`, `given-name`);
  - the code box uses **`autocomplete="one-time-code"`**, so the iPhone keyboard offers the code straight from Messages or Mail, and Android suggests it from the SMS.
- **Typing a message:** the composer stays above the on-screen keyboard (using `visualViewport`, plus the `interactive-widget=resizes-content` viewport setting in Chrome). Sent messages show instantly while they finish sending in the background.
- **Scrolling:**
  - the tab bar and section headers stay visible;
  - `overscroll-behavior: contain` stops scrolling a sheet from also scrolling the page behind it;
  - horizontal swipe gestures between tabs are avoided, because they fight the iOS back-swipe.
- **Photos:** the upload button offers **Take photo** or choose from the photo library, with per-photo progress. Uploads carry on if the player switches app briefly.
- **Feedback:**
  - a short vibration on Android when a payment or booking is confirmed (iPhone web apps can't vibrate);
  - motion is reduced when the phone's "Reduce motion" setting is on.

### 5a.5 Layouts by screen width (phones, tablets, foldables)
Layouts respond to the **width the page actually has**: the screen, or a window when the screen is shared. Media and container queries do this, not device detection. So a narrow iPad window or a folded phone automatically gets the phone layout, and unfolding switches layout **live**, with nothing lost.

| Width (CSS px) | Typical devices | Layout |
|---|---|---|
| **< 600** | Phones in portrait; foldable outer screens; narrow iPad windows (Slide Over, ⅓ Split View) | One column, bottom tab bar, bottom sheets, full-width cards |
| **Phones in landscape** (height < 500) | Phones turned sideways | Slimmer header and tab bar so content gets the height; landscape safe areas for the notch side |
| **600–1023** | iPad mini / Air portrait, ½ Split View, **unfolded foldables** (iPhone Duo inner screen, Galaxy Z Fold, Pixel Fold) | **Two panes**: Account = thread list beside the open thread; Membership = plan card beside the calendar and shop; Player = 2–3 column stat grid with the heatmap full width. Tabs move to a top segmented bar; bottom sheets become centred dialogs. |
| **≥ 1024** | iPad landscape, iPad Pro, Stage Manager windows, desktop | A left navigation rail and content up to 1,100 px wide, with a three-column stat grid |

**iPhone Duo (Apple's foldable):**
- Reports describe a phone-sized **outer screen** and a nearly square **inner screen** (around 4:3).
  - Folded, it gets the normal phone layout.
  - Unfolded, the width puts it in the **two-pane tablet layout**.
- Because the inner screen is close to square, the two-pane views are designed **not to depend on height or shape**:
  - content widths are capped;
  - charts and the podium keep their proportions;
  - nothing is laid out for a tall, narrow screen only.
- One report says Safari on the iPhone Duo gives pages between about **382 and 951 px** of width, depending on the screen and window. **I couldn't confirm those figures**, so the layouts don't rely on any exact number. They'll be re-checked against Apple's published sizes before the build is signed off.
- Apple's foldable is reported to have no visible crease and shows one continuous screen, so nothing special is needed for the fold.

**Android foldables:**
- Chrome and Edge (version 138+) can report a physical fold or hinge through the **Viewport Segments API** (`horizontal-viewport-segments` / `vertical-viewport-segments`). This is used **only as an extra on browsers that support it**:
  - **book posture:** the thread list on one side of the fold and the open thread on the other;
  - **tabletop posture:** the calendar on the top half, with the booking button on the bottom half.
- Safari doesn't support this, and every other browser simply gets the normal layout.

**iPad multitasking:**
- Split View, Slide Over and Stage Manager (resizable windows on iPadOS 26) are covered by the width rules above.
- Moving a window between sizes changes the layout without losing the page.

### 5a.6 Mobile performance budget
Measured with Lighthouse's mobile test (simulated mid-range phone on 4G) on every phase that touches the profile:

| Measure | Target |
|---|---|
| Largest Contentful Paint (main content visible) | **< 2.0 s** |
| Interaction to Next Paint (tap response) | **< 200 ms** |
| Cumulative Layout Shift (no jumping) | **< 0.05** |
| JavaScript on first load of a profile tab | **< 100 KB** compressed (Stripe, reCAPTCHA and the upload tools load only on the screens that need them) |

How it's met:
- **Fonts:** only the Montserrat and Copperplate weights actually used are preloaded (`public/uploads` has 20+ font files). Each is limited to the Latin and Vietnamese characters, with `font-display: swap`.
- **Tabs:** the other tabs load in the background while the phone is idle, so switching tabs is instant. Skeletons are the same size as the final content, so nothing jumps.
- **Images and caching:** images are pre-sized thumbnails that load lazily, and the service worker cache makes repeat opens from the home screen near-instant.

### 5a.7 Device testing
- **Automated:** Playwright runs the main flows at these sizes, with screenshots at 2× for the on-brand review:
  - iPhone SE (375 × 667), iPhone 17 (402 × 874), iPhone 17 Pro Max (440 × 956), iPhone in landscape;
  - iPad mini (744 × 1133), iPad Air 11" (820 × 1180), iPad Pro 13" (1032 × 1376), iPad in ½ and ⅓ Split View widths;
  - Pixel (412 × 915), Galaxy Z Fold outer and inner screens, and Fold book posture with the viewport-segments emulation;
  - the iPhone Duo outer and inner screens, using Apple's published viewport sizes once confirmed.

  Each run includes the tap-target check, a Lighthouse mobile audit, and checks that the install overlay shows once, lasts 45 seconds and pauses on touch.
- **On real devices before launch:** at least one iPhone with iOS 26, one Android phone, and an iPad if one is available, ideally from a few club members.
  - Check adding to the home screen, sign-in inside the installed app, and SMS/email code autofill.
  - Check payment in Stripe test mode and photo upload from the camera.

---

## 6. Attendance and round robin data

### 6.1 Attendance: where it comes from

Today a member is *assumed* to attend every play day, which isn't good enough for a leaderboard. Decided sources:
1. **Court board, automatic:** when an organiser taps **Conclude play day**, everyone on the board with **at least 1 finished game** is recorded as attended (`source = board`). The board already tracks `games` per player by email.
2. **Mini game, automatic:** everyone in a round robin draw for that day is recorded (`source = minigame`).
3. **Admin, manual:** a tick column on `/admin/play-days` to add or remove a player for any date, for days when the board wasn't used.
4. **API (§8):** stored as *unverified* until an admin confirms, so the leaderboard can't be gamed.

Past attendance can be backfilled from every saved court board (`casual_play_sessions.state`), so profiles don't start empty.

### 6.2 Round robin: linking scores to people

The mini game currently draws from a hard-coded `ROSTER` of 16 names in `lib/mini-game-roster.ts`.
- **Change:** move the roster and tiers into the database (the `players.minigame_name` column plus a tier). Admins manage it from a small roster editor. Teams then carry `player_id`s, not just names.
- When a draw's scores are all locked, `rr_results` is written per player: wins, losses, points for and against, **RR points** (the existing 2 per win) and placing.
- **Backfill:** past draws are mapped to accounts once through a name → player table on the admin side.
- **Leaderboard score (decided):** total **RR points (2 per win)**, with ties broken by point difference.
- The name matching is done once, as part of the member import (§4a). After that the mini game picks players from the database, so it stays linked.

---

## 7. Photos: upload, safety check, Gallery

### 7.1 Upload flow (player)
1. The player picks one or more photos (up to 20 a day) and ticks a consent box: *"I took this photo or have permission, and the people in it are happy for it to appear on the club website."*
2. In the browser, three versions are made:
   - the **original**, with GPS/location data removed (a small step that strips the location metadata block without re-compressing the image, so quality is untouched);
   - a **display** copy, about 1600px WebP;
   - a **thumbnail**, about 400px WebP.

   Doing this in the browser means no server image processing and no Vercel image-optimisation quota is used.
3. Files upload **straight from the browser to storage** using a short-lived signed upload URL from our API, which avoids Vercel's 4.5 MB request limit. The row starts as `pending`.
4. A server step runs **Google Cloud Vision SafeSearch** on the display copy, reusing the club's existing Google service account:
   - adult, violence or racy rated **LIKELY / VERY_LIKELY** → `rejected`. The photo is hidden everywhere, an **admin email** is sent ("Photo blocked: uploaded by …"), and it lands in the admin queue with a blurred preview. The player sees *"This photo can't be shared."*
   - **POSSIBLE** → `needs_review`. It's held until an admin approves it.
   - otherwise → `approved`. It joins the Gallery pool straight away.
5. The player can delete their photo at any time, which removes it from the Gallery too. Admins can hide any photo.

Cost: SafeSearch is **free for the first 1,000 images a month**, then US$1.50 per 1,000. Vision needs a billing account attached to the Google Cloud project, but usage stays at $0. An in-browser checker was rejected: it's easy to bypass and adds about 4 MB to the page.

### 7.2 Admin: `/admin/photos`

Tabs: **Needs review / Blocked / Approved**. Actions: approve, block, hide from Gallery, feature, and email the uploader (opens a message thread with them).

### 7.3 Main site Gallery
- The page combines **Sanity gallery images** with **approved player photos** into one pool. The existing weekly rotation (`lib/gallery-rotation.ts`) picks the 10 tiles shown.
- Player photos are credited ("📷 Hòa").
- The lightbox thumbnail strip uses thumbnail URLs with `loading="lazy"`, so a large pool doesn't slow the page. A **"See all photos"** link opens a paginated `/gallery` page.
- **Download original** button in the lightbox:
  - for Sanity images, the asset URL with Sanity's `?dl=` parameter, which serves the full-quality original as a download;
  - for player photos, the storage download URL, served with a download header.

  This is needed because a plain `<a download>` doesn't work across domains. This part doesn't depend on accounts, so it can ship first as a quick win.

### 7.4 Where player photos are stored (decided: Vercel Blob for now)

| Option | Free allowance | Notes |
|---|---|---|
| **Vercel Blob** (new *public* store) | 1 GB storage, 10 GB transfer/month on Hobby; Hobby pauses the feature if exceeded, it doesn't charge | Zero new accounts. Room for roughly 250–400 full-size phone originals. |
| **Cloudflare R2** | 10 GB storage, **free bandwidth** | About 10× the headroom. Needs R2 enabled in the club's Cloudflare account (already used for Turnstile) and a custom domain for public images. |

**Decision:** use **Vercel Blob** now, with storage usage shown on `/admin/photos`. Switch to R2 if it passes about 700 MB; the storage layer will be one small module, so switching is a config change.

---

## 8. "MCP-ready" data in and out (for q.buzz and others)

Three layers, all running inside the existing Next.js app at no extra cost:

1. **Versioned REST API** at `/api/v1`:
   - `GET /me`, `/me/attendance?from&to`, `/me/round-robin`, `/me/stats?period=month|quarter|year|lifetime`, `/leaderboard?metric&period`, `/sessions/upcoming`;
   - `POST /me/activity` for incoming events, e.g. a habit tracker confirming a check-in. These are stored as **unverified** until an admin confirms them.
   - Auth: **personal access tokens** created in *Connected apps*, with scopes such as `read:stats`, `read:attendance` and `write:activity`. Only hashed tokens are stored.
2. **Outgoing webhooks:**
   - Events: `attendance.recorded`, `round_robin.result`, `membership.changed`, `photo.approved`. Payloads are JSON and signed with HMAC (the `X-ThreeWolves-Signature` header).
   - Failed deliveries are retried by the existing daily cron (on Hobby, each cron job runs once a day) and on the next event.
3. **MCP server** at `/api/mcp` (Streamable HTTP, built with the official MCP TypeScript SDK):
   - **Tools:** `get_my_stats`, `get_attendance`, `get_round_robin_results`, `get_leaderboard`, `get_upcoming_sessions`, `log_activity` (incoming, unverified).
   - **Auth:** the same bearer tokens at launch. Adding OAuth later lets AI clients that require it, such as Claude connectors, sign in properly.

A **personal iCal feed** of the player's upcoming play days is included almost for free.

**q.buzz:** it has no API yet, so nothing q.buzz-specific is built now. When it does, connecting it means adding a webhook URL or token for q.buzz on top of what's already here. Because nothing else depends on it, this phase can wait until q.buzz is ready.

---

## 9. Leaderboard: `/leaderboard` (public)

- **Two boards:**
  - **Play days attended**;
  - **Round robin points**, with wins and point difference as secondary columns.
- **Periods:** Month, Quarter (calendar quarters), Year and Lifetime, with ‹ › buttons to step back through past periods.
- **Look:** top 3 as a podium in gold, silver and bronze using the brand's bronze and steel tones. The rest is a clean ranked list with each player's display name and avatar initials. A signed-in player's own row is highlighted, and if they're outside the top 20, it's pinned at the bottom.
- **Privacy (decided):** every player with an account is shown **by default**, including pre-created member accounts. Anyone can turn it off in Account → Privacy, or from the link in their welcome email. Names show as the player's display name, which defaults to first name plus last initial.
- **Speed:** one SQL aggregate per board, grouping attendance and `rr_results` by NZ-time periods, with indexes on `(session_date)` and `(player_id)`. Results are cached and refreshed when attendance or scores change, so the page loads like a static page.
- A **Leaderboard** link is added to the main nav.

---

## 10. Changes to the existing site

| Area | Change |
|---|---|
| **Nav** | Add **Log in**. Once signed in, it becomes an avatar menu (My profile, Messages, Log out). Add a **Leaderboard** link. |
| **Cancellation flow** | Remove the footer *Cancel Membership* button, `CancelMembershipModal`, `/cancel-membership/*`, `/api/cancel-membership/*`, `CANCEL_LINK_SECRET` and the related i18n strings. Old emailed links redirect to `/login?next=/profile/membership`. The "Cancel anytime" wording becomes "Cancel anytime from your profile". The admin-side cancel button stays. |
| **Casual booking** | Stays a one-off **guest checkout**. Changes: (1) a "Have an account? Log in to fill this in" link on the details step; (2) the success screen and the confirmation email say *"Create your free account in one tap: track your play days, climb the leaderboard, share photos"*, with the email pre-filled. The booking is linked automatically when they sign up. |
| **Membership sign-up** | Requires an account. `MembershipModal` gets an email-code step after choosing the plan, if the player isn't signed in. Signed-in players skip the details step. The Stripe customer is saved on the account (`players.stripe_customer_id`), so we stop looking customers up by email. |
| **Renewal emails** | Link to `/profile/membership` (after sign-in). Existing token links keep working until they expire. |
| **`/jersey`** | Registration closed on 21 Oct. The page is kept as is for existing registrations, and gets a link to the Shop. Future jersey sales go through the Shop. |
| **Gallery** | Combined pool, photo credits, lazy thumbnails, **Download original** button, and a `/gallery` "see all" page. |
| **CSP** (`next.config.ts`) | Add the photo storage host to `img-src` and `connect-src` (for direct uploads). |

### Admin additions
- **Inbox** (`/admin/inbox`):
  - threads with unread ones first, an unread badge on the nav tab, reply, close and reopen;
  - links to the player's admin record.
- **Shop** (`/admin/shop`):
  - products (create and edit, EN/VI, images, price, active, order);
  - **stock per size:** a grid of **Men's / Women's × S, M, L, XL, 2XL, 3XL**:
    - type a number or use +/−;
    - each cell also shows how many are reserved and sold;
    - low stock (2 or fewer) is highlighted;
    - every change is logged with who made it and when;
  - **size charts:** upload one image per fit, so the new charts can go up as soon as you have them;
  - **orders:** filter by Reserved (cash), Paid and Collected. Actions are Paid cash and collected, Collected, Cancel, and Refund for card orders. There's a phone-friendly view for play days and Excel export using the existing `exceljs`;
  - seeded with the Port Hills Dawn jersey at $30, using the cropped front and back images and zero stock until you enter it.
- **Photos** (`/admin/photos`): the moderation queue (§7.2).
- **Players** (`/admin/players`):
  - **Import members** (preview, then create accounts) and **Send welcome emails** (§4a);
  - match the 16 mini game names to members;
  - accounts list and search, with *Not signed in yet / Active since …*;
  - change email (updates Stripe too), merge duplicates;
  - attendance edits, mini game name and tier.
- **Play days:** an attendance tick column.

---

## 11. Cost, performance, security

### Monthly cost

| Item | Service | Free allowance | Expected cost |
|---|---|---|---|
| Email login codes and notifications | Resend (existing) | 3,000/month, 100/day | $0 |
| SMS login codes | Firebase / Identity Platform | 10/day | **$0, guaranteed by a hard cap** of 10 texts per rolling 24 hours; email-only sign-in after that (budget alert at US$1 as a backstop) |
| Photo safety check | Google Cloud Vision SafeSearch | 1,000 images/month | $0 |
| Photo and product image storage | Vercel Blob (or R2) | 1 GB / 10 GB transfer (R2: 10 GB, free transfer) | $0 |
| Database | Vercel Postgres / Neon (existing) | current plan | $0 |
| Payments and card updates | Stripe (existing) + Customer Portal | no monthly fee | normal per-payment fees only |
| API, webhooks, MCP | the existing Next.js app | n/a | $0 |

**Caveat:** Vercel's Hobby plan is meant for non-commercial projects. The site already takes payments, and a shop adds more. If Vercel ever raises it, Pro is US$20/month. It isn't needed for performance.

### Performance
- Each profile tab is a separate server-rendered route that streams in. No Stripe calls happen on page load except for invoices and the card on file, which load lazily in their own section.
- The leaderboard is cached and refreshed only when data changes. The gallery uses pre-made thumbnails.
- No new client-side libraries apart from Stripe, which is already loaded. Charts are plain SVG.
- Messages are only refreshed while the tab is visible.

### Security and privacy
- Login codes and session tokens are stored hashed, with expiry, attempt limits, rate limits and Turnstile.
- Every `/api/profile/*` route checks the signed-in player owns what they're touching. Prices are always worked out on the server, as today.
- Photos: file type is checked from the file's contents, size is capped, GPS data is removed and consent is recorded.
- NZ Privacy Act 2020: the privacy notice is updated, and players can download their data and delete their account.

---

## 12. Decisions log

| # | Question | Decision |
|---|---|---|
| 1 | Login codes | Email **and** SMS (Firebase) from day one. SMS is **capped at the free 10 per rolling 24 hours**, and only email sign-in is shown once it's used up |
| 2 | Attendance | Court board (≥1 finished game), round robin, and admin ticks. Confirmed casual bookings count for older days with no saved board (§4a). |
| 3 | Round robin score | RR points (2 per win), with ties broken by point difference |
| 4 | Leaderboard privacy | Shown by default, opt-out in profile, display name |
| 5 | Photo storage | Vercel Blob for now, R2 if it passes about 700 MB |
| 6 | Jersey | $30, no customisation, card or cash at a play day, stock editable per size; **size charts to come from you** |
| 7 | Upgrades | At the next renewal; no discount offer when cancelling |
| 8 | q.buzz | No API yet; build the generic API, webhooks and MCP server, and add q.buzz later |
| 9 | Existing members | Accounts created up front for every active member, with history backfilled from the database |
| 10 | Mobile | Installable app with a once-only, about 45-second "add to home screen" guide; touch-first design; layouts by width for phones, tablets, iPad multitasking and foldables, including the iPhone Duo (§5a) |

---

## 13. Delivery plan (one PR per phase, matching the repo's one-feature-per-PR history)

| Phase | Scope | Depends on |
|---|---|---|
| **0. Quick win** | Gallery lightbox **Download original** button | none |
| **1. Accounts** | `players`, `auth_codes`, `player_sessions`, email-code login **and Firebase SMS login with the free-tier cap** (`sms_sends`, email-only fallback, admin counter and switch), nav Log in and avatar, `/profile` shell **as a mobile app shell** (manifest, icons, service worker, bottom tab bar, safe areas, tablet and foldable layouts, **install guide overlay**, §5a), Account tab details including phone verification. **Member import** (preview, create, link history), `ensurePlayerForEmail()` on every membership path, `/admin/players`, welcome emails (§4a) | Firebase project set up |
| **2. Messaging** | Threads and messages, Account tab inbox, `/admin/inbox`, email notifications | 1 |
| **3. Membership tab** | Plan status, upgrade and day change, step-by-step downgrade and cancel, auto-renew on/off, update card (Portal), invoices, calendar booking, "can't make it". Main site: remove the emailed cancel flow, require an account for membership sign-up, invite casual bookers to create an account | 1 |
| **4. Shop** | Products, variants, orders, stock holds, Stripe checkout, `/admin/shop`, seeded jersey with cropped images, Financials category | 1 |
| **5. Player stats and leaderboard** | Attendance capture from the board, mini game and admin; **attendance and round robin backfill for imported members**; **then send the welcome emails**; mini game roster moved to the database; `rr_results`; Player profile stats and charts; `/leaderboard` with opt-out | 1 |
| **6. Photos** | Upload, GPS removal, SafeSearch, admin queue and alerts, Gallery merge and credits, `/gallery` | 1 |
| **7. Integrations** | `/api/v1`, tokens, webhooks, MCP server, iCal feed. q.buzz is added later, once it has an API. | 5 |

**Verification for every phase:**
- `next build` and lint;
- the mobile checks in §5a.7 (screen sizes, tap targets, Lighthouse mobile budget) for every phase that touches the profile;
- small `node --test` unit tests for the pure logic (code hashing and expiry, stock holds, period maths, leaderboard ranking);
- an end-to-end run in Stripe **test mode** with Playwright on the local dev server (sign-in, join, change plan, cancel steps, buy a shirt, upload a photo), with screenshots on mobile and desktop for an on-brand check;
- README sections and `.env.example` updated in the same PR.

New env vars across all phases:
- `PLAYER_SESSION_SECRET`, `AUTH_CODE_SECRET`;
- `PHOTO_BLOB_READ_WRITE_TOKEN` (public store), with R2 keys as an alternative;
- `GOOGLE_VISION_ENABLED`, which reuses the existing service account;
- `STRIPE_PORTAL_CONFIGURATION_ID`;
- the Firebase, reCAPTCHA and SMS cap settings listed in §3.

### Sources for pricing above
- Google Identity Platform pricing: https://cloud.google.com/identity-platform/pricing
- Identity Platform quotas (SMS limits): https://docs.cloud.google.com/identity-platform/quotas
- Firebase Auth limits: https://firebase.google.com/docs/auth/limits
- iOS 26 home screen web apps: https://www.macrumors.com/guide/ios-26-safari-features/ and https://heise.de/-10749652
- Chrome installability criteria: https://developer.chrome.com/blog/update-install-criteria
- Viewport Segments API (foldables): https://developer.chrome.com/blog/viewport-segments-api-shipped and https://developer.mozilla.org/en-US/docs/Web/CSS/@media/horizontal-viewport-segments
- iPhone Duo / foldable iPhone reports: https://www.macrumors.com/roundup/iphone-duo/ and https://www.macrumors.com/guide/foldable-iphone/
- Identity Platform `accounts.sendVerificationCode`: https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/sendVerificationCode
- Telegram Gateway: https://core.telegram.org/gateway
- Twilio Verify pricing: https://www.twilio.com/verify/pricing
- Cloud Vision pricing: https://cloud.google.com/vision/pricing
- Vercel Blob usage and pricing: https://vercel.com/docs/vercel-blob/usage-and-pricing
- Resend free tier (third-party summary; confirm at resend.com/pricing): https://www.activepieces.com/blog/resend-pricing-2026-free-tier-plans-and-limits
- Stripe Customer Portal retention offers: https://docs.stripe.com/billing/retention/rules and https://docs.stripe.com/customer-management/cancellation-page
