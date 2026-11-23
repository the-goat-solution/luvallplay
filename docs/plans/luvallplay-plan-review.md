# Luvallplay plan review: is the plan sound, and what's missing?

Status: **review for decision** (23 Nov 2026). Written against the vision:

> Build Luvallplay as a white-label product owned by **The GOAT Solution (TGS)**. License it **free to Three Wolves**. Three Wolves (Kelcee) connects other badminton clubs to use it **free in exchange for feedback**. TGS then **commercialises** it to other sports and markets.

Where I found a fact in the repo or the accounts, I say so. Where I'm relying on general knowledge or search results (especially legal points), I mark it **Check** and it needs a NZ lawyer or accountant, not just me.

---

## Verdict

**The engineering plan is strong. The business, legal and go-to-market foundations underneath it are not set yet, and a few of your decisions pull against your own vision.**

- The engineering side (safe previews, the data guard, expand/contract migrations, tenant isolation tests, payment modes that avoid Stripe's "aggregation" rule, modular admin) is better than most early platforms.
- But the plan builds for ~6 months before **anyone outside Three Wolves can give feedback**, and feedback is the thing you're trading free usage for.
- Nothing yet defines **who owns the product**, **who contracts with other clubs**, **what "free" means**, or **when and how TGS starts charging**. Those are cheap to fix now and very expensive to fix after 10 clubs are on the platform.
- "White-label" currently means "clubs get their own colours inside one Luvallplay app". That's a shared-brand platform, not a white-label product. The two are different businesses with different costs (see B2).

---

## What's right (keep it)

- Data safety: data guard, rehearsals on production copies, restore points, two-person sign-off.
- Previews isolated from production; side effects off outside production.
- Payment modes (free play, cash/bank transfer, online): Luvallplay never holds club money, which keeps TGS out of Stripe's aggregation rules and NZ money-transfer regulation.
- Free play as a first-class mode; small core admin with switchable modules.
- Semantic theming, 12 tested colour schemes, bring-your-own brand.
- Sport packs and sport-neutral wording (§6.7).
- Bilingual by default, accessibility and performance budgets.

---

## A. Ownership, legal and money (fix before the first outside club)

**A1. Where is TGS registered, and does that work for the platform accounts?** *(answered: Vietnam. See "What the answers changed" below.)*
- Stripe Connect, the Apple and Google organisation developer accounts, D-U-N-S, GST and tax treatment all depend on the **country and type** of the legal entity.
- The GitHub organisation is `The-GOAT-Solution-VN`, which suggests a Vietnamese link. **Check:** support for Vietnamese entities as Stripe platforms is unclear (third-party sources conflict, and Stripe's own list wasn't reachable). If TGS isn't in a Stripe-supported country, the payments design needs a different holder (e.g. an NZ or US entity).

**A2. The chain of ownership of the code and assets isn't written down.**
- The app was built inside Three Wolves' repo and for Three Wolves. There's **no LICENSE file** and no ownership statement. Contributions from Three Wolves volunteers, any contractors, and AI-assisted code have no assignment paperwork.
- **Check:** how copyright applies to AI-assisted code differs by country. The usual protection is human direction and review, plus written assignment to TGS.
- Assets that must **stay Three Wolves'** (wolf rank art, name, logo, "Wolf" terms) need to be separated from what TGS owns. The plan already themes them as Three Wolves' own brand; the legal paperwork should say so too.
- **Third-party licences need an audit before TGS sells or licenses anything:**
  - The UTM Copperplate fonts are shipped in the repo with no licence record. These fonts are often free for limited use only. **Check** before any white-label use.
  - npm dependencies and the MediaPipe runtime (licences are usually permissive but should be listed).
  - Photos used on the site.
  - The Vision shuttle model, which was trained on footage of real players.

**A3. Related-party and conflict-of-interest handling.**
- Timba is CEO of TGS and Treasurer of Three Wolves. Kelcee's formal relationship to TGS isn't stated.
- A free licence from a related for-profit to a not-for-profit is fine in principle, but it should be **in writing, minuted by the Three Wolves committee, with the conflict declared** and someone other than Timba signing for Three Wolves. It also covers "Three Wolves resources (members' time, brand, reputation) used to help TGS commercialise" (Kelcee recruiting clubs).
- **Check:** NZ rules on conflicts of interest for incorporated societies and, if Three Wolves is a registered charity, charity rules on private benefit.

**A4. The contracting party for every other club must be TGS, never Three Wolves.**
- If Kelcee recruits clubs "from Three Wolves", clubs may assume Three Wolves is responsible for their data, uptime and payments. Make the partner agreement, terms and privacy policy name TGS, and make Kelcee's role (agent, ambassador, contractor, shareholder?) explicit.

**A5. The legal pack is missing from the plan.**
- Terms of service (club), terms for players, privacy policy, **data-processing terms** (each club is the controller of its members' data and TGS the processor, but for global features such as Find a club, social and global leaderboards TGS is a controller in its own right), acceptable-use policy, marketplace terms, safeguarding policy, and the **partner agreement for the free-for-feedback period** (feedback and IP licence, confidentiality, publicity/testimonial rights, no SLA, 90 days' notice before charging).
- NZ obligations the plan doesn't yet cover. **Check each:**
  - **Harmful Digital Communications Act 2015** "safe harbour": a host that wants protection for user content needs an easy complaints process with **48-hour deadlines** (sections 23 to 25). The plan has report and block but not this process.
  - **Unsolicited Electronic Messages Act 2007**: emails and texts that are commercial need consent, sender identification and a working unsubscribe. Club announcements are mostly not commercial, but shop, marketplace and promotional messages can be.
  - **Privacy Act 2020**, including the new rule on collecting information indirectly (IPP3A, from 1 May 2026), and breach notification.
  - **Fair Trading Act / Consumer Guarantees Act** for marketplace sellers (and what a platform operator can and can't disclaim).
- **Insurance:** cyber liability and professional indemnity for TGS. Not in the plan.

**A6. Brand protection.**
- No trademark search has been done for "Luvallplay" (NZ, Australia, and wherever else you plan to sell). A clash found after 12 months of branding is very costly. The App Store and Google Play names also have to be free.
- Domains: the plan says buy luvallplay.org first. For a commercial product, **luvallplay.com** is the one to hold and use as primary (.org reads as non-profit). They were unregistered on 18 Nov, so register them now.
- Secure social handles and a defensive set of domains.

**A7. Money flowing between TGS and Three Wolves is undefined.**
- **Wolf Vision passes through the stores:** in-app purchase revenue goes to whoever holds the developer account (TGS), but Vision has been Three Wolves' product and Three Wolves currently takes the Stripe payments. Who gets what, and who pays tax on it?
- Donations to Three Wolves, the Three Wolves shop, and any fees. Keep a simple rule: club money stays with the club, platform features are priced by TGS, and everything is invoiced between the two entities.

---

## B. Commercial and go-to-market

**B1. "Free for feedback" has no structure, so it won't produce feedback.**
- Needed: a **design-partner programme** with a cap (5 to 10 clubs), a start and end condition, what each side gives and gets (regular calls, in-app feedback, a case study, consented usage data), and what happens when pricing starts (grandfathering, notice).
- Needed in the product: in-app feedback, a short survey, a changelog and public roadmap, privacy-friendly usage analytics **with consent**. None of this is in the plan.

**B2. Time to first outside feedback is about 16 to 20 weeks.** *(the biggest strategic risk)*
- In the plan's order, the first outside club can only join after Phase 3 (week ~11) **and** the setup wizard (Phase 6, week ~16 to 20). You'd spend 4 to 5 months of build before validating that other clubs want this, or which modules they use.
- Better: recruit partner clubs **now** (interviews and a waitlist on the intro site), and onboard the first 3 to 5 **by hand right after Phase 3** using an admin script instead of the wizard. Store apps and global modules can follow.

**B3. There's no unit-economics model, and "free" has real costs that grow per club:**
- SMS sign-in codes run through Google's free allowance (Firebase phone auth, capped at about 10 texts a day). A dozen active clubs will blow through it.
- Email, photo storage and image moderation, push, map tiles, RevenueCat fees, Neon and Vercel growth, domains and certificates, support time.
- Build a simple cost-per-club and cost-per-active-player model, and **meter usage per club from day one** (needed later for billing even while everything is free).

**B4. No pricing hypotheses and no "gate" for when to charge.**
- Define the gate in advance (for example: 5 partner clubs active for 3 months, a target retention rate, a target "would pay" answer), and test a price in the partner programme. The earlier research found NZ competitors around NZ$58 a month entry level (**unverified**, vendor sites were blocked) and an NZ market of roughly NZ$1 to 1.5 million a year even at full share (researcher's estimate), so growth beyond NZ needs Australia or other markets early.

**B5. Who is the buyer?** Often the **association or federation** (Badminton NZ, regional bodies, school sports, councils), not the individual club.
- The plan has flat clubs. Associations need **organisations over clubs** (a parent account with shared reporting, affiliation, shared member registry, event and tournament management, branded club pages).
- For other sports: **teams, fixtures, leagues, seasons and results**. The plan's "sport packs" change wording and scoring but not the structure; the data model is individuals on courts.

**B6. The 16+ rule limits the biggest segments.** Junior participation is the core of most club sport (school, youth leagues, parent-run teams). Keeping no under-16s is simple and safe now, but it rules out most of the market for team sports. You can keep it **and** design the data model for **guardian-managed junior profiles** now (cheap), and build the feature once you choose the next market.

**B7. What "white-label" means decides the architecture and cost.**
- (a) Clubs themed inside one Luvallplay app (current plan, cheapest, a shared brand).
- (b) Bigger customers get **their own branded app and domain**. This needs a per-customer build pipeline and, to pass Apple's template-app rule (4.2.6), **the customer's own developer account**. It's real work per customer.
- (c) Other companies **resell** it under their brand, which needs partner billing and a partner portal.
- Decision A (one Luvallplay store app) fits (a) only.

**B8. Network-effect features (social, marketplace) are the most expensive to build and run, and the least useful until there are many clubs and players.** They also bring the heaviest moderation and legal load. The plan builds them in Phase 7. Gate them by real thresholds, and build **Find a club** and sport-specific rankings first.

**B9. The adoption loop for players is thin.**
- Clubs move from WhatsApp, Facebook and spreadsheets. Needed: member import, "claim your account" invites, QR posters, share links, and a first-session experience that works with no admin help.
- Define success measures now: active clubs, weekly active players per club, sessions run through the app, retention at 30 and 90 days, "very disappointed if gone" score. Without these the feedback loop is guesswork.

---

## C. Platform maturity (what a real platform has that the plan doesn't)

**C1. Support and operations.** Help centre, a support inbox with a named owner, response targets, a status page, an incident process, and an on-call arrangement. With free partner clubs, set expectations in writing (no SLA, best-effort).

**C2. Club offboarding, export and per-club restore.**
- In a shared database, restoring **one club** after a mistake is hard (a point-in-time restore affects every club). Plan tenant-scoped export and restore tooling.
- Clubs leaving or closing: data export, deletion, retention, what happens to their players' global accounts and ratings.
- Both directions of exit for Three Wolves: if TGS stopped, Three Wolves needs its data and a way to keep running; if the relationship ended, TGS keeps its IP.

**C3. Release management by tenant.** "Rings": release to an internal test club, then partner clubs, then everyone. Per-club feature flags, a changelog, and an API and webhook deprecation policy. Three Wolves is currently both the live production club and the test bed.

**C4. Platform console and support tooling.** Support "view as admin" only with consent and an audit trail, a club health dashboard (usage, errors), per-club rate limits, and the ability to suspend a club for abuse.

**C5. Email at scale.** Each club will want mail from its own domain (DKIM/SPF per club). One club's spam shouldn't damage everyone's deliverability: separate sending identities, bounce and complaint handling.

**C6. Club verification and anti-impersonation.** The self-serve wizard lets anyone create "Badminton NZ". Needed: reserved names, verification criteria for the "verified" badge (NZ incorporated society number, a document check, or federation approval), and a takedown route.

**C7. Trust and safety operations.** Who reviews reports and when, escalation, contact points (police, Netsafe), and the 48-hour process above. **Vision:** I found no consent or retention wording for the footage used to train the shuttle model in the code I searched. Players who are filmed and used for training need clear consent, retention limits and an opt-out. This matters more once other clubs are involved.

**C8. Key people and account ownership.** *(a fact, not a guess)*
- The only Vercel team is **"Timba Le's projects"**, a personal account, and the Neon project is named for Three Wolves. A product that TGS owns and licenses must live in **TGS-owned accounts**: Vercel, Neon, Stripe, Resend, Sanity, Firebase, Akahu, domains, DNS, app store accounts, with **two or more owners**, hardware-key two-factor, a company password vault, and a written break-glass runbook. Today the bus factor is one.
- The plan's two-person sign-off assumes Kelcee can review technical reports. Write the runbooks so a non-engineer can confirm the checks.

**C9. Security posture for selling to associations.** They will send security questionnaires. Prepare: a short security page, a vulnerability disclosure policy, an external penetration test before multi-club launch (already in the test plan), a dependency and licence inventory (SBOM), and, later, a SOC 2-style programme if you sell to larger bodies.

**C10. Other markets.** Per-country packs for tax (GST or VAT), currency, payment providers, bank feeds (Akahu is NZ only), privacy law (Australia, Vietnam, GDPR if EU) and, for some markets, data residency. You don't need to build these now, but the tenant model should carry a country and the privacy and payment settings should hang off it.

---

## D. Weak assumptions and inconsistencies inside the plan

1. **Decision A (one Luvallplay app) vs "white-label product":** see B7.
2. **Decision E (free for every club) vs "TGS commercialises":** needs a stated gate and agreement terms (B1, B4).
3. **Timeline realism.** Phase 4 allows 3 to 4 weeks to rebuild a large profile app as a client-side app with an API, token sign-in and offline support, which looks low. Phase 2 already surfaced surprises (production runs Postgres 18, differences between the schema in code and in production). Treat the week numbers as a best case and **re-baseline after Phase 2 and Phase 3 with actuals**.
4. **The marketplace "no responsibility" stance** (like Facebook Marketplace) helps, but a disclaimer doesn't remove duties under consumer law or the app stores' rules. **Check** with a lawyer before building player-to-player.
5. **Vision is badminton-only and Wolf-branded**, with open questions on revenue (A7) and training data (C7). Decide whether it's a platform product, a Three Wolves product, or a licensed add-on.
6. **The plan is one very large document.** Split it into three: product and business, engineering, and legal and operations, so each has an owner.

---

## E. Suggested order of work (next 30 days, beside Phase 2)

1. **Entity and legal groundwork** (A1, A3, A4, A5): confirm where TGS is registered; lawyer drafts the licence to Three Wolves, club terms, privacy policy and data-processing terms, and the partner agreement; Three Wolves committee minutes the conflict declaration.
2. **Move production accounts into TGS-owned accounts** (C8).
3. **Trademark search and buy domains** (A6).
4. **Define the design-partner programme and recruit 3 to 5 clubs** (B1, B2); put a waitlist on the intro site.
5. **Cost model and usage metering** (B3), **success measures and the "charging gate"** (B4, B9).
6. **Decide the white-label meaning, next market and juniors stance** (B5 to B8).
7. **IP and licence audit** (A2): fonts, dependencies, assets, Vision model.
8. **Re-baseline the schedule** after Phase 2 and Phase 3.

---

## Decisions (23 Nov)

| Question | Answer | What it changed |
|---|---|---|
| Where is TGS registered? | **Vietnam** | A Vietnamese entity probably can't hold the Stripe platform account for NZ clubs (Stripe needs platform and connected accounts in supported countries), and the Vietnam personal data law is now relevant. |
| Which entity runs Luvallplay for NZ clubs? | **A NZ company owned by TGS** | The NZ company contracts with NZ and Australian clubs and holds the Stripe platform account; TGS owns the IP and runs Vietnam (build plan §11.1). |
| What does white-label mean? | **Shared app, club branding** | Decision A stands; own-branded apps and reselling aren't planned. |
| How to get feedback sooner? | **Keep the current order** | Outside clubs join after the wizard. Recruiting and interviews, which need no engineering, still start now. |
| How to charge after the free period? | **NZ badminton free for good; paid elsewhere** | Paid plans must be real before the first paid club; the free tier needs fair-use limits and a cost model (§11.2). |
| First paid market? | **Vietnam first, then NZ through the NZ company** | Payments need a second provider and VietQR, money needs minor-unit handling (VND has none), the platform needs regions, and Vietnam's rules apply (§6.5, §6.9, §11.4). |
| Juniors? | **Build junior accounts early** | Guardian-managed juniors replace the 16+ rule (§6.8, Phase 3b). |
| Hard gates before the first outside club? | **All four** | Legal pack, accounts/domains/trademark, IP and licence audit, cost model and limits (§11.3). |
| Vietnam launch scope? | **VietQR bank transfer, local online payments, Zalo, and social and marketplace** | Social and marketplace are in the roadmap but shipped only when the gate passes (read together with the next answer). |
| Where does Vietnam's data live? | **Region-aware now; decide hosting with counsel** | Every club has a region; Sydney first (§6.9). |
| Social and marketplace? | **Gate them** | Thresholds, a moderation owner and each country's legal checks first (§8). |
| Vietnam discovery? | **5 to 10 clubs now** | No-engineering interviews start now (§11.4). |

### What the answers changed

1. **The Stripe plan was wrong for a Vietnamese owner.** The plan assumed TGS would hold the Stripe platform account. It can't be assumed for a Vietnamese entity; Stripe says platform and connected accounts must be in supported countries and its cross-border Connect list doesn't clearly include NZ. The NZ company fixes this and also puts NZ players' data and contracts under NZ law.
2. **Vietnam first is a bigger change than it sounds.** It adds: VND (no minor unit, so every `*_cents` assumption needs an audit), no Stripe, VietQR and wallets with payout delays, Zalo, Vietnamese-quality copy, a Vietnamese legal pack, regional data hosting, and a market that already has pickleball and court-booking apps (PickoNow, Padel Hub VN, the national association's app, ThePickleHub).
3. **Vietnam's rules can block features, not just paperwork.** Social features can need a licence or notification (Decree 147/2024), a marketplace can fall under the new E-commerce Law (from 1 July 2026), and the personal data law (from 1 Jan 2026) has cross-border transfer assessments with large penalties. Hence the gate on social and marketplace and the region-aware design.
4. **Vietnam awards trademarks to whoever files first.** File "Luvallplay" there early (examination can take 18 to 24 months).
5. **Free forever for NZ badminton has to be paid for somewhere.** Revenue now depends on Vietnam and other sports, so the cost model, metering and fair-use limits aren't optional.

### Points I recorded that you may want to correct

- I read **"Vietnam market first then NZ under an NZ business entity"** as: Vietnam is the first *paid* market, run by TGS Vietnam; the NZ company handles NZ and Australia, including the free partner clubs. If you meant the NZ company comes later, the legal gate for NZ partner clubs still needs *some* contracting entity first.
- I treated **social and marketplace in Vietnam** as "in the roadmap but gated", because the same answers also chose to gate them.
- The **proposed thresholds** in §8 and §11.6 (15 clubs and 500 weekly players; 5 partner clubs for 8 weeks) are my placeholders to confirm after the first partner period.

### Still open

- Kelcee's role and any equity or fee (build plan §11.1).
- Who the NZ company's resident director will be.
- Which Vietnamese payment gateway and bank-feed provider (after discovery).
- Whether Zalo means share links, notifications or a mini app.
- Where the Vietnam region is hosted (with counsel).
- Vision: platform product, Three Wolves product or licensed add-on, and who receives its revenue.
