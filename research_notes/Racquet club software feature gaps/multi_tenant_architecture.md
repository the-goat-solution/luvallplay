# Multi-Tenant White-Label SaaS Architecture (Next.js 15 / Vercel / Neon / Sanity / Stripe / Resend / Firebase) — research as of Nov 2026

> **Method and source caveat.** Direct page fetches to vercel.com, docs.stripe.com, neon.com, sanity.io and resend.com were blocked by this session's network policy (DNS failure). Primary-source material was gathered through official documentation search tools instead: Vercel docs search (Context7 index of vercel.com/docs), Stripe docs search (docs.stripe.com), and Sanity docs read (sanity.io/docs). Pricing for Neon, Resend, Sanity, and Firebase SMS came from web search snippets, mostly third-party aggregators, and **must be re-checked on the official pricing pages**. Items marked "(background knowledge, unverified)" come from the researcher's prior knowledge and could not be confirmed this session.

## 1. Multi-tenancy routing on Next.js/Vercel (subdomains, custom domains, SSL, theming, PWA manifests)

### Takeaway
Vercel now documents a first-party "Multi-tenant platforms" pattern: one shared project, with a `proxy.ts` (the Next.js 16 name for `middleware.ts`) that resolves the tenant from the `Host` header. It looks the tenant up in Vercel Global Config (formerly Edge Config) or the DB, then rewrites or sets `x-tenant-id` headers. Club custom domains are attached through the Vercel SDK/REST API (`addProjectDomain`), and Vercel issues SSL automatically. A sports-club SaaS should use this shared-project model, not one project per club.

