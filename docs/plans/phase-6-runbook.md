# Phase 6 runbook: the Luvallplay website

How the public website is put together, and the steps only a person can do. Written for the owner; no coding needed.

Status on 24 Nov 2026: **Stage A (the public website) is built, tested and live on https://luvallplay.com** (`SITE_ORIGIN` already points there). What is still open from Stage A, checked on 25 Nov, is in §7a. **Stage B (club websites, the setup wizard and payments) started on 25 Nov as lane W: see §10.**

## 1. What exists

| Thing | Where | Notes |
|---|---|---|
| Website code | `apps/site` | Next.js, pre-rendered, English and Vietnamese |
| Content Studio code | `apps/site-studio` | Deployed to Sanity once the project exists (step 3) |
| Vercel project | **luvallplay-site** in "Timba Le's projects" (`prj_yASKsAxOtjk94FTkKXdpGm4DR5Ug`), root directory `apps/site`, production branch `main` | Separate from the Three Wolves project |
| Default address | `https://luvallplay-site.vercel.app` | Works as soon as the code is on `main` |
| Domains | All four are attached to the project and wait only for DNS (step 2) | |
| Database | Not created yet (step 4) | A small one for form submissions only |
| Content | Seeded in the repo, so the site is complete before Sanity is connected | 14 help articles, FAQ, legal pages, all sections, in both languages |

Until go-live the site tells search engines to stay away (`noindex`, and `robots.txt` disallows everything).

## 2. DNS: connect the four domains

The domains are already added to the Vercel project. Vercel found these name servers: **luvallplay.com uses Crazy Domains** (`ns1.crazydomains.com`), **luvallplay.vn uses a Vietnamese registrar's DNS** (`a.dns-servers.vn` …). Add the records below where each domain's DNS is managed. Nothing about threewolvesbadminton.org changes.

For **each** of luvallplay.com, luvallplay.org, luvallplay.nz and luvallplay.vn:

| Type | Name (host) | Value | Notes |
|---|---|---|---|
| A | `@` (the bare domain) | `216.198.79.1` | Replace any existing A record on `@` (luvallplay.com currently points at a parking page, `27.124.125.171`) |
| A | `@` | `64.29.17.1` | A second A record, for resilience. If the registrar allows only one, the first is enough |
| CNAME | `www` | `1451f4d0a2fe055a.vercel-dns-017.com.` | Replace any existing `www` record |

If a registrar refuses those, Vercel's older values also work: A `76.76.21.21` and CNAME `cname.vercel-dns.com.`

What each domain then does (already set up in Vercel):

| Address | Behaviour |
|---|---|
| `luvallplay.com` | The site. English at `/en`, Vietnamese at `/vi` |
| `luvallplay.vn` | The same site, opening in Vietnamese |
| `luvallplay.org`, `luvallplay.nz` | Redirect to `luvallplay.com` |
| `www.` of each | Redirects to its bare domain (the `.org` and `.nz` ones to `luvallplay.com`) |

**The players' app (Phase 4):** `app.luvallplay.com` is attached to the separate Vercel project `luvallplay-app`. While luvallplay.com's DNS is on Vercel's name servers it needs no record from you. If the DNS is managed elsewhere, add CNAME `app` → `0614f58185a129ba.vercel-dns-017.com.` (details: `phase-4-runbook.md` §3).

Vercel issues the SSL certificates by itself once the records are visible (minutes to a few hours). Check in Vercel → luvallplay-site → Settings → Domains: each should show "Valid configuration".

**After DNS works**, tell Claude (or do it in Vercel → Settings → Environment Variables, Production):
1. Change `SITE_ORIGIN` from `https://luvallplay-site.vercel.app` to `https://luvallplay.com`.
2. Add `SITE_VI_ORIGIN` = `https://luvallplay.vn`.
3. Redeploy. Links in emails, the sitemap and the language tags then use the real domains.

## 3. Sanity: the content Studio

You chose to create a separate Sanity organisation for the company.

1. At sanity.io/manage create an organisation (for The GOAT Solution) and, inside it, a project named **Luvallplay** with a dataset named `production`.
2. Invite Claude's Sanity connection to that organisation, or tell Claude the **project ID** (it looks like `abc123xy`).
3. Claude then: deploys the Studio to `https://luvallplay.sanity.studio`, seeds the content from the repo, adds the read token and project ID to Vercel, and sets up the publish webhook. (By hand: `SANITY_STUDIO_PROJECT_ID=<id> pnpm --filter site-studio deploy`, then `SANITY_PROJECT_ID=<id> SANITY_API_WRITE_TOKEN=<token> pnpm --filter site sanity:seed`.)
4. Webhook (sanity.io/manage → API → Webhooks): URL `https://luvallplay.com/api/revalidate` (the vercel.app address before DNS), trigger on create, update and delete, secret = the value of `SANITY_WEBHOOK_SECRET` in Vercel. Published changes then show on the site within about a minute, with no deploy.

