# Setting up player accounts: step by step

This is everything to do so player accounts, the profile app, the shop, photos and SMS sign-in work right after merging.

**Do the steps in this order.** Steps 1–3 take about 15 minutes and are all you need for launch. Steps 4–5 (photo safety check and SMS codes) are optional and can come later: until then the site simply works without them.

**Checking your work:** after any step, open **Admin → Players → Setup check** (`/admin/setup`). It tests each service live and says exactly what's wrong if something isn't right.

| What | Works straight after merging? |
|---|---|
| Email sign-in, profile, messages, Membership tab, play calendar, leaderboard, API | ✅ Yes (needs your existing Resend and Stripe settings) |
| “Update card” in the Membership tab | After **step 2a** |
| Shop: card payments and cash reservations | ✅ Yes, once you enter stock (step 7) |
| Shop: uploading new product photos and size charts | After **step 3** |
| Players sharing photos | After **step 3**. Without step 4, every photo waits for you to approve it. |
| Automatic photo safety check | After **step 4** |
| Sign-in by text message | After **step 5** |

Nothing needs a database migration: the new tables are created automatically the first time they're used.

---

## Step 1. Environment variables in Vercel (5 minutes)

Vercel → your project → **Settings → Environment Variables**. Add each variable to **Production** and **Preview**.

1. **`PLAYER_SESSION_SECRET`**: a long random string. Generate one with:

   ```bash
   openssl rand -base64 48
   ```

   (Without it, sign-in still works using a key derived from `ADMIN_PASSWORD`, but set it now so changing the admin password never affects players.)

2. **Check these already exist** (the site uses them today), and that their values are right:
   - `NEXT_PUBLIC_SITE_URL` = `https://threewolvesbadminton.org`: the real domain, no trailing slash. Sign-in emails link here.
   - `RESEND_API_KEY` and `EMAIL_FROM`: sign-in codes are emailed with these.
   - `ALERT_ADMIN_EMAILS`: who gets admin alerts (new messages, shop orders, blocked photos, members cancelling), comma-separated. If empty, alerts go to `CLUB_ROSTER_EMAIL`.
   - `CRON_SECRET`: Vercel sets it automatically for projects with cron jobs.
   - `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and the four `STRIPE_PRICE_*` variables. Plan changes use the same prices as sign-up.

3. **Leave these until steps 3–5:** the photo store (step 3 adds `PHOTO_STORE_ID`), `GOOGLE_VISION_ENABLED`, `FIREBASE_API_KEY`, `SMS_FREE_LIMIT_24H`.

Environment variable changes only apply to new deployments. Merging redeploys anyway; if you add one later, use **Deployments → ⋯ → Redeploy**.

---

## Step 2. Stripe (5 minutes)

Do this in **live mode**, and again in **test mode** if you test with test keys. Switch with the **Test mode** toggle at the top right of the Stripe Dashboard.

### 2a. Customer portal (for the “Update card” button)

Stripe Dashboard → **Settings** (gear) → **Billing → Customer portal**.

1. **Payment methods:** turn **on** “Customers can update payment methods”.
2. **Invoices:** “Invoice history” can be on or off. The profile shows receipts itself.
3. **Subscriptions:**
   - **Cancel subscriptions: OFF.** Cancelling happens in the profile, through its steps.
   - **Switch plans: OFF.** Plan changes happen in the profile, at the next renewal.
   - **Pause subscriptions: OFF.**
4. **Business information:** add your privacy policy / terms links if Stripe asks for them.
5. Click **Save**.

Optional: if you keep several portal configurations, copy this one's ID (`bpc_…`) into `STRIPE_PORTAL_CONFIGURATION_ID`. Otherwise the default configuration is used.

### 2b. Webhook events

Stripe Dashboard → **Developers → Webhooks** → your endpoint `https://threewolvesbadminton.org/api/stripe-webhook`. It must send at least:

