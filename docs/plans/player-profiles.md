# Plan: Player accounts, profiles, shop, leaderboard & photo sharing

Status: **draft for review**. Nothing has been built yet.

**Decided (16 Nov):**
- email **and** SMS login codes from day one;
- attendance comes from the court board, the round robin and admin ticks;
- the round robin leaderboard ranks by RR points (2 per win), with ties broken by point difference;
- the cancel/downgrade flow has the extra steps but **no discount offer**.

The remaining open questions are in §12.

---

## 1. Summary

Players get a Three Wolves account and sign in **without a password**, using a 6-digit code sent to their email or phone. The profile has three tabs:

| Tab | What it does |
|---|---|
| **Account** | Edit name and phone. Email is shown but can't be edited. Message thread with the admins. |
| **Membership** | Current plan, upgrade or downgrade (downgrade has a few extra steps), auto-renew on/off, payment method and invoices, play calendar to book and pay, **Shop** (club jersey plus later merchandise). |
| **Player profile** | Play days attended, round robin results, streaks and charts, photo uploads that feed the main site Gallery after an automatic safety check. |

Other new pieces:
- a public **/leaderboard** page;
- three new admin pages: **Inbox**, **Shop** and **Photos**;
- a versioned **API with webhooks and an MCP server**, so habit trackers such as q.buzz can read and write player activity.

Changes to the main site:
- the emailed cancellation flow is removed;
- a membership sign-up now creates an account;
- casual bookings still work as guest checkout, with an invitation to create an account;
- the Gallery lightbox gets a **Download original** button.

**Expected running cost: about $0/month** on the current stack. The only item that can cost money is SMS codes: the first 10 a day are free, then about US$0.08 each (§3).

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
| SMS via Firebase / Google Identity Platform | First **10 SMS/day free**, then about **US$0.08 per SMS to NZ** | Optional add-on. Near-free at club scale, but needs a Google Cloud billing account, the Firebase JS SDK and reCAPTCHA (CSP changes). |
| SMS via Twilio Verify | About **US$0.05 per verification plus the NZ SMS fee**; failed sends are still charged | ❌ Costs more than Firebase |
| Telegram Gateway | About **US$0.01 per delivered code**; undelivered codes are refunded | Cheap, but only works for players who use Telegram |
| Clerk, Auth0, Supabase Auth | Email codes free on their free tiers; SMS always paid | ❌ Adds a vendor, off-brand screens, and doesn't solve SMS cost |

**Decision:** launch with **email codes and SMS codes**.
- **Email codes** are built in-house and are free.
- **SMS codes** use **Firebase Authentication (phone)**. The first 10 texts a day are free, then about US$0.08 per text to NZ.
- Sessions last **90 days and extend with use**, so most players sign in only a few times a year. At club size that's realistically a handful of texts a week, so SMS should stay within the free 10 a day almost always.
- **Guards against SMS cost:**
  - Firebase's own reCAPTCHA;
  - our per-number and per-IP rate limits;
  - SMS restricted to NZ, AU and VN numbers (Firebase SMS region policy);
  - a Google Cloud **budget alert at US$5/month**.
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
5. The same email check is built into the membership sign-up modal, so joining never leaves the flow (§9).

**SMS code flow (Firebase):**
1. The login screen has two options: **Email me a code** and **Text me a code**.
2. For a text, the Firebase JS SDK, loaded **only on the login page** to keep other pages fast, sends the code and checks it in the browser.
3. Firebase returns a signed ID token. Our server verifies it with Google's public keys (`google-auth-library` is already a dependency) and reads the confirmed phone number.
4. That phone number is matched to `players.phone_e164`, and the server issues our **own** session cookie, exactly as for email. Firebase is only used to deliver and check the code, not to hold accounts.
5. **New players signing in by phone** still need an email: it's the key for Stripe and club emails. After the text code they enter their email and confirm it with an email code, once only. After that, either login method works.
6. **Existing players** add or confirm their phone from the Account tab, which sends a text code to verify it. Phone numbers must be unique across accounts.
7. CSP is updated, only where needed, for Firebase and reCAPTCHA (`www.gstatic.com`, `www.google.com/recaptcha`, `*.googleapis.com`).

New env vars: `PLAYER_SESSION_SECRET`, `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`.

---

## 4. Data model (new Postgres tables)

All tables are created idempotently in a new `lib/player-db.ts`, following the existing `ensure*Tables()` pattern.