**Inviting editors:** sanity.io/manage → the Luvallplay project → Members → Invite, role Editor. They sign in at the Studio address.

**Publishing content:** open the document, edit both the English and the Vietnamese box, press Publish. A text field left empty in one language is refused.

**Draft preview:** `https://<site>/api/draft?secret=<SANITY_PREVIEW_SECRET>&path=/en/pricing` shows unpublished changes in that browser; `/api/draft?off=1` leaves preview. (Needs `SANITY_API_READ_TOKEN` in Vercel.)

**The launch switch (no redeploy):** Studio → Site settings.
- **Launch mode**: "Coming soon" sends *Start your club*, *Get the app* and the store badges to the waitlist forms. "Live" sends them to the setup wizard and the stores: fill in the wizard link and store links first. A button without its link stays on the waitlist, so nothing can lead to a dead page.
- **Let search engines index the site**: off until go-live. Switching it on removes `noindex` and opens `robots.txt`, on the production site only.
- **Scheduling link**: paste a booking link and *Book a walkthrough* opens it; empty, it is a request form.
- **Company name, postal address, contact email**: shown in Privacy and Terms.

## 3a. Keeping "what's live" right as features ship

The website never decides by itself what is available. One list does: **Availability**.

- In the code: `apps/site/content/availability.ts`. In the Studio (once connected): the **Availability** document. The Studio's version wins; a feature added in code that the Studio doesn't have yet still shows, from the code.
- Each line has a status: **Live** (open to everyone it is meant for), **Early access** (real, but only for some: the note says who), or **Coming soon**.
- What reads from it: the "Coming soon" chips on the home page tools, the Vision note, the store-apps note, the footer's store line, the status box at the top of help articles (each article lists the features it is about), and the page **What's live today** (`/en/availability`, `/vi/availability`).

**When a feature ships** (this is part of the work, not a follow-up):
1. In the same pull request, change its line in `content/availability.ts`: status, the one-sentence note in English and Vietnamese, and the `updated` date. The pull request template has a tick box for it.
2. Run `pnpm --filter site test`. It fails if a page, help article or FAQ answer still says "coming soon" about something now marked live, and names the sentence. Fix the wording.
3. After the merge, make the same change in the Studio's Availability document (or re-seed it), so the live site and the code agree.

Sports have their own switch (Studio → Sports → status), and the store badges also need their links (Site settings).

## 4. Database for the forms (about two minutes)

The forms store submissions in a small database of the site's own, not the Three Wolves database. Your Neon account is managed through Vercel, so it has to be created from Vercel:

1. Vercel → **Storage** → **Create Database** → **Neon** (Serverless Postgres).
2. Name `luvallplay-site`, region **Sydney (ap-southeast-2)**, the free plan.
3. **Connect Project** → choose **luvallplay-site** → environments Production and Preview → under *Advanced*, set **Environment Variables Prefix** to `SITE` (this creates `SITE_DATABASE_URL`, the name the site reads) → Connect.
4. Redeploy the site (Deployments → latest → Redeploy). The build creates the three tables by itself.

Until this is done the pages work but sending a form shows "That didn't go through".

## 5. Email (Resend)

Emails are the confirmation link (double opt-in) and a note to the team when someone confirms. They are sent **only from the production site**; previews and local runs capture them instead.

1. In Resend → Domains → Add `luvallplay.com`. Resend shows three or four DNS records (an MX and a TXT on `send.luvallplay.com`, a DKIM TXT on `resend._domainkey`, and optionally a DMARC TXT). Add them at Crazy Domains exactly as shown, then press Verify.
2. Create an API key (sending access only) and add it in Vercel → luvallplay-site → Environment Variables → `RESEND_API_KEY`, Production only, marked Sensitive.
3. Redeploy.

Already set in Vercel: `EMAIL_FROM` = `Luvallplay <hello@luvallplay.com>`, `TEAM_NOTIFY_EMAIL` = your address.

## 6. Environment variables (Vercel → luvallplay-site)