- `payment_intent.succeeded` (casual bookings, one-time memberships, **shop card orders**)
- `invoice.payment_succeeded` (subscription sign-ups and renewals, including **scheduled plan and day changes**)
- `customer.subscription.updated`
- `customer.subscription.deleted`

These are the same events the site already uses, so there's probably nothing to change. Setup check confirms it.

Nothing else is needed in Stripe: no new products or prices. Shop sales show up in **Financials** under *Jersey & merchandise* automatically (card sales from the payment, cash sales when you tap “Paid cash & collected”).

---

## Step 3. Photo storage: a public Vercel Blob store (5 minutes)

The site's existing Blob store is **private** (it holds receipts). Player photos, shop photos and size charts need a separate **public** store.

1. Vercel → **Storage** → **Create Database / Store** → **Blob**.
2. Name it `three-wolves-photos`. Set **Access: Public**. Choose the region closest to NZ if asked (Sydney).
3. Click **Create**, then connect it to the `luvallplay` project (Production and Preview).
4. **Important:** under **Advanced options**, set the **custom prefix** to **`PHOTO`**. Vercel then adds `PHOTO_STORE_ID` and `PHOTO_WEBHOOK_PUBLIC_KEY`, and the site signs in to the store with the deployment's own short-lived token. There's nothing to copy. Without the prefix, the variables would be named for the receipts store (`BLOB_…`), and receipts must stay in a private store.
5. Redeploy. Setup check → Photos → **Photo storage: Working**.

*Older stores that show a `BLOB_READ_WRITE_TOKEN` (starts with `vercel_blob_rw_`):* instead of connecting, you can add that value as **`PHOTO_BLOB_READ_WRITE_TOKEN`**. If both are set, the token wins. Local development needs the token, because only deployments get the short-lived one.

**Free allowance:** 1 GB of storage and 10 GB of downloads a month. **Admin → Photos** shows how much is used. Past about 700 MB, ask me to move photos to Cloudflare R2 (10 GB free).

---

## Step 4. Photo safety check: Google Cloud Vision (optional, 5 minutes)

The site already has a Google service account (it reads the Google Calendar). The safety check reuses it.

1. Find the project: your `GOOGLE_SERVICE_ACCOUNT_EMAIL` looks like `name@PROJECT-ID.iam.gserviceaccount.com`. Open https://console.cloud.google.com and select **PROJECT-ID** at the top.
2. **Billing:** Google requires a billing account on the project, even though the first 1,000 images a month are free.
   - Go to ☰ → **Billing**.
   - If it says the project has no billing account, click **Link a billing account** (create one with a card if needed).
3. ☰ → **APIs & Services → Library** → search **Cloud Vision API** → **Enable**.
4. Vercel → Environment Variables → **`GOOGLE_VISION_ENABLED`** = `1`. Redeploy.
5. Setup check → **Safety check (SafeSearch): Working**. It sends Google a 1-pixel test image.
6. Add the **budget alert** in step 5h; it covers Vision too.

**What happens to each photo:**
- **Clear photos** go straight into the Gallery.
- **Doubtful photos** (rated “possible”) wait on **Admin → Photos**, and you get an email.
- **Inappropriate photos** (“likely” or above for adult, violence or racy) are blocked and hidden, and you get an email.

Sports photos are occasionally rated “possible racy” (bare arms and legs). Those just need a tap on **Approve**.

---

## Step 5. Sign-in by text message: Firebase (optional, 20 minutes)

**Cost:** Google's free allowance is 10 texts a day, and the site never sends more than `SMS_FREE_LIMIT_24H` (default 10) in any rolling 24 hours. When they're used up, the login page shows email sign-in only, so texts don't cost money. The budget alert in 5h is a backstop.

**a. Add Firebase to the same Google Cloud project**
1. Go to https://console.firebase.google.com and click **Create a project**.
2. Choose **Add Firebase to an existing Google Cloud project**, and pick the PROJECT-ID from step 4.
3. Google Analytics: **off**. Click **Continue**.