### Cited Findings
- Vercel's multi-tenant docs show a `proxy.ts` that reads the `host` header. It checks for a custom-domain tenant (Global Config key `domain_<host>`), then a subdomain of `ROOT_DOMAIN` (key `subdomain_<sub>`), and sets `x-tenant-id` / `x-tenant-type` request headers. It also **strips any inbound `x-tenant-*` headers so clients can't spoof them**, and rewrites unmatched hosts to `/not-found`. The matcher excludes `api`, `_next/static`, `_next/image`, and favicon — [Vercel docs: Multi-tenant proxy and routing](https://vercel.com/docs/platforms/multi-tenant-platforms/proxy-and-routing)
- Global Config keys can contain only letters, digits, `_` and `-`, so hostnames must be normalised (`.` and `:` replaced) before lookup — [Vercel docs: proxy and routing](https://vercel.com/docs/platforms/multi-tenant-platforms/proxy-and-routing)
- An alternative is mapping the custom domain to a tenant through a DB lookup (`db.tenant.findFirst({ where: { customDomain: hostname } })`) — [Vercel docs: Multi-tenant concepts](https://vercel.com/docs/platforms/multi-tenant-platforms/concepts)
- Custom domains are added programmatically with `projectsAddProjectDomain` (`@vercel/sdk`) using a `VERCEL_TOKEN`, project `idOrName`, and `teamId`. "After adding, Vercel attempts to issue an SSL certificate automatically" — [Vercel docs: Multi-tenant quickstart](https://vercel.com/docs/platforms/multi-tenant-platforms/quickstart)
- If `addProjectDomain` returns `verified: false`, the platform must give the tenant a verification challenge (TXT record) and then call `verifyProjectDomain`. The docs warn that `verified` "only proves that the tenant owns the domain"; you must also call `domainsGetDomainConfig` and check `misconfigured === false` before telling the tenant the domain works — [Vercel docs: Multi-tenant reference](https://vercel.com/docs/platforms/multi-tenant-platforms/reference); [quickstart](https://vercel.com/docs/platforms/multi-tenant-platforms/quickstart)
- Offboarding means calling `projectsRemoveProjectDomain` and optionally `domainsDeleteDomain` — [Vercel docs: quickstart](https://vercel.com/docs/platforms/multi-tenant-platforms/quickstart)
- Vercel also documents a separate "multi-project platforms" model with one Vercel project per customer (`vercel.projects.addProjectDomain({ idOrName: project.id, ... })`) — [Vercel docs: Multi-project platforms quickstart](https://vercel.com/docs/platforms/multi-project-platforms/quickstart)
- Vercel's function regions default to `iad1`. Pro/Enterprise can deploy to multiple regions; Hobby can pick a single region — [Vercel docs: vercel.ts config](https://vercel.com/docs/project-configuration/vercel-ts)

### Inferences
- **Recommended pattern:** one shared Vercel project. Each club gets `club.platform.app` by default (one wildcard DNS record `*.platform.app`, which needs the apex on Vercel nameservers for wildcard SSL; background knowledge, unverified) plus an optional custom domain such as `book.threewolves.co.nz`, added through the API in an onboarding wizard. Use Global Config for host→tenant lookup at the edge, so routing does no DB round-trip, and keep the DB as the source of truth that syncs to Global Config.
- The app is on Next.js 15, so the file is `middleware.ts`. Vercel's current docs use the Next 16 `proxy.ts` naming, so plan the Next 16 upgrade alongside the multi-tenant work (low effort, a rename plus API changes).
- **Theming:** store per-tenant theme tokens in the tenant table (logo URL, primary/secondary colours, font choice). In the root layout, resolve the tenant from `headers()` and emit CSS custom properties (`--brand-primary`). Load fonts from a small allow-list, since `next/font` needs fonts at build time; arbitrary uploaded fonts need `@font-face` from Blob storage. Tailwind v4 reads CSS variables natively. (Design inference.)
- **Per-tenant PWA manifest/icons:** serve `app/manifest.ts` (or a route handler at `/manifest.webmanifest`) dynamically per tenant, with `name`, `short_name`, `theme_color`, and icons generated from the club logo (store pre-sized 192/512/maskable PNGs in Vercel Blob when the logo is uploaded). Because each club has its own origin (subdomain or custom domain), each installs as a separate PWA with its own push subscription scope. This is an advantage of subdomains over path-based tenancy (`platform.app/club-x`), where all clubs would share one origin and one installable app.
- Caching: any tenant-dependent page must vary by host. Use `unstable_cache`/`"use cache"` with tenant ID in the cache key, and tag-based revalidation (`revalidateTag('tenant:123')`) to avoid cross-tenant cache bleed. This is a real isolation risk with the Next.js Data Cache.
- Rough effort: tenant resolution plus theming plus dynamic manifest ≈ 1–2 developer-weeks; custom-domain onboarding UI with verification states ≈ 1 week.

### Gaps
- Could not confirm current Vercel limits on custom domains per project for Pro vs Enterprise, or whether high domain counts (1,000+) need Enterprise. Check vercel.com/docs/limits.
- Could not confirm current Vercel Pro seat pricing ($20/seat/month is background knowledge) or current usage rates (Fluid compute, edge requests, Global Config reads).
- Could not verify whether the "Platforms Starter Kit" GitHub template has been superseded by the new `/docs/platforms` guides (it appears so, since the docs now have dedicated multi-tenant and multi-project sections).

## 2. Database tenancy (shared schema + RLS vs schema-per-tenant vs DB-per-tenant on Neon) and migration

### Takeaway
For hundreds to thousands of small clubs, use a shared schema with a `club_id` (tenant_id) column on every tenant-owned table, enforced by Postgres Row Level Security as defence in depth behind app-level scoping. Neon also supports and markets project-per-tenant, which has real isolation and data-residency benefits. But it multiplies migrations, connection strings, and possibly cost, so reserve it for an enterprise tier, such as a national federation that demands isolation.

### Cited Findings
- Neon's multitenancy guide covers two models: shared schema with RLS, and **project-per-customer**. For the latter it covers a catalog DB that maps customers to projects, cross-project migrations with Drizzle and GitHub Actions, and scheduled backups. Neon recommends **one project per tenant rather than one branch per tenant** — [Neon docs: Multitenancy](https://neon.com/docs/guides/multitenancy) (via search snippet)
- Neon says that in a multi-tenant B2B app "you should at the very least use RLS to prevent any cross-tenant access" — [Neon blog: Is Postgres RLS for everything](https://neon.com/blog/is-postgres-rls-for-everything-and-everyone) (via search snippet)
- Neon's RLS tooling has moved into the Neon Data API — [Neon guide: RLS multi-tenant apps](https://neon.com/guides/rls-multi-tenant-apps) (via search snippet)
- Provisioning: the backend calls the Neon API to create a project at tenant signup and stores the connection string on the tenant record — [Neon use case: database per tenant](https://neon.com/use-cases/database-per-tenant) (via search snippet)
- Pricing (secondary sources, conflicting): Launch ≈ **$0.106/CU-hour** and Scale ≈ **$0.222/CU-hour** (1 CU ≈ 4 GB RAM). Older snapshots show $0.14 (Launch) and $0.26 (Scale). Free plan has **100 projects** at 100 CU-hours each; Launch has 100 projects; Scale has 1,000+ projects. Free-tier storage was reportedly raised to 1 GB/project in Oct 2026 — [Jetadmin: Neon pricing 2026](https://www.jetadmin.io/blog/neon-pricing/); [Activepieces: Neon pricing 2026](https://www.activepieces.com/blog/neon-pricing-2026-plans-free-tier-limits-and-costs); [Neon blog: why we no longer lock premium features](https://neon.com/blog/why-we-no-longer-lock-premium-features)
- Idle Neon projects scale to zero, so inactive tenants stop accruing compute. One vendor FAQ claims paid projects don't auto-pause and puts each tenant project at ~$10/month compute. **Conflicting claims; verify** — [Neon FAQ: tenant database provisioning](https://neon.com/faqs/postgres-services-saas-tenant-database-provisioning) (via search snippet)

### Inferences
- **Comparison for a club SaaS:**
  - *Shared schema + `club_id` + RLS*: cheapest (one DB, one migration path), cross-club features are easy (a player in several clubs, platform analytics, super-admin). Risk: a missing `WHERE club_id` leaks data, which RLS mitigates. Recommended default.
  - *Schema-per-tenant*: poor fit. Migrations fan out to N schemas, Postgres catalog bloat at 1,000+ schemas, ORMs (Drizzle/Prisma) handle it awkwardly, and isolation is no better than RLS against a compromised app role.
  - *Project-per-tenant on Neon*: strongest isolation, per-tenant region choice (data residency), per-tenant PITR/restore and easy "hand the club its database" export. But you need N migrations, a catalog DB, cross-tenant queries (multi-club players, platform reports) become ETL, and costs scale linearly if computes don't idle. Keep it as an Enterprise-tier option.
- **RLS implementation pattern** (design inference; standard Postgres): `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON bookings USING (club_id = current_setting('app.club_id')::uuid);`. Set `SET LOCAL app.club_id = ...` inside each transaction. With Neon's serverless driver over HTTP, each query is its own transaction, so use the WebSocket/Pool driver or wrap in `transaction()` so `SET LOCAL` applies. The app must connect as a non-owner role without `BYPASSRLS`, or the policies are skipped. Use `FORCE ROW LEVEL SECURITY` if the owner role must also be constrained.
- **Migration from single-tenant (rough plan, about 2–4 weeks):**
  1. Create `clubs` table; insert Three Wolves as club #1.
  2. Add nullable `club_id` to every tenant-owned table, backfill with club #1's ID, then set `NOT NULL` + FK + index (composite indexes leading with `club_id`).
  3. Change unique constraints to be per-club, e.g. `UNIQUE (club_id, slug)`.
  4. Split global entities (`users`/people) from tenant-scoped membership (`club_memberships`).
  5. Add RLS policies, switch the app's DB role, and run the isolation test suite (see §10).
  6. Use Neon branching to rehearse the migration on a copy of production first.
- Cost of shared DB (inference from the rates above): a single always-on 0.25 CU compute ≈ 0.25 × 730 h × $0.106 ≈ **$19/month** compute; 1 CU always-on ≈ **$77/month**, plus storage. This likely covers 100+ small clubs. DB-per-tenant at ~$10/tenant/month (if that FAQ is right) would be ~$10k/month at 1,000 clubs, versus probably <$500/month shared.

### Gaps
- Could not read the official Neon pricing page (storage $/GB-month, PITR window per plan, included compute) or confirm whether paid-plan projects scale to zero by default.
- Could not confirm Neon region list (e.g. AWS `ap-southeast-2` Sydney for NZ/AU latency and residency; background knowledge says it exists).

## 3. Payments: Stripe Connect for club-owned money, platform fees, subscriptions, liability, NZ/AU, GST, alternatives

### Takeaway
Stripe now steers new platforms away from Standard/Express/Custom "account types" toward **Accounts v2**. Behaviour is set by `defaults.responsibilities.fees_collector`, `losses_collector` and `dashboard` (`full` / `express` / `none`), and Accounts v1 has equivalent "controller properties". A club-software SaaS fits Stripe's "SaaS platform" model: **direct charges** on each club's connected account, with clubs as merchant of record, an **application fee** for platform revenue, and Stripe-owned pricing and loss liability (`fees_collector=stripe`, `losses_collector=stripe`, `dashboard=full` or `express`). That minimises platform risk and Connect fees.

### Cited Findings
- Stripe's own docs tell new integrations to use Accounts v2. The legacy account-types page is marked "Deprecated feature" and applies "only to platforms that already use legacy connected account types" — [Stripe docs: Connected account types](https://docs.stripe.com/connect/accounts)
- Accounts v2 responsibilities: `fees_collector` = `application` (platform collects fees and pays Stripe) or `stripe` (Stripe collects payment fees directly from the connected account). `losses_collector` = `application` (platform liable for negative balances) or `stripe` (Stripe liable). If `losses_collector=application`, then `fees_collector` must also be `application`. **These can't be changed after being set** — [Stripe docs: Configure connected accounts (v2)](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)
- Dashboard options: `express` (limited, platform-branded Express Dashboard), `full` (full Stripe Dashboard), `none` (platform builds everything, e.g. with Connect embedded components). The platform is responsible for KYC collection only when `losses_collector=application` and `dashboard=none` — [Stripe docs: Configure connected accounts (v2)](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)
- Legacy mapping: Standard = losses `stripe`, fees payer `account`, requirements `stripe`, dashboard `full`. Express = losses `application`, fees `application_express`, requirements `stripe`, dashboard `express`. Custom = losses `application`, fees `application_custom`, requirements `application`, dashboard `none`. "Dashboard type is immutable" — [Stripe docs: Migrate to controller properties](https://docs.stripe.com/connect/migrate-to-controller-properties)
- **New in API version 2026-06-24:** Express-dashboard accounts can now use Stripe-owned pricing (`fees_collector=stripe`) and Stripe loss liability (`losses_collector=stripe`), so "your platform has no financial liability if a connected account can't cover a refund or chargeback" — [Stripe changelog 2026-06-24: Express v2 Stripe-owned pricing and negative balance liability](https://docs.stripe.com/changelog/dahlia/2026-06-24/express-connected-accounts-v2-stripe-owned-pricing-negative-balance-liability); [v1 equivalent](https://docs.stripe.com/changelog/dahlia/2026-06-24/express-connected-accounts-v1-stripe-owned-pricing-negative-balance-liability)
- Application fee math: with `fees_collector=stripe`, set the application fee to your fee only, since Stripe deducts its own fee separately. With `application`, set the application fee to cover your fee plus Stripe's processing fee. Example: Stripe fee 1.00 + platform fee 1.50 means `application_fee` = 1.50 vs 2.50 — [Stripe docs: Configure connected accounts (v2)](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)
- SaaS platforms vs marketplaces: on SaaS platforms the **connected account is merchant of record**. Monetisation is per-payment application fees, subscriptions, or revenue share. **Platform Connect fees: "None, as long as Stripe sets payment pricing and directly charges fees to connected accounts."** Marketplaces pay processing fees, a monthly fee per connected account, and payout fees — [Stripe docs: SaaS platforms and marketplaces](https://docs.stripe.com/connect/saas-platforms-and-marketplaces)
- Direct charges: funds settle in the connected account's country, and refunds and chargebacks reduce the connected account's balance. Stripe recommends direct charges for SaaS (Shopify, Thinkific examples). **Direct charges aren't recommended for legacy v1 Express/Custom accounts**; use v2 accounts — [Stripe docs: Charge types](https://docs.stripe.com/connect/charges)
- Destination charges: refunds and chargebacks reduce the **platform's** balance. Cross-region destination charges are supported only in certain regions — [Stripe docs: Charge types](https://docs.stripe.com/connect/charges)
- Self-serve cross-border payouts work only among US, UK, EEA, Canada and Switzerland platforms and accounts. Other countries (including NZ/AU) need same-region setups, sales, or Global Payouts — [Stripe docs: Connect cross-border payouts](https://docs.stripe.com/connect/connect-cross-border-payouts)
- Platform SaaS billing for clubs: an Accounts v2 `Account` can hold both a `customer` configuration (club pays the platform's subscription) and a `merchant` configuration (club accepts card payments). Existing v1 connected accounts are not supported in this integration and would have to be recreated — [Stripe docs: Charge SaaS fees to connected accounts](https://docs.stripe.com/connect/integrate-billing-connect)
- Connect margin reports cover direct charges where the platform collects application fees, not direct charges where the connected account pays fees — [Stripe docs: Connect margin reports](https://docs.stripe.com/connect/margin-reports)

### Inferences
- **Recommended configuration:** Accounts v2, `merchant` config, `dashboard: "express"` (or `full` for clubs that already have Stripe), `fees_collector: "stripe"`, `losses_collector: "stripe"`, direct charges with `application_fee_amount`. Clubs then own disputes and refunds, Stripe owns negative-balance risk, and there are no per-account Connect fees. Add the `customer` configuration to bill clubs their monthly SaaS plan on the same Account object.
- **Member subscriptions** (e.g. monthly membership) are created *on the connected account* (`Stripe-Account` header) with `application_fee_percent` for platform revenue. Products and prices live per club. Stripe Billing fees then apply to the club account (background knowledge, unverified). The existing single-club Stripe integration's products and customers live on the platform account; migrating Three Wolves means creating a connected account and re-creating products and subscriptions there. Card customers can't simply be moved, so plan a re-subscribe flow or a Stripe-assisted data migration. (Inference; high-effort item, about 2–3 weeks.)
- **NZ/AU:** Stripe operates in both NZ and AU (background knowledge, unverified). Because self-serve cross-border payouts don't cover NZ/AU, the platform's Stripe account should be in the same region as clubs (e.g. an NZ platform for NZ clubs, possibly a separate AU platform entity), and direct charges settle in the club's country anyway.
- **GST:** with direct charges, the club is merchant of record and responsible for GST on member fees. The platform charges GST on its own SaaS fee and application fees to NZ clubs (NZ GST 15%, AU GST 10%; background knowledge). Stripe Tax can calculate NZ/AU GST (background knowledge, unverified). Many amateur clubs are below the GST registration threshold (NZ $60k turnover; background knowledge), so the platform must support "GST-registered: yes/no" per club with tax-inclusive pricing.
- **Clubs that can't or won't use Stripe:** support an "offline/manual" payment method (bank transfer with reference codes, cash marked paid by an admin). In NZ, consider account-to-account options such as POLi's successors or Akahu (background knowledge, unverified). The platform's revenue then has to come from the SaaS subscription rather than application fees.

### Gaps
- Could not retrieve Stripe NZ/AU card pricing, Connect pricing for platform-owned pricing (`fees_collector=application`), or Stripe Tax pricing.
- Could not confirm whether Accounts v2 is GA for NZ/AU platforms or still enabled per platform through "early access" (the docs say "You can enable Accounts v2 for your Connect platform from your Dashboard [early access settings]").
- Managed Risk availability in NZ/AU not confirmed.

## 4. CMS: Sanity datasets per tenant vs single dataset vs in-app admin

### Takeaway
A Sanity dataset per club is economically infeasible. The official pricing snippet shows the Growth plan with only **2 datasets**, and add-on datasets reportedly cost ~$999/month each. Per-seat pricing ($15/seat/month on Growth, with a 50-seat cap) also makes giving every club admin a Sanity login expensive. Move club-editable content (news, coach bios, session descriptions, pages) into an **in-app admin backed by Postgres**. Keep Sanity, if at all, for the platform's own marketing site and docs.

### Cited Findings
- A dataset is the boundary for queries: "you can always query and join data across documents within a dataset, but not across them." Datasets are meant for environments, localisation, or "different purpose content, but with same user access and billing" — [Sanity docs: Datasets](https://www.sanity.io/docs/content-lake/datasets)
- Private datasets are a Growth-plan feature. **When a project drops to Free (including an expired trial), every private dataset becomes public and stays public after re-upgrade until manually reset** — [Sanity docs: Datasets](https://www.sanity.io/docs/content-lake/datasets)
- Dataset exports are billed against the API quota and include all asset binaries — [Sanity docs: Datasets](https://www.sanity.io/docs/content-lake/datasets)
- Cloud Clone and dataset aliases/hot-swapping are Enterprise-only features — [Sanity docs: Datasets](https://www.sanity.io/docs/content-lake/datasets)
- Pricing (secondary; verify): Growth ≈ **$15 per seat/month**; viewers free. Official pricing snippet: Growth "up to 50 user seats, 5 permission roles, 2 datasets". Add-on datasets reportedly **$999/dataset/month**; one third-party source says 5 datasets on Growth (conflict) — [Sanity pricing](https://www.sanity.io/pricing); [Sanity pricing compare](https://www.sanity.io/pricing/compare); [DEV: Sanity pricing 2026](https://dev.to/nayankyada/sanity-cms-pricing-in-2026-free-plan-growth-and-when-you-need-enterprise-40e9); [Costbench: Sanity](https://www.costbench.com/software/cms/sanity-cms/)

### Inferences
- **Option A: single dataset, every document has a `club` reference.** Feasible technically. However, document-level permissions per club need custom roles with GROQ filters, which are generally Enterprise (background knowledge, unverified). Each club editor uses a paid seat, and Growth caps at 50 seats. At 100 clubs × 2 editors = 200 seats, you need Enterprise.
- **Option B: in-app admin (recommended).** Model `posts`, `pages`, `announcements` in Postgres with `club_id`. Use a rich-text editor (TipTap/Lexical, or Portable Text with a lightweight editor) and store images in Vercel Blob. Effort ≈ 2–3 weeks for basic news, pages and media. Benefits: one permission system (your RBAC), RLS isolation, data export in one place, no per-seat cost.
- **Option C: hybrid.** Keep Sanity for platform-level content (marketing site, help docs, shared templates such as "how to book") with 2–3 internal seats. Club content goes in-app.
- Cost at scale: Option A at 1,000 clubs is Enterprise-contract territory (unknown price). Options B and C cost about Sanity Growth for a few internal seats (≈ $45–$75/month) plus storage.

### Gaps
- Could not confirm current Sanity API/CDN request quotas, overage rates, or whether custom roles with document filters are available on Growth in 2026.

## 5. Email and SMS per tenant (Resend domains, sender identity, deliverability; Firebase phone auth costs; alternatives)

### Takeaway
Resend's Pro plan allows 10 sending domains and Scale allows 1,000 (Scale ≈ $90/month base), so per-club custom sending domains are feasible from about 10 clubs upward on Scale. The simpler default is to send every club's mail from a platform-owned domain with a club display name and Reply-To, and offer verified club domains as a premium feature. Firebase phone auth costs about **$0.07–0.08 per SMS in NZ**, with only ~10 free SMS/day on Identity Platform. Email magic links or passkeys should be the primary sign-in, with SMS as an optional extra.

### Cited Findings
- Resend plans (official page as summarised by search): Free has 1 domain and 100 emails/day; Pro has 10 domains and no daily limit; Scale has 1,000 domains and dedicated IPs. Base prices are $20/month (Pro) and $90/month (Scale), with volume tiers above that. One guide says extra domains cost $20/month per 100 on Pro/Scale. Some third-party guides claim 3 domains on Free (conflict) — [Resend pricing](https://www.resend.com/pricing.md); [Activepieces: Resend pricing 2026](https://www.activepieces.com/blog/resend-pricing-2026-free-tier-plans-and-limits); [Usecarly: Resend pricing](https://www.usecarly.com/blog/resend-pricing/)
- Firebase/Identity Platform SMS: NZ is listed at **$0.08 per SMS** in one Google pricing snapshot and **$0.07** in another. The first 10 SMS per day are free. Since Sept 2024, phone auth requires a Cloud Billing account, with no SMS allowance on the Spark plan — [Google Cloud: Identity Platform pricing](https://cloud.google.com/identity-platform/pricing); [Logto: Firebase Auth pricing 2026](https://blog.logto.io/firebase-authentication-pricing); [Rapidnative: Firebase auth pricing 2026](https://www.rapidnative.com/blogs/firebase-authentication-pricing)
- A single secondary source reports that Google launched an SMS-free "Phone Number Verification" product in May 2026 that verifies numbers via carrier/SIM data (pricing and coverage unconfirmed) — [Logto: Firebase Auth pricing 2026](https://blog.logto.io/firebase-authentication-pricing)

### Inferences
- **Sender identity tiers:** (1) default `"Three Wolves Badminton" <noreply@mail.platform.app>` with `Reply-To: secretary@club.org`, which needs no DNS work from clubs and keeps deliverability under platform control. (2) Premium: club verifies `mail.club.org` in Resend (SPF/DKIM/DMARC records the onboarding wizard shows; created via the Resend Domains API). Above 10 club domains you need Scale.
- Deliverability: one shared sending reputation means one abusive club can hurt everyone. Rate-limit bulk "announcement" sends per club, require double opt-in for marketing-style mail, separate transactional and broadcast streams (different subdomains), and handle bounce/complaint webhooks per tenant.
- **SMS cost exposure:** at $0.08 per OTP, 1,000 clubs × 100 members × 2 logins/month ≈ 200k SMS ≈ $16k/month. That is unsustainable without passing costs on. Also, SMS-pumping fraud (toll fraud) is a known risk on open phone-auth endpoints (background knowledge). Recommendation: make **email magic link + passkeys** the default, keep phone OTP for clubs that want it (cost passed through on higher plans), and enable Firebase/Identity Platform SMS region allow-lists for NZ/AU only.
- Alternatives (background knowledge, unverified pricing): Twilio Verify (per-verification fee plus SMS), Auth.js/Better Auth/Clerk/WorkOS with email OTP and passkeys. Moving off Firebase Auth also simplifies multi-tenant user modelling (see §6).

### Gaps
- Could not get AU SMS pricing for Identity Platform, Twilio Verify current NZ/AU pricing, or confirm whether Resend has a dedicated multi-tenant / "sub-account" feature for per-tenant reputation isolation.

## 6. Auth and roles (club admin, coach, member, guest; multi-club players; super-admin; audit logs)

### Takeaway
Model a **global person identity** (one login) separately from **club memberships** that carry per-club roles. Treat platform super-admin as a separate flag with impersonation that is audited. Write an append-only audit log keyed by `club_id`. Firebase Auth can stay as the identity provider, but tenant authorisation must live in your Postgres. Firebase's own multi-tenancy (Identity Platform tenants) isolates users per tenant, which works against "one player, many clubs".

### Cited Findings
- No primary-source documentation was retrieved this session specifically on auth-role modelling (tool budget exhausted on higher-priority items). See Inferences and Gaps.

### Inferences
- **Schema sketch:** `users(id, email, phone, firebase_uid)`; `clubs(id, ...)`; `club_memberships(user_id, club_id, role ENUM('owner','admin','coach','member','guest'), status, joined_at)` with `UNIQUE(user_id, club_id)`; `platform_admins(user_id)`; `audit_log(id, club_id NULL, actor_user_id, impersonator_user_id NULL, action, entity_type, entity_id, before JSONB, after JSONB, ip, created_at)`.
- Session: after sign-in, resolve `club_id` from the host (§1) and load the membership for (user, club). Deny if absent, or treat as guest for public pages. Never trust a client-sent club ID. A user visiting a different club's domain is a separate session (cookies are per-origin), which is fine and expected for white-label. Offer a "my clubs" switcher on the platform domain.
- Guests: allow booking with email-only verification (magic link) creating a `guest` membership. Juniors and family accounts likely need `guardian_of` relationships (feature inference).
- Super-admin impersonation should show a banner, require a reason, be time-boxed, and write `impersonator_user_id` to every audit row.
- Audit log: append-only (revoke UPDATE/DELETE on the table from the app role), partitioned by month if large, exposed to club admins filtered by their `club_id`.
- Effort ≈ 2–3 weeks including UI for role management and invites.

### Gaps
- Not verified: Firebase Identity Platform multi-tenancy feature details and pricing (MAU tiers), and current Better Auth/Clerk organisation features and pricing.

## 7. Scheduling engine (from Google Calendar to an internal model)

### Takeaway
Replace Google-Calendar-defined sessions with an internal model: venues → courts/resources → session templates with RFC 5545 RRULEs → materialised occurrences, with booking rules, stored as UTC with an IANA time zone per venue. Keep Google Calendar only as an **outbound** sync or ICS feed per club or member.

### Cited Findings
- No primary sources retrieved this session for this question (budget constraint). Recommendations below are design inferences based on standard practice and must be validated.

### Inferences
- **Core tables:** `venues(club_id, name, address, timezone)`, `resources(venue_id, type: court|hall, name, capacity)`, `session_series(club_id, venue_id, title, rrule TEXT, dtstart_local, duration, timezone, default_capacity, price, booking_rule_id)`, `session_occurrences(series_id, starts_at timestamptz, ends_at, status, capacity_override, resource_ids[])`, `bookings(occurrence_id, user_id, status, payment_intent_id, waitlist_position)`, `booking_rules(club_id, opens_hours_before, closes_minutes_before, cancel_cutoff, max_per_member_per_week, member_only, guest_fee)`, `exceptions` (EXDATE/cancellations/one-off changes).
- Materialise occurrences on a rolling window (e.g. 12 weeks) with a cron job, using an RRULE library (`rrule.js` or `rrule-temporal`). Expand RRULEs in the **venue's local zone** so a 7pm session stays at 7pm across NZ DST shifts, then store `timestamptz`.
- Prevent double-booking of courts with a Postgres exclusion constraint: `EXCLUDE USING gist (resource_id WITH =, tstzrange(starts_at, ends_at) WITH &&)` (requires `btree_gist`). Enforce capacity with `SELECT ... FOR UPDATE` on the occurrence row or a serializable transaction.
- Google Calendar: replace inbound sync with (a) a per-club/per-member ICS feed URL and (b) optional one-way push to a club's Google Calendar. This removes per-tenant Google OAuth complexity on the inbound side.
- Migration: import existing Google Calendar events for Three Wolves once, converting recurring events to `session_series`.
- Effort ≈ 3–6 weeks: data model plus admin UI plus booking concurrency plus waitlists.

### Gaps
- No sourced comparison of off-the-shelf scheduling engines/APIs (e.g. Cal.com Platform, Nylas) for embedding was retrieved.

## 8. Native app options (PWA vs Capacitor/Expo, white-label build pipelines, push)

### Takeaway
Start PWA-first: each club's domain installs as its own branded PWA with Web Push. Push works on iOS 16.4+ **only when added to the Home Screen**, and Declarative Web Push arrived in iOS 18.4. Native white-label apps (one codebase → many App Store listings) are constrained by Apple **Guideline 4.2.6**: apps from a commercialised template must be submitted by the content provider, so each club needs its own Apple developer account. Guideline 4.3 spam rejections are also a risk. A single platform-branded "container" app where users pick their club is the lower-risk native route.

### Cited Findings
- iOS web push works only for sites added to the Home Screen (iOS/iPadOS 16.4+), not for Safari tabs — [MagicBell: PWA iOS limitations](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide); [WebKit: Meet Declarative Web Push](https://webkit.org/?p=16535)
- Declarative Web Push (push without a service worker) is supported in installed web apps on iOS 18.4+ and in Safari 18.5+ on macOS — [WebKit: Meet Declarative Web Push](https://webkit.org/?p=16535); [Progressier: Declarative Web Push](https://progressier.com/pwa-capabilities/declarative-web-push)
- iOS 26 made Home Screen-added sites open as web apps by default (per one timeline). Apple removed Home Screen web apps for EU users in iOS 17.4 under the DMA, and current 2026 status in the EU is not confirmed by any source found — [Slightfuture: PWAs 2026](https://slightfuture.com/webdev/progressive-web-apps-2026/); [MacRumors forum: iOS 17.4 EU](https://forums.macrumors.com/threads/apple-confirms-ios-17-4-disables-home-screen-web-apps-in-the-european-union.2419554/page-12); [Webscraft: PWA push on iOS 2026](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en)
- Apple Guideline 4.2.6: "Apps created from a commercialized template or app generation service will be rejected unless they are submitted directly by the provider of the app's content." A single container app listing many businesses is described by commentators as an alternative — [AppInstitute: 4.2.6 explained](https://appinstitute.com/apple-app-store-guidelines/); [Apple App Review](https://developer.apple.com/distribute/app-review)
- June 2026 guideline update tightened 4.3 (spam/saturated categories), and commentators suggest container apps or clear differentiation are safer for white-label — [MacRumors, 9 Jun 2026](https://macrumors.com/2026/06/09/app-store-guidelines-low-quality-apps/); [Apple Developer Forums: per-studio branded builds of a B2B SaaS app](https://developer.apple.com/forums/thread/840982)

### Inferences
- **Phased approach:**
  1. PWA per club (dynamic manifest, §1) plus Web Push via VAPID. Store `push_subscriptions(user_id, club_id, endpoint, keys)`. Prompt for push only after install on iOS.
  2. If store presence matters, ship **one platform-branded Capacitor app** (wrapping the existing Next.js UI) with a club picker, native push via APNs/FCM, and deep links per club. This avoids 4.2.6/4.3 issues and is one build and one review.
  3. Per-club branded apps only for paying enterprise clubs, published under the **club's own** Apple/Google developer accounts (4.2.6), built by a CI pipeline that swaps bundle ID, name, icons and splash per club. Expo EAS (`app.config.ts` per tenant) or Capacitor with Fastlane (background knowledge) both support this. Expect review risk and ~$99/year Apple developer fee per club (background knowledge).
- Capacitor fits better than Expo/React Native because the app is already a Next.js web UI (reuse vs rewrite). Expo is better only if a fully native UI is wanted.
- Effort: PWA push ≈ 1 week. Capacitor container app ≈ 3–5 weeks including store submission. Per-tenant build pipeline ≈ 2–3 weeks plus per-club operational overhead.

### Gaps
- Could not retrieve Apple's current guidelines page directly to confirm exact 2026 wording of 4.2.6/4.3, or the current EU status of Home Screen web apps.
- Google Play policy for white-label/template apps not researched.

## 9. Operations (observability, backups, data export, onboarding, feature flags, cost per tenant at 10/100/1,000 clubs)

### Takeaway
Tag every log, trace and error with `club_id`. Rely on Neon PITR plus scheduled logical dumps for backups. Give clubs a self-serve export (CSV/JSON zip of their members, bookings, payments, content). Automate onboarding as a single wizard: create club → subdomain → Stripe Connect onboarding link → optional custom domain → theme → invite admins. Gate features by plan with a `plan` + `entitlements` table, optionally Vercel Flags for rollout. With a shared architecture, platform infrastructure cost is mostly fixed and small. Per-club variable costs come from SMS, email volume and any per-seat CMS.

### Cited Findings
- Neon's multitenancy guide covers scheduled backups for project-per-tenant setups — [Neon docs: Multitenancy](https://neon.com/docs/guides/multitenancy) (via search snippet)
- Sanity dataset exports are billed against API quota — [Sanity docs: Datasets](https://www.sanity.io/docs/content-lake/datasets)
- Neon compute ≈ $0.106/CU-h (Launch) and $0.222/CU-h (Scale), secondary sources — [Jetadmin: Neon pricing](https://www.jetadmin.io/blog/neon-pricing/)
- Resend Pro $20/month (10 domains), Scale $90/month (1,000 domains) base — [Resend pricing](https://www.resend.com/pricing.md)
- Sanity Growth ≈ $15/seat/month — [DEV: Sanity pricing 2026](https://dev.to/nayankyada/sanity-cms-pricing-in-2026-free-plan-growth-and-when-you-need-enterprise-40e9)
- Stripe: no platform Connect fees when Stripe sets pricing on connected accounts — [Stripe docs: SaaS platforms and marketplaces](https://docs.stripe.com/connect/saas-platforms-and-marketplaces)
- Identity Platform SMS NZ ≈ $0.07–0.08/SMS — [Google Cloud: Identity Platform pricing](https://cloud.google.com/identity-platform/pricing)

### Inferences
- **Rough monthly platform cost (USD), shared architecture.** These are inferences; Vercel figures are background knowledge and unverified. Assumes ~100 active members per club, Sanity used only for platform content, email magic links rather than SMS.

| Component | 10 clubs | 100 clubs | 1,000 clubs |
|---|---|---|---|
| Vercel Pro (2–3 seats, $20/seat, plus usage) | ~$60–100 | ~$100–300 | ~$500–2,000 (may need Enterprise for domain counts/SLAs) |
| Neon shared DB (0.25–2 CU, mostly active) | ~$20–40 | ~$80–150 | ~$300–800 (Scale plan, bigger compute, read replica) |
| Resend (club-domain sending) | $20 (Pro, ≤10 domains) | $90+ (Scale) | $90 + volume tiers (likely $300–600 at ~1M emails/mo) |
| Sanity (platform content only, 3 seats) | ~$45 | ~$45 | ~$45 |
| SMS OTP if used (100 members × 2 logins/mo × $0.08) | ~$160 | ~$1,600 | ~$16,000 |
| Stripe Connect platform fees (Stripe-owned pricing) | $0 | $0 | $0 |
| **Total excl. SMS** | **~$150–200** | **~$300–600** | **~$1.2k–3.5k** |

  - Per-club infra cost falls from ~$15–20 (10 clubs) to ~$1–4 (1,000 clubs) without SMS. **SMS dominates if phone OTP is the default.**
  - DB-per-tenant on Neon would add roughly $0–10/club/month depending on scale-to-zero behaviour.
  - Sanity dataset-per-tenant at $999 per extra dataset is prohibitive at any scale.
- **Observability:** add `club_id` to structured logs (pino) and Sentry tags, and use Vercel log drains to a store that can filter by tenant. Build per-tenant dashboards for booking volume, payment failures, and email bounces. Alert on any query returning cross-tenant rows in tests (§10).
- **Data export / ownership:** a one-click "export my club" job that writes a zip of CSV/JSON to Blob with a signed URL. Include Stripe data references (the club owns its Stripe account directly with direct charges, which is a strong data-ownership story).
- **Feature flags / plan gating:** a `plans` table plus `club_entitlements` (JSON) checked server-side, with Vercel Flags/Edge Config for gradual rollout (Vercel MCP lists Flags and Global Config as products).
- **Onboarding effort** ≈ 2 weeks for the wizard plus Stripe account link plus domain flow.

### Gaps
- Could not retrieve current Vercel Pro pricing, usage rates, or Enterprise thresholds, or Neon storage pricing and PITR windows. The cost table above is indicative only.

## 10. Security and compliance (tenant isolation testing, PCI scope, NZ Privacy Act 2020, GDPR, data residency)

### Takeaway
The biggest risk in shared-schema multi-tenancy is cross-tenant leakage through missing filters or shared caches. Mitigate with RLS, a non-bypass DB role, tenant-keyed caching, spoof-proof tenant headers, and automated isolation tests in CI. Using Stripe Checkout/Elements with direct charges keeps the platform in the lightest PCI scope (SAQ A), and clubs are merchant of record. For NZ Privacy Act 2020 and GDPR, the platform is the clubs' processor/agent. Data residency in AU (Sydney) regions for Neon and Vercel functions is achievable. Sanity, Resend and Firebase residency need checking.

### Cited Findings
- Vercel's reference proxy strips inbound `x-tenant-id`/`x-tenant-type` headers so "only the proxy sets them" — [Vercel docs: proxy and routing](https://vercel.com/docs/platforms/multi-tenant-platforms/proxy-and-routing)
- Neon recommends RLS at minimum to prevent cross-tenant access in B2B multi-tenant apps — [Neon blog: RLS](https://neon.com/blog/is-postgres-rls-for-everything-and-everyone)
- Sanity private datasets silently become public on downgrade to Free and stay public after re-upgrade, which Sanity says should be treated as an exposure — [Sanity docs: Datasets](https://www.sanity.io/docs/content-lake/datasets)
- On a Stripe SaaS-platform setup the connected account is merchant of record and responsible for the transaction (including taxes) — [Stripe docs: SaaS platforms and marketplaces](https://docs.stripe.com/connect/saas-platforms-and-marketplaces)
- With `losses_collector=stripe`, the platform has no liability for connected accounts' refunds or chargebacks they can't cover — [Stripe changelog 2026-06-24](https://docs.stripe.com/changelog/dahlia/2026-06-24/express-connected-accounts-v2-stripe-owned-pricing-negative-balance-liability)

### Inferences
- **Isolation test suite (CI):** seed two clubs (A, B) with the same-shaped data. For every API route and server action, call as a club-A admin with club-B entity IDs and assert 403/404. Run raw SQL as the app role with `app.club_id` = A and assert zero rows from B for every RLS table. Add a schema lint that fails CI if a table with `club_id` lacks an RLS policy (`SELECT relname FROM pg_class WHERE relrowsecurity = false ...`). Add cache tests confirming host A never serves host B's cached page. Fuzz the `Host` header.
- **PCI:** Stripe Checkout or Payment Element (card data in Stripe iframes) generally means SAQ A for the merchant (background knowledge, unverified). The platform should never touch PANs. Connect embedded components keep payouts and disputes UI on Stripe.
- **NZ Privacy Act 2020** (background knowledge, unverified): 13 Information Privacy Principles. IPP 12 restricts disclosure overseas unless comparable safeguards exist. Mandatory notification of serious privacy breaches to the Privacy Commissioner and affected people. A Biometric Processing Privacy Code applied from 2025, which is relevant only if adding face check-in. Clubs are the agencies collecting member data, so the platform should offer a Data Processing Agreement, a sub-processor list (Vercel, Neon, Stripe, Resend, Firebase/Google, Sanity), and breach-notification commitments.
- **GDPR** applies only if offering services to people in the EU/UK. Same DPA and sub-processor approach; SCCs for transfers.
- **Residency:** choose Neon AWS `ap-southeast-2` (Sydney) and Vercel function region `syd1` for NZ/AU data locality (background knowledge, unverified region names). Vercel's static and CDN caches are global. Sanity, Resend and Firebase are largely US-hosted (unverified), so disclose them as overseas processors under IPP 12.
- Junior members (minors) need guardian consent flows and minimal data collection (inference).

### Gaps
- Could not retrieve primary sources for NZ Privacy Act 2020 (privacy.org.nz), PCI SAQ applicability under Stripe Checkout/Elements, or data-hosting regions for Sanity, Resend and Firebase Auth in 2026.
- No source found on formal tenant-isolation testing frameworks or tooling specific to Next.js + Postgres RLS.