| Name | Set? | What it is |
|---|---|---|
| `SITE_ORIGIN` | yes (vercel.app for now) | The site's public address. Change at go-live (step 2) |
| `SITE_VI_ORIGIN` | at go-live | `https://luvallplay.vn` |
| `SITE_DATABASE_URL` | step 4 | The forms database |
| `RESEND_API_KEY` | step 5 | Sends email (production only) |
| `EMAIL_FROM`, `TEAM_NOTIFY_EMAIL` | yes | Sender, and the inbox for submissions |
| `RATE_LIMIT_SALT`, `CRON_SECRET` | yes | Spam protection; the daily clean-up job |
| `SANITY_PROJECT_ID`, `SANITY_API_READ_TOKEN` | step 3 | Content |
| `SANITY_WEBHOOK_SECRET`, `SANITY_PREVIEW_SECRET` | yes | Publish webhook; draft preview |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | optional | Cloudflare Turnstile. Add both and the forms show the check; without them the hidden-field trap and rate limit protect the forms |

## 7. Go-live checklist

1. DNS valid for all four domains (step 2); `SITE_ORIGIN` and `SITE_VI_ORIGIN` changed; redeployed.
2. Forms database connected (step 4) and one test submission confirmed by email (step 5).
3. Studio live, content reviewed. **A Vietnamese speaker has read the Vietnamese pages** (build plan §7.4).
4. Company legal name, postal address and contact email filled in (Site settings). Privacy and Terms read by you. They are plain-language website notices, not legal advice, and not the product terms (readiness gate 1).
5. Studio → Site settings → **Let search engines index the site** → on.

## 7a. Stage A: what is still open (checked 25 Nov 2026)

Checked in Vercel and Sanity, read-only. None of these blocks Stage B.

| Item | State on 25 Nov | What you do |
|---|---|---|
| luvallplay.com | **Working** | Nothing |
| luvallplay.nz | **Working** (redirects to luvallplay.com) | Nothing |
| luvallplay.org | Attached, on Vercel's name servers, but **has no address record**, so it doesn't open | Vercel → Domains → luvallplay.org → add A `@` → `216.198.79.1` (and `www` CNAME as in §2). Or say the word and Claude adds the records |
| luvallplay.vn | **Not attached to the project** (the list in Vercel has .com, .org and .nz only), and its DNS is still at the Vietnamese registrar with no records | Add the two records from §2 at the registrar; then attach `luvallplay.vn` and `www.luvallplay.vn` to luvallplay-site (Claude can do the attaching) and set `SITE_VI_ORIGIN` |
| Sanity organisation | **Not created**: the only organisation is Three Wolves', with its one project | §3, step 1 |
| Forms database | **Not connected**: `SITE_DATABASE_URL` isn't set, so sending a form shows "That didn't go through" | §4 (about two minutes) |
| Email (Resend) | **Not connected**: `RESEND_API_KEY` isn't set on luvallplay-site; the DNS records couldn't be checked from the build environment | §5 |
| Vietnamese copy review | Not recorded anywhere as done | A Vietnamese speaker reads `/vi` (§7, step 3) |

## 8. Housekeeping the site does by itself

- Unconfirmed sign-ups are deleted after 30 days; rate-limit records after a day (a daily job, 15:17 UTC).
- Every email has a "Remove my details" link that deletes the person's row.
- The only cookie is `lang` (the language choice). Analytics is Vercel Web Analytics, which sets none: switch it on in Vercel → luvallplay-site → Analytics → Enable.

## 9. Checks

`pnpm --filter site test` (both languages complete, content rules) and `pnpm --filter site e2e` (every link, meta tag and anchor, axe in light and dark, motion rules, the forms through double opt-in). Both run in CI on every pull request ("Website" job).

## 10. Stage B (lane W): club websites, the setup wizard and payments

Started 25 Nov 2026 (decision AP). W1 needs nothing from another lane; W2 (the wizard creating clubs, Admin → Modules, Look & feel, Payments, custom domains) waits for Phase 3 step 11 and Track A's A1–A3. No outside club before the four gates in build plan §11.3.

### 10.1 W1 progress

| Step | State | Notes |
|---|---|---|
| 1. Every card flow behind the payments interface; one membership path | **Built, waiting for your OK to merge** (branch `claude/lane-w`) | §10.2 |
| 2. Stripe Connect in test mode | **Part built, off** (same branch): the connected account on every request, the 0% fee, the Connect webhook secret. Creating and onboarding accounts waits for the test key | §10.4. Needs a Stripe **test** key for the platform account (§10.3) |
| 3. Per-club website content model, templates, Look & feel | Not started | |
| 4. Stage A open items | Checked | §7a |