**b. Blaze plan.** Phone sign-in needs the Blaze (pay-as-you-go) plan. In Firebase, click **Upgrade** (bottom left) → **Blaze** → choose the same billing account. You won't be charged within the free 10 a day.

**c. Turn on phone sign-in.** **Build → Authentication** → **Get started** → **Sign-in method** → **Add new provider** → **Phone** → **Enable** → **Save**.

**d. Authorised domains.** **Authentication → Settings → Authorized domains** → **Add domain**:
- `threewolvesbadminton.org`
- `www.threewolvesbadminton.org`
- your Vercel domain (e.g. `luvallplay.vercel.app`), so Preview deployments work too.

**e. SMS region policy.** **Authentication → Settings → SMS region policy** → **Allow** → New Zealand, Australia and Vietnam → **Save**. This blocks expensive SMS fraud to other countries.

**f. API key**
1. Firebase → ⚙️ **Project settings → General** → copy the **Web API Key**. If none is shown, click **Add app → Web** (any nickname, no hosting), then copy it.
2. Lock it down: Google Cloud console → **APIs & Services → Credentials** → open that key (usually “Browser key (auto created by Firebase)”).
   - **API restrictions:** **Restrict key** → tick **Identity Toolkit API** (and **Token Service API** if listed).
   - **Application restrictions:** **None.** The site calls Google from its server, so a website or IP restriction would block it. The key stays secret on the server.
   - Click **Save**.

**g. Vercel environment variables**
- `FIREBASE_API_KEY` = the Web API Key
- `SMS_FREE_LIMIT_24H` = `10`

Redeploy. Setup check → SMS → **Firebase key and reCAPTCHA: Working**.

**h. Budget alert (covers SMS and Vision).** Google Cloud console → ☰ → **Billing → Budgets & alerts** → **Create budget**:
- Scope: this project.
- Amount: **US$1**.
- Alert thresholds: 50% and 100%, emailing billing admins.
- Click **Finish**.

You'll get an email if any charge appears, however it happened.

**i. Free test numbers (optional).** **Authentication → Sign-in method → Phone → Phone numbers for testing** → e.g. `+64 21 000 0000` with code `123456`. Signing in with that number sends no real text. It still counts toward the site's 10.

**j. Switch on/off.** **Admin → Players → SMS sign-in** shows texts used in the last 24 hours and has a **Turn SMS sign-in off** button.

**If a text code fails with “Please complete the check”:** Google may be enforcing reCAPTCHA Enterprise for phone sign-in on this project (Authentication → Settings → **reCAPTCHA** / “SMS defense”). Set phone authentication enforcement to **Off** or **Audit**, then try again. If it still fails, switch SMS off on Admin → Players (email sign-in keeps working) and tell me what Setup check says.

---

## Step 6. Merge and deploy

1. Merge the pull request. Vercel deploys automatically.
2. Open `https://threewolvesbadminton.org/admin/setup`. Everything you set up should say **Working**. Optional parts you skipped say **Switched off**, which is fine.

---

## Step 7. First-day admin tasks (15 minutes)

All on **Admin → Players** unless noted.

1. **Create accounts for current members**
   1. Click **Preview import** and check the list. Any “Possible duplicate” means the same Gmail inbox is written two ways (e.g. `jo.smith@` and `josmith@`). After creating accounts, use **Change email** in the player list so the member has one account.
   2. Click **Create accounts**. It's safe to run again later.