```
players              id, email (unique, lowercased), first_name, last_name, display_name,
                     phone_e164 (unique), phone_verified_at, lang, stripe_customer_id, minigame_name, leaderboard_visible,
                     avatar_url, created_at, deleted_at
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
cancellation_feedback id, player_id, membership_id, action (downgrade|cancel|autorenew_off),
                     reason, comment, created_at
```

Linking existing records:
- A nullable `player_id` column is added to `memberships`, `bookings`, `jersey_registrations` and `session_fill_ins`.
- These are backfilled by email when an account is created. A one-off migration also creates accounts for everyone with an active membership, so existing members can sign in on day one with the email they already use.

**Stock is held in Postgres, not Sanity**, so that two people can't both buy the last shirt. Reserving a shirt is a single conditional `UPDATE … SET reserved = reserved + n WHERE stock - reserved >= n`. Unpaid holds are released after 15 minutes, the same idea as `PENDING_MEMBERSHIP_HOLD_MINUTES`.

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
- **Privacy:** show me on the leaderboard (on/off), download my data (JSON), delete my account. Payment records are kept as the law requires.
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
  - applied **at the next renewal** with a Stripe subscription schedule, so there are no confusing proration charges (Q7).
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
- **Men's / Women's** toggle, then a **size picker S, M, L, XL, 2XL, 3XL**:
  - each size shows a stock badge ("3 left", "Sold out");
  - sold-out sizes are disabled;
  - a link opens the size guide (the existing men's/unisex chart; a women's chart is needed, Q6).
- Optional print name and number, if we keep that option (Q6).
- **Pay by card through Stripe** (PaymentIntent). The shirt is held for 15 minutes during checkout.
- After paying, the order shows **"Paid: collect at your next play day"**. Admins mark it collected.
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

### 7.4 Where player photos are stored (Q5)

| Option | Free allowance | Notes |
|---|---|---|
| **Vercel Blob** (new *public* store) | 1 GB storage, 10 GB transfer/month on Hobby; Hobby pauses the feature if exceeded, it doesn't charge | Zero new accounts. Room for roughly 250–400 full-size phone originals. |
| **Cloudflare R2** | 10 GB storage, **free bandwidth** | About 10× the headroom. Needs R2 enabled in the club's Cloudflare account (already used for Turnstile) and a custom domain for public images. |

**Recommendation:** use **Vercel Blob** now, with storage usage shown on `/admin/photos`. Switch to R2 if it passes about 700 MB; the storage layer will be one small module, so switching is a config change.

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

For q.buzz itself, I need its API or webhook format before building a direct integration (Q8). Until then, the generic webhook plus `/api/v1` covers it.

---

## 9. Leaderboard: `/leaderboard` (public)

- **Two boards:**
  - **Play days attended**;
  - **Round robin points**, with wins and point difference as secondary columns.
- **Periods:** Month, Quarter (calendar quarters), Year and Lifetime, with ‹ › buttons to step back through past periods.
- **Look:** top 3 as a podium in gold, silver and bronze using the brand's bronze and steel tones. The rest is a clean ranked list with each player's display name and avatar initials. A signed-in player's own row is highlighted, and if they're outside the top 20, it's pinned at the bottom.
- **Privacy:** only players with accounts who have *Show me on the leaderboard* turned on (Q4). Names show as display name, or first name plus last initial.
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
| **`/jersey`** | Registration closed on 21 Oct. The page is kept as is for existing registrations; future jersey sales go through the Shop. (Q6) |
| **Gallery** | Combined pool, photo credits, lazy thumbnails, **Download original** button, and a `/gallery` "see all" page. |
| **CSP** (`next.config.ts`) | Add the photo storage host to `img-src` and `connect-src` (for direct uploads). |

### Admin additions
- **Inbox** (`/admin/inbox`):
  - threads with unread ones first, an unread badge on the nav tab, reply, close and reopen;
  - links to the player's admin record.
- **Shop** (`/admin/shop`):
  - products (create and edit, EN/VI, images, price, active, order);
  - a stock grid of **Men's / Women's × S–3XL** with +/− and set-to-number, plus a low-stock highlight;
  - orders (paid → collected, refund) and Excel export using the existing `exceljs`;
  - seeded with the Port Hills Dawn jersey.
- **Photos** (`/admin/photos`): the moderation queue (§7.2).
- **Players** (`/admin/players`):
  - accounts list and search;
  - change email (updates Stripe too), merge duplicates;
  - attendance edits, mini game name and tier.
- **Play days:** an attendance tick column.

---

## 11. Cost, performance, security

### Monthly cost