### 10.2 Step 1: what changed, and how it's proven safe for Three Wolves

**What a member or admin sees: nothing.** The same screens, prices, receipts and emails.

**What changed underneath:**
- The shared payments interface (`packages/core/src/payments.ts`) now covers **customers and saved cards**, **subscriptions** (start, start later on a saved card, change at renewal, stop and carry on, a free renewal, free days) and **a payment page the provider hosts**, as well as one-off payments. Each part is there only when the provider declares it, so a provider that can't charge again by itself (VietQR) is refused cleanly and the screens fall back to one-time memberships with reminders.
- **One membership path**: `apps/web/lib/payments/membership.ts`. The website's join route and the players' app used to build the same Stripe requests separately and had started to drift; both now call the same function. Casual-session payments are shared the same way.
- Membership self-service (change plan, cancel, resume, update card, switch to auto-renew), monthly donations, Vision passes in the app, and the admin's "cancel" and "free month" all go through the interface.
- The Stripe client is made in exactly one place (`lib/payments/stripe-client.ts`), which is where a club's connected account goes in step 2.
- **Files that call Stripe directly: 15 → 11**, and the 11 left belong to other lanes (admin pages, the webhook's handlers, the ledger sync, offline invoices, the set-up check). They move in small `[lane W]` pull requests. A test lists them, and the list can only shrink.

**The proof** (`apps/web/tests/stripe-requests.test.ts`): before touching anything, a test recorded every request Three Wolves' card flows send to Stripe, 58 scenarios (joining with and without auto-renew, renewing, changing plan, cancelling and resuming, card updates, billing details, donations, casual play, Vision passes, the admin's free month and free days, refusals and errors), together with what each answers to the browser. The recording was made from the old code. The new code must produce exactly the same recording, and does. A second check ran the final test against the old code again and compared the two recordings: identical.

**Three small differences, none visible to members:**
1. One-time membership payments are now counted in the club's "payments started" usage figure, like every other payment (they were missed because they bypassed the interface).
2. In the players' app, joining when Stripe has no key now stops before a place is reserved (as the website already did), instead of after.
3. Errors from Stripe in these flows are now the interface's own error type; the message shown is unchanged.

**Not covered by the recording**, because they need a database: the one-time renewal from the profile and the switch from one-time to auto-renew. Their Stripe requests are pinned by a separate test written out from the old code, and the web journeys (M1–M5) cover them end to end.

**Before merging** (this touches live payments, so it waits for your OK): CI green, then the web journeys M1–M5 on the preview with Stripe test cards.

### 10.3 What lane W needs from you

1. **Your OK to merge step 1** (§10.2).
2. **A Stripe test key for the platform account** (starts `sk_test_`), for Stripe Connect in test mode. Claude asks for it through a secure form; it is never pasted into chat, and production keys are never used. If the NZ company's Stripe account doesn't exist yet, a test key from any Stripe account with Connect switched on (Settings → Connect) is enough to build against.

### 10.4 Step 2: Stripe Connect, test mode

How it works (build plan §6.5): the platform's Stripe key acts **on a club's own Stripe account** ("direct charges"). The money, customers, subscriptions and payouts are the club's; Luvallplay never holds them.

Built so far, and **switched off unless the first setting below is set** (Three Wolves' deployment has none of them, so nothing changes for it):

| Setting | What it does |
|---|---|
| `STRIPE_CONNECT_ACCOUNT` | The club's connected account (`acct_…`). The account is put on the Stripe client itself (`lib/payments/stripe-client.ts`), so **every** request carries it; a test fails if any file makes its own client or names an account on a single call |
| `STRIPE_CONNECT_FEE_BPS` | The platform's fee in basis points (100 = 1%). Unset or `0` = **0%**, and then nothing about a fee is sent to Stripe |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | The signing secret of the platform's Connect webhook endpoint. Events signed with it are accepted beside the account's own, and carry the account they belong to |

Safety rules, each with a test (`apps/web/tests/stripe-connect.test.ts`): a connected account **with a live key is refused**, on production too (W1 is test mode only); an account id or fee that isn't well formed stops the app instead of guessing.

Still to do in step 2, once the test key is here (so each call is tried against Stripe's test mode, not assumed): creating a connected account for a new club, the onboarding link, reading whether the account can take payments and be paid out, connecting an **existing** account (Three Wolves' own is connected, not recreated), and the webhook's handlers reading the event's account (a `[lane W]` change to the webhook route). The account moves from a deployment setting to the club's own payment settings with the wizard (W2), through the migration queue.