2. **Link the mini game names.** For each of the 16 names, pick the member's account and click **Save**. This connects round robin results to profiles and the leaderboard.
3. **Fill in history:** click **Run backfill**. It records play days from saved court boards, round robin results from past draws, and paid casual bookings on older days. Safe to re-run.
4. **Stock the shop:** **Admin → Shop** → enter the number on hand for each Men's / Women's size → **Save stock**. The jersey stays hidden from players while every size is 0.
5. **Size charts** (whenever you have them): **Admin → Shop** → Size charts → **Upload** for Men's and Women's. Until then players see “Size guide coming soon”.
6. **Welcome emails**
   1. Click **Send me a preview** and check it.
   2. Click **Send welcome emails**. It sends up to 40 per click (Resend's free plan allows 100 emails a day, including rosters and reminders).
   3. If you have more than 40 members, click again the next day.

---

## Step 8. Try it yourself (15 minutes)

Do this on production with your own phone. Payments are real if you use live keys, so refund your test payments afterwards. To test with Stripe **test mode** instead, use test card `4242 4242 4242 4242` (any future date, any CVC) on a deployment that has test keys.

- [ ] **Sign in:** on your phone, go to the site → **Log in** → email code. Check you land in the profile.
- [ ] **Home screen:**
  - The **Add to Home Screen** guide appears once.
  - Follow it, open Three Wolves from the home screen, and sign in once more inside the app.
  - On iPhone, check the code appears above the keyboard.
- [ ] **Membership** (if you're a member):
  - Your plan shows. **Update card** opens Stripe's page and comes back.
  - Try **Turn off auto-renew** up to the last step, then choose **Keep my membership**.
- [ ] **Play calendar:**
  - Tap **Can't make it** on one of your days, then **I can come after all**.
  - Book a casual session, then refund it in Stripe.
- [ ] **Shop:**
  - Reserve a shirt for cash. It appears in **Admin → Shop**; click **Cancel**.
  - If you like, pay by card, then **Refund** from Admin → Shop.
- [ ] **Messages:** send one from the Account tab. You get an email, and it's in **Admin → Inbox**. Reply, and you get an email.
- [ ] **Photos:** share a photo from the Player tab. It appears in the homepage Gallery (or on Admin → Photos to approve).
- [ ] **Leaderboard:** `/leaderboard` loads. Hide yourself in Account → Privacy and check you disappear.
- [ ] **SMS** (if set up): sign out, then **Text me a code**.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Something went wrong” when asking for an email code | Check `RESEND_API_KEY` / `EMAIL_FROM`, and that `EMAIL_FROM` is on a domain verified in Resend. Vercel → Logs shows the exact error. |
| Sign-in email links go to the wrong site | Set `NEXT_PUBLIC_SITE_URL` (step 1) and redeploy. |
| “Update card” shows an error | Customer portal not saved in this Stripe mode (step 2a). |
| A plan change didn't take effect at renewal | Check the webhook events (step 2b). **Admin → Members → Sync with Stripe now** repairs dates. |
| Photo upload fails immediately | The store isn't connected with the prefix `PHOTO` (no `PHOTO_STORE_ID`), the deployment predates the connection (redeploy), or the store is **Private**. Make a Public one (step 3). |
| Every photo waits for review | The safety check is off or failing: Setup check → Photos (step 4). |
| “Text me a code” doesn't appear | Not set up, switched off, or the free texts for the last 24 hours are used up (Admin → Players shows which). |
| Text code fails with “Please complete the check” | Authorised domains (5d) or reCAPTCHA enforcement (end of step 5). |
| A member says their account is missing | **Admin → Players → Create accounts** again, or they can simply sign in with their membership email: the account is created and their history attaches. |
| A member needs a different email | **Admin → Players → Change email**: updates the site and their Stripe customer together. |

---

## Running costs

| Service | Free allowance | Expected cost |
|---|---|---|
| Resend (email codes and notices) | 3,000 a month, 100 a day | $0 |
| Firebase SMS codes | 10 a day, enforced by the site | $0 |
| Google Cloud Vision | 1,000 images a month | $0 |
| Vercel Blob (photos) | 1 GB stored, 10 GB downloads a month | $0 |
| Stripe | no monthly fee | normal card fees on sales |

The US$1 budget alert (step 5h) emails you if anything on Google ever costs money.
