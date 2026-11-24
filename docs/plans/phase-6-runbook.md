# Phase 6 runbook: the Luvallplay website

How the public website is put together, and the steps only a person can do. Written for the owner; no coding needed.

Status on 24 Nov 2026: **Stage A (the public website) is built, tested and live on https://luvallplay.com** (`SITE_ORIGIN` already points there; luvallplay.vn, .org and .nz still need their DNS records). Stage B (setup wizard, club websites, admin settings) waits for Phase 3 to finish.

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

## 8. Housekeeping the site does by itself

- Unconfirmed sign-ups are deleted after 30 days; rate-limit records after a day (a daily job, 15:17 UTC).
- Every email has a "Remove my details" link that deletes the person's row.
- The only cookie is `lang` (the language choice). Analytics is Vercel Web Analytics, which sets none: switch it on in Vercel → luvallplay-site → Analytics → Enable.

## 9. Checks

`pnpm --filter site test` (both languages complete, content rules) and `pnpm --filter site e2e` (every link, meta tag and anchor, axe in light and dark, motion rules, the forms through double opt-in). Both run in CI on every pull request ("Website" job).