| Item | Service | Free allowance | Expected cost |
|---|---|---|---|
| Email login codes and notifications | Resend (existing) | 3,000/month, 100/day | $0 |
| SMS login codes | Firebase / Identity Platform | 10/day | $0 at club scale; about US$0.08 per SMS beyond 10/day (budget alert at US$5) |
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

## 12. Open questions (with recommended defaults)

1. ~~Phone codes~~: **decided**, email and SMS (Firebase) from day one.
2. ~~Attendance~~: **decided**, court board (≥1 finished game), round robin, and admin ticks.
3. ~~Round robin score~~: **decided**, RR points (2 per win), with ties broken by point difference.
4. **Leaderboard privacy:** shown by default with an opt-out, or hidden by default with an opt-in? Show first name plus last initial, or the display name the player chooses? *Default: shown, opt-out, display name.*
5. **Photo storage:** Vercel Blob now and move later if needed, or Cloudflare R2 from the start? *Default: Blob now.*
6. **Jersey in the shop:**
   - price;
   - keep optional print name and number (+$5)?
   - card payment through Stripe instead of bank transfer?
   - pick up at a play day?
   - starting stock per size and fit;
   - a **women's size chart** is needed;
   - the old registration offered S–XXL, while the shop will offer S–3XL.
7. **Membership changes:** should upgrades apply at the **next renewal** (default) or immediately with a prorated charge? The retention offer is **decided: none**.
8. **q.buzz:** is there an API or webhook spec to target, and which direction matters most first: sending our data out, or receiving their check-ins?

---

## 13. Delivery plan (one PR per phase, matching the repo's one-feature-per-PR history)

| Phase | Scope | Depends on |
|---|---|---|
| **0. Quick win** | Gallery lightbox **Download original** button | none |
| **1. Accounts** | `players`, `auth_codes`, `player_sessions`, email-code login **and Firebase SMS login**, nav Log in and avatar, `/profile` shell, backfill of existing members, Account tab details including phone verification | Firebase project set up |
| **2. Messaging** | Threads and messages, Account tab inbox, `/admin/inbox`, email notifications | 1 |
| **3. Membership tab** | Plan status, upgrade and day change, step-by-step downgrade and cancel, auto-renew on/off, update card (Portal), invoices, calendar booking, "can't make it". Main site: remove the emailed cancel flow, require an account for membership sign-up, invite casual bookers to create an account | 1, Q7 |
| **4. Shop** | Products, variants, orders, stock holds, Stripe checkout, `/admin/shop`, seeded jersey with cropped images, Financials category | 1, Q6 |
| **5. Player stats and leaderboard** | Attendance capture from the board, mini game and admin; mini game roster moved to the database; `rr_results` with backfill; Player profile stats and charts; `/leaderboard` | 1, Q4 |
| **6. Photos** | Upload, GPS removal, SafeSearch, admin queue and alerts, Gallery merge and credits, `/gallery` | 1, Q5 |
| **7. Integrations** | `/api/v1`, tokens, webhooks, MCP server, iCal feed | 5, Q8 |

**Verification for every phase:**
- `next build` and lint;
- small `node --test` unit tests for the pure logic (code hashing and expiry, stock holds, period maths, leaderboard ranking);
- an end-to-end run in Stripe **test mode** with Playwright on the local dev server (sign-in, join, change plan, cancel steps, buy a shirt, upload a photo), with screenshots on mobile and desktop for an on-brand check;
- README sections and `.env.example` updated in the same PR.

New env vars across all phases:
- `PLAYER_SESSION_SECRET`, `AUTH_CODE_SECRET`;
- `PHOTO_BLOB_READ_WRITE_TOKEN` (public store), with R2 keys as an alternative;
- `GOOGLE_VISION_ENABLED`, which reuses the existing service account;
- `STRIPE_PORTAL_CONFIGURATION_ID`;
- the Firebase keys listed in §3.

### Sources for pricing above
- Google Identity Platform pricing: https://cloud.google.com/identity-platform/pricing
- Telegram Gateway: https://core.telegram.org/gateway
- Twilio Verify pricing: https://www.twilio.com/verify/pricing
- Cloud Vision pricing: https://cloud.google.com/vision/pricing
- Vercel Blob usage and pricing: https://vercel.com/docs/vercel-blob/usage-and-pricing
- Resend free tier (third-party summary; confirm at resend.com/pricing): https://www.activepieces.com/blog/resend-pricing-2026-free-tier-plans-and-limits
- Stripe Customer Portal retention offers: https://docs.stripe.com/billing/retention/rules and https://docs.stripe.com/customer-management/cancellation-page
