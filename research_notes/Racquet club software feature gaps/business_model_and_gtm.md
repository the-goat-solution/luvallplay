# Business Model and Go-to-Market for a White-Label Racquet/Paddle Club Management SaaS (from Christchurch, NZ; as of Nov 2026)

Method note: research ran through web search plus a few page fetches (about 19 tool calls). Direct fetches of courtreserve.com, helloclub.com, stripe.com and docs.stripe.com failed because this session's network settings block those hosts, so vendor prices below come from search-engine summaries of the vendors' own pages, with third-party listings marked as such. Before the founder quotes any number externally, they should check it on the live vendor page. Currencies: USD unless marked. NZD prices are marked "NZ$" and exclude GST unless noted.

## 1. How comparable sports-club vertical SaaS companies price

### Takeaway
Pricing splits into three models. (a) Court-booking platforms for commercial and US pickleball/tennis venues charge flat monthly tiers of roughly US$160–600/month, gated by court count, with the branded app as a premium add-on carrying a ~US$499 setup fee. (b) Community-club tools (Hello Club in NZ, Jackrabbit) charge cheap tiers by member count, roughly NZ$58–298 or US$49–245/month. (c) "Free" apps (Spond, TeamApp, Playtomic's player app) earn from payment fees, booking commissions or ads instead of subscriptions. Branded apps nearly always sit in the top tier or are sold as an add-on.

### Cited Findings
**CourtReserve (US; tennis/pickleball/padel):**
- Current official tiers: Launch US$199/mo (US$159/mo billed annually, includes 8 courts); Advance US$369/mo (US$329 annually); Momentum US$549/mo (US$499 annually, 32 courts included). Add-ons cost extra. The branded mobile app carries a one-time US$499 setup fee and a 1-year contract. — [CourtReserve pricing page via search summary](https://courtreserve.com/pricing/); figures match [Pickleheads review](https://www.pickleheads.com/pickleball-gear/best-pickleball-court-reservation-software)
- Older third-party listings show much lower legacy pricing: a US$25/month base plan plus US$5/court/month and US$5/instructor/month ("pay as you grow"), and Basic US$50 / Deluxe US$99. These look outdated, which suggests CourtReserve has moved up-market and raised prices several-fold. — [Capterra](https://www.capterra.com/p/152562/CourtReserve/pricing/); [SoftwareSuggest](https://www.softwaresuggest.com/courtreserve)

**PlayByPoint (US; pickleball/tennis/padel):**
- Tiers reported by a competitor: Essential US$199/mo (US$159 annual), Advanced US$399 (US$329), Premium US$599 (US$499). The white-label branded app is reported as Premium-only. Unverified against PlayByPoint's own page. — [Book & Go comparison (competitor)](https://www.bookandgo.app/en/compare/play-by-point)
- PlayByPoint's own page claims "no training or setup costs", offers monthly or annual contracts with 30-day cancellation notice, and lists add-ons such as a TV Screen at US$29.99 and a Priority Access System at US$49.99. — [playbypoint.com/pricing via search summary](https://playbypoint.com/pricing)
- Pickleheads says the branded app has a US$499 setup fee, which conflicts with the "no setup costs" claim. — [Pickleheads](https://www.pickleheads.com/pickleball-gear/best-pickleball-court-reservation-software)

**Playtomic (Spain; padel-first marketplace plus club manager):**
- Commission is a percentage of the gross booking amount, set in each club's contract. The service fee is deducted automatically from each online player payment before payout, and the club gets a monthly service-fee invoice. — [Playtomic Manager help centre](https://helpmanager.playtomic.com/hc/en-gb/articles/50654517291537-Understanding-your-B2B-Commissions-how-they-re-calculated-invoiced-and-matched-to-your-payouts); [Old billing model guide](https://helpmanager.playtomic.com/hc/en-gb/articles/44898846238609)
- A competitor claims Playtomic charges €59–€279/month subscription plus a 4% commission on bookings. Not confirmed by any official Playtomic source. — [Book & Go (competitor)](https://www.bookandgo.app/de/playtomic-alternative)
- Stripe's case study describes Playtomic routing player payments to clubs through Stripe and automatically taking its commission, with about 1M monthly active users. — [Stripe customer story (title via search; page not fetchable)](https://stripe.com/customers/playtomic)

**Hello Club (NZ; generic club/membership software, a direct local comparator):**
- Flat monthly tiers by member-count band, not per-member pricing: Entry NZ$58/mo + GST (100 members; NZ$638/yr annual); Standard NZ$106/mo (300 members); Premium NZ$154/mo (1,000 members); Business NZ$298/mo (2,500 members; NZ$3,278/yr). 30-day free trial. — [helloclub.com/pricing via search summary](https://helloclub.com/pricing); older third-party figures (NZ$48 start, NZ$288 Business) at [Capterra](https://www.capterra.com/p/179258/Hello-Club/pricing/)
- Online card payments carry a separate per-transaction fee, and light/access control is an optional extra priced on request. — [Enterprise DNA](https://enterprisedna.co/omni/instead-of/hello-club/pricing)

**Spond (Norway; free team/club app):**
- Free for organisers and members. It earns from payment fees of about 2.5% + £0.20 (UK) or 2.5% + €0.20 (Eurozone), and US$1.00 + 3.29% in the US. The club can absorb the fee or pass it to members. It also reportedly earns from sponsored brand content and a paid club-website add-on. — [Klubraum blog](https://klubraum.com/blog/club-management-software/); [Medalyst](https://medalyst.io/guides/best-spond-alternatives); [BeeNet](https://beenet.app/blog/spond-alternatives-for-sports-clubs-2026/) (third-party, partly competitor sources)

**TeamApp (Australia; now "Stack Team App"):**
- Free, customisable "dedicated" club app funded by ads. Clubs can pay a fee to remove ads, priced by member count. Used in 150+ countries. — [Klubraum](https://klubraum.com/blog/the-17-best-apps-for-your-team-comparison/); [BenchApp](https://www.benchapp.com/blog/best-free-sports-team-management-apps) (third-party; official pricing page not found)

**Glofox (fitness analogue; owned by ABC Fitness):**
- Advertises "from US$99/month" with tier prices on request. Third parties estimate US$100–190/month base. The custom branded app sits in the top "Elite" tier, and estimates for it as an add-on range from US$39 to US$50–200/month. — [Glofox pricing](https://www.glofox.com/pricing-3068); [CostBench](https://costbench.com/compare/glofox-vs-mindbody/); [Gymdesk](https://gymdesk.com/blog/difference-between-zen-planner-and-glofox)

**Jackrabbit Class (US; youth activity/class analogue):**
- From US$49/month for 0–100 students, scaling by student count, with active and inactive students both counted. "Jackrabbit Plus" with a custom-branded app starts at US$89/month (another listing says US$93 + US$169 one-time setup). Enterprise is US$245/month and not student-count-based. — [Jackrabbit pricing](https://www.jackrabbitclass.com/pricing/); [Jackrabbit billing help](https://help.jackrabbitclass.com/help/jackrabbit-pricing-and-billing); [FitGap](https://us.fitgap.com/products/022820/jackrabbit-class)

**ClubSpark (UK; tennis-federation channel model):**
- Provided free to all LTA-registered venues and accredited coaches under the LTA partnership (rebranded "LTA ClubSpark"), with the federation paying. — [LTA news](https://www.lta.org.uk/news/2021/april/lta-launches-partnership-with-clubspark-to-provide-enhanced-online-booking-system/)

### Inferences
- The market has two price bands. Commercial or court-heavy venues (US pickleball/padel) accept about US$160–600/month. Volunteer community clubs (most NZ badminton, table tennis and small tennis clubs) anchor on Hello Club's NZ$58–154/month or on free tools (Spond, TeamApp, spreadsheets). A Christchurch-born product should price to the community band at home and keep a higher "venue" tier for padel/pickleball facilities.
- A suggested starting structure, derived from the comparables rather than tested: (1) a Club tier around NZ$49–79/month for up to ~150 members; (2) a Club Plus tier around NZ$99–149/month with branded PWA/custom domain and more admins; (3) a Venue tier around NZ$249–399/month with court booking, dynamic pricing and access control; (4) a native branded app as a paid add-on with a ~NZ$500–900 setup fee plus about NZ$30–60/month, mirroring CourtReserve's and PlayByPoint's US$499 setup; (5) a payments margin on top (see section 2). Annual prepay discounts of ~15–20% match CourtReserve's and PlayByPoint's spread.
- Charging per member band rather than per court suits badminton, table tennis and session-based clubs, which often rent hall time and own no courts. Per-court pricing (CourtReserve, legacy PlayByPoint) only fits venue owners.
- Player-paid booking or service fees (Playtomic, Spond's pass-through option) let the club's sticker price fall to near zero. That is a strong wedge for volunteer clubs, but it makes revenue depend on payment volume and can irritate players.

### Gaps
- CourtReserve's and PlayByPoint's payment-processing rates and markups were not found. Playtomic's actual commission percentage is undisclosed (only a competitor's 4% claim exists).
- No official current Spond Club or TeamApp ad-removal price was found.
- Vendor pages could not be fetched directly (host blocked), so all tier prices are from search summaries as of Nov 2026.

## 2. Share of revenue from embedded payments (payfac / Stripe Connect model)

### Takeaway
Payments routinely make up 20–50%+ of revenue in mature fitness/sports vertical SaaS: Mindbody's audited share was ~39% in 2017. At restaurant software analogue Toast, financial services far exceed subscriptions. With Stripe Connect a small platform can capture a margin without becoming a payfac, at a cost of US$2 per active connected account per month plus 0.25% + US$0.25 per payout when the platform sets its own pricing.

### Cited Findings
- Mindbody FY2017 (last public 10-K before going private): payments revenue US$71.3M of US$182.6M total (~39%), up 32% YoY from US$53.8M. — [Mindbody 10-K FY2017 (SEC)](https://www.sec.gov/Archives/edgar/data/0001458962/000145896218000003/mb_12-31x2017x10xk.htm) (old data, flagged)
- More recent estimates of Mindbody's payments share conflict: ~20% (attributed to a Bessemer memo) versus ~50% (attributed to management). — [Charge Forward "Embedded payments benchmarks 2026" (June 2026)](https://xznbmzskuzhwjhqmicwc.supabase.co/storage/v1/object/public/presentations/embedded-payments-benchmarks-2026-1781987692113.pdf)
- Mindbody markets its payments as included with the software and powered by Stripe. — [Mindbody Payments](https://www.mindbodyonline.com/business/payments); operator commentary at [Rainforest podcast summary](https://www.rainforestpay.com/blog/three-keys-to-mindbodys-embedded-payments-success-with-brad-greene)
- a16z (via secondary source) found that adding fintech features to vertical SaaS raises revenue per customer 2–5x. The same source says Toast earned ~US$5B from financial services versus US$936M from subscriptions (year unspecified; unverified). — [Apideck summarising a16z](https://apideck.com/blog/embedded-finance-vertical-saas); original [a16z "Fintech scales vertical SaaS"](https://a16z.com/fintech-scales-vertical-saas/) not fetched
- Leading vertical SaaS companies reportedly get 30–40% of total revenue from payments, lending and financial services. — [Windsor Drake Vertical SaaS Valuation Report Q4 2025](https://windsordrake.com/vertical-saas-valuation-report-q4-2025/) (not independently verified)
- SaaS platforms with embedded finance trade at a ~23% premium on revenue multiples. — [William Blair, Embedded Finance, Sept 2025](https://www.williamblair.com/-/media/downloads/ib/2025/williamblair_embedded-finance-sept-2025.pdf)
- Stripe Connect fees when the platform handles pricing: US$2 per monthly active account plus 0.25% + 25¢ per payout. An account counts as active in any month it receives a payout. If Stripe handles pricing (Standard accounts), the platform pays no Connect fees. The 0.25% + 25¢ is a payout fee, not an application fee. — [Stripe Support: Monetizing payments with Connect](https://support.stripe.com/questions/monetizing-payments-with-stripe-connect); [Stripe Connect pricing](https://stripe.com/connect/pricing)
- Playtomic uses Stripe to route player payments to clubs while taking its commission automatically, which is the "application fee" pattern. — [Stripe customer story](https://stripe.com/customers/playtomic); [Playtomic help centre](https://helpmanager.playtomic.com/hc/en-gb/articles/50654517291537-Understanding-your-B2B-Commissions-how-they-re-calculated-invoiced-and-matched-to-your-payouts)

### Inferences
- Rough unit economics for a typical NZ badminton club (my estimate, not sourced): 150 members × ~NZ$250/yr subs plus casual session fees could put ~NZ$40–80k/yr through the platform. A 0.5–1.0% platform margin (via Stripe Connect application fees on top of Stripe's NZ card rate) would add ~NZ$200–800/yr per club. That is meaningful next to a ~NZ$600–1,200/yr subscription, but it will not replace one for small clubs. Payments matter more for padel/pickleball venues with high booking volume.
- Stripe Connect's US$2/active account/month plus per-payout fee hurts tiny clubs. Batching payouts (weekly or monthly) keeps the per-payout fee down. For very small clubs, Standard accounts (Stripe handles pricing, so the platform pays no Connect fees, but monetisation options are reduced) may be better.
- Positioning payments as "included, money goes straight to the club's bank account" (the Mindbody approach) is more palatable to volunteer treasurers than a visible commission. Offering a "pass the fee to the player" toggle, as Spond does, lets clubs keep their full revenue.

### Gaps
- No current audited payments share for Mindbody/ABC, Glofox, CourtReserve or PlayByPoint was found.
- Stripe's NZ card rate and the Connect fees in NZD were not verified (stripe.com was blocked). Check stripe.com/nz/pricing.
- The Bessemer vertical SaaS + payments material was not retrieved.

## 3. White label vs branded multi-tenant; App Store rules; PWA vs native

### Takeaway
Apple's guideline 4.2.6 bans a template vendor from submitting per-club apps under its own account. Each club's app must be submitted by the club (the content provider) under its own developer account, or every club must live inside one aggregated "picker" app. Guideline 4.3(a) also discourages multiple bundle IDs of the same app for different "sports teams". Native per-club apps therefore carry real cost and friction. A multi-tenant app with club picker plus per-club branded PWA and custom domain is the cheap default, with a paid native white-label tier for larger clubs, which is how CourtReserve, PlayByPoint, Glofox and Jackrabbit package it.

### Cited Findings
- Apple guideline 4.2.6: "Apps created from a commercialized template or app generation service will be rejected unless they are submitted directly by the provider of the app's content. These services should not submit apps on behalf of their clients… Another acceptable option for template providers is to create a single binary to host all client content in an aggregated or 'picker' model…" — [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Apple guideline 4.3(a): "Don't create multiple Bundle IDs of the same app… If your app has different versions for specific locations, sports teams, universities, etc., consider submitting a single app and providing the variations using in-app purchase." — [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Apple guideline 5.2.1: apps "should be submitted by the person or legal entity that owns or has licensed the intellectual property". — [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Market packaging: CourtReserve sells its branded app for a US$499 one-time setup plus a 1-year contract. PlayByPoint reportedly limits white-label to its top (US$599/mo) tier. Glofox puts the custom branded app in its top Elite tier for franchises/enterprise. Jackrabbit's branded app needs the higher "Plus" plan (from US$89/mo). — [CourtReserve](https://courtreserve.com/pricing/); [Book & Go on PlayByPoint](https://www.bookandgo.app/en/compare/play-by-point); [Glofox](https://www.glofox.com/pricing-3068); [Jackrabbit](https://www.jackrabbitclass.com/pricing/)
- TeamApp markets itself as a "dedicated smartphone app for your club", but it is a single multi-tenant app with per-club spaces, free and ad-funded. — [Klubraum](https://klubraum.com/blog/the-17-best-apps-for-your-team-comparison/)
- National federations sometimes bundle co-branded platforms ("LTA ClubSpark"), so club branding is not always the priority; federation branding can be the selling point. — [LTA](https://www.lta.org.uk/news/2021/april/lta-launches-partnership-with-clubspark-to-provide-enhanced-online-booking-system/)

### Inferences
- What clubs want, in rough order of cost to provide: logo and colours (near-free in multi-tenant), then their own subdomain or custom domain for the booking/membership site (cheap with automated TLS), then their own App Store listing (expensive). Vendors sell the App Store listing as a premium tier or add-on, which suggests few small clubs pay for it.
- Running cost of a per-club native app (estimate): an Apple Developer Program membership in the club's name (US$99/yr standard; nonprofits can apply for a fee waiver, which I did not verify this session), Google Play's one-time US$25 developer fee, D-U-N-S/organisation verification, plus the vendor's labour for builds, screenshots, review responses and OS-update resubmissions across N apps. A US$499-type setup fee plus a recurring fee is how incumbents recover this.
- Suggested approach: (1) one multi-tenant native app ("Three Wolves"/product brand) with club picker and in-app club theming, which is 4.2.6-compliant; (2) an installable PWA per club on a custom domain, which iOS supports, including web push for home-screen web apps (verify current iOS behaviour); (3) a native white-label app only as a premium add-on, built with an automated pipeline (Expo EAS / Fastlane) and submitted under the club's own developer account.
- A multi-tenant app also builds the player network (players moving between clubs keep one login), which per-club white-label apps fragment. That is a strategic reason to keep the default app branded multi-tenant.

### Gaps
- Apple Developer fee waiver eligibility for NZ incorporated societies, and current iOS PWA push limits, were not verified this session.
- No survey data was found on what share of clubs will pay for their own App Store listing.

## 4. Go-to-market: volunteer clubs vs commercial venues, channels, cycles, churn

### Takeaway
Federation-endorsed or federation-funded distribution is the proven route in community racquet sport: ClubSpark rode the LTA and Tennis Australia to 1,500–2,500+ UK organisations, and its client list includes Tennis New Zealand. Volunteer clubs buy slowly (committee/AGM cycles), are highly price-sensitive and switch reluctantly. Commercial padel/pickleball venues buy faster and pay more. SMB SaaS churn benchmarks of ~2–5% a month show why retention levers (payments, data lock-in, player network) matter.

### Cited Findings
- The LTA provides ClubSpark free to all LTA-registered venues and accredited coaches (rebranded LTA ClubSpark). Reported scale ranges from 1,500 active UK organisations in year one to 2,500+ UK clubs. — [LTA news](https://www.lta.org.uk/news/2021/april/lta-launches-partnership-with-clubspark-to-provide-enhanced-online-booking-system/); [ClubSpark case study](https://clubspark.com/case-studies/delivering-british-tennis)
- Tennis Australia offers ClubSpark as a complimentary benefit for Business Coach members, and piloted ClubSpark's gated access and lighting system before a national rollout. — [Tennis Australia](https://tennis.com.au/clubspark); [ClubSpark case study](https://clubspark.com/case-studies/delivering-british-tennis)
- ClubSpark's client list includes Tennis New Zealand, Tennis Canada, the ITF, England Hockey and Basketball England. — [ClubSpark clients](https://clubspark.com/clients)
- No link was found between Badminton England and a preferred club platform. — (search returned nothing; see Gaps)
- Badminton NZ has about 25–27 regional member associations. One region (Badminton North Harbour) reported 20 affiliated clubs and 782 affiliated members in 2023. — [Wikipedia: Badminton NZ](https://en.wikipedia.org/wiki/Badminton_New_Zealand); [BNZ Annual Report 2019](https://badminton.org.nz/wp-content/uploads/2026/04/Badminton-New-Zealand-Annual-Report-2019.pdf); [Badminton North Harbour Annual Report 2023](https://www.bnh.org.nz/wp-content/uploads/2024/05/Annual-Report-2023.pdf)
- SMB SaaS churn: secondhand attributions to ChartMogul 2025 give median annual gross revenue churn of 11–13% for SMB vendors. Other benchmarks give 3–5% monthly for SMB-focused SaaS (up to 7%), with under 2% monthly called healthy. Definitions vary, so a defensible range is ~2–5% monthly. — [UserJot](https://userjot.com/blog/saas-churn-rate-benchmarks); [We Are Founders](https://www.wearefounders.uk/saas-churn-rates-and-customer-acquisition-costs-by-industry-2025-data/) (secondary, low rigour)
- Vendors use commitment terms as a retention tool: CourtReserve requires a 1-year contract for its branded app, while PlayByPoint offers monthly or annual plans with 30-day cancellation. — [CourtReserve](https://courtreserve.com/pricing/); [PlayByPoint](https://playbypoint.com/pricing)
- Hello Club offers a 30-day free trial and Playtomic a 14-day trial, so trials are the norm. — [Hello Club](https://helloclub.com/pricing); [Book & Go / review cited in search](https://www.bookandgo.app/de/playtomic-alternative)

### Inferences
- Recommended sequence:
  1. **Own Canterbury badminton first.** Use the Christchurch club as a live reference site. Approach Badminton Canterbury (regional association), its clubs and school programmes, and offer free data migration from spreadsheets, Hello Club or Sporty.
  2. **Expand to a regional association deal.** Offer an association-wide licence (association pays, or clubs get a discount) bundled with association-level features: inter-club competitions, affiliation/membership levy collection and player registration. This is the ClubSpark/LTA playbook at NZ scale.
  3. **Then a national federation pitch** (Badminton NZ, Table Tennis NZ, Pickleball NZ; Tennis NZ is already a ClubSpark client, so harder).
  4. **In parallel, commercial padel/pickleball venues in NZ/AU**, at a higher price with a faster sales cycle (owner-operator, single decision-maker).
- Volunteer-club sales cycles track committee meetings and the AGM/season start (NZ badminton winter season, roughly Mar–Sep). Time outreach for Oct–Feb so clubs can decide before registrations open. Expect deals to take one or two committee meetings (1–3 months) from first demo. This is an inference; no sourced cycle-length data was found.
- **Referral loops:** players belong to multiple clubs and move between them. A shared player identity plus inter-club events and ladders in the multi-tenant app makes each new member a carrier to the next club. Offer a referral credit (for example one free month per referred club that converts).
- **Coaches as a channel:** coaches run sessions across several venues and need booking and payments. A free or cheap coach tier, as the LTA does for accredited coaches, seeds the product into new clubs.
- **Onboarding/migration as a sales lever:** an incumbent's hardest problem for a volunteer committee is moving the member list, subs status and payment history. Offer "we migrate your data for free in 48 hours" plus a treasurer-friendly Xero export.
- **Councils/facility owners:** many NZ badminton and table tennis clubs hire council or school halls. Facility owners are a secondary channel for hall booking but a slow, procurement-driven sale. Deprioritise until there are references.
- **Reseller/partner:** regional associations or sports-tech consultancies could resell for a 15–25% revenue share (typical SaaS reseller range, unsourced here).

### Gaps
- No sourced data on sales-cycle length or churn specific to club software. Founder interviews or podcasts about CourtReserve, Playtomic or Hello Club go-to-market were not found in this session's searches.
- Current Badminton NZ club and member totals were not found; the newest national figure in results was from 1966 (350 clubs), which is unusable. Tennis NZ and Badminton England club counts were not found.

## 5. Market sizing and growth

### Takeaway
Padel (~20,000+ clubs and ~58,000 courts globally, adding ~5,000 clubs a year) and US pickleball (24.3M players in 2025, +172% in 3 years) are the fast-growing, venue-heavy segments where the money is. Badminton, table tennis and community tennis are larger in club count but low-WTP and volunteer-run. No reliable global club count for badminton or table tennis was found.

### Cited Findings
- Padel 2026 Playtomic Global Padel Report (with PwC Strategy&): ~58,300 courts and 20,900+ clubs worldwide (the landing page says "nearly 20,000 clubs"), with 19.4M players. In 2025, nearly 5,000 new clubs and almost 8,000 courts were added. — [Padel Addict](https://www.padeladdict.com/en/padel-is-experiencing-unstoppable-growth-more-than-58000-courts-worldwide-and-19-4-million-players/); [Playtomic Global Padel Report](https://playtomic.com/global-padel-report)
- Padel 2025 report (covering 2024): 7,100+ new courts and 3,280+ new clubs, with total courts passing 50,000. The FIP claims 35M players, a higher figure than Playtomic's. — [Padel Cluster](https://www.clusterpadel.com/en/padel-news/20250630/a-new-era-of-global-expansion-over-50000-padel-courts-worldwide.aspx); [Sports Tourism News](https://www.sportstourismnews.com/playtomic-global-padel-report-2025-the-global-sport-of-the-future/)
- The 2026 Padel Report names the US as one of the biggest long-term growth markets. — [Citybiz](https://www.citybiz.co/article/852288/playtomic-report-identifies-u-s-as-major-long-term-growth-market-for-padel/)
- Pickleball (SFIA 2026 report): 24.3M US participants in 2025, up 22.8% on 2024 and 171.8% over three years (4.2M in 2020). Of these, 16.8M are casual and 7.48M core (8+ times/yr); 42.9% are women. — [SFIA](https://sfia.org/research/u-s-pickleball-participation/); [The Dink](https://www.thedinkpickleball.com/report-24-million-americans-are-now-playing-pickleball-up-171-in-just-3-years/)
- Willingness to pay for small NZ clubs is anchored by Hello Club's NZ$58/month (100 members) to NZ$154/month (1,000 members), and by free alternatives (Spond, TeamApp). — [Hello Club](https://helloclub.com/pricing); [Klubraum](https://klubraum.com/blog/club-management-software/)

### Inferences
- Rough NZ serviceable market (estimate): if NZ has a few hundred badminton clubs plus similar numbers of table tennis and pickleball clubs and ~350–400 tennis clubs, the NZ total is perhaps 1,000–1,500 racquet clubs. At ~NZ$1,000/yr average that is ~NZ$1–1.5M ARR at 100% share, too small alone. AU, then UK/EU (padel) and the US (pickleball), are needed for a venture-scale outcome. NZ works as a lifestyle or bootstrap base.
- Padel venues have high booking volume and WTP but Playtomic has a strong network effect there. Pickleball's NZ/AU growth is the better near-term second wedge after badminton.

### Gaps
- No reliable global or NZ club counts for badminton (BWF), table tennis (ITTF) or pickleball NZ/AU. Badminton England affiliated-club numbers were also not found.
- No WTP survey of small community clubs was found; WTP is inferred from competitor price anchors.

## 6. Positioning: incumbent weaknesses and the niche to own

### Takeaway
Incumbents have repriced up-market (CourtReserve went from about US$25–99 to US$199–549/month) and are built around court rental. That leaves volunteer-run, session-based clubs (badminton "club nights", table tennis, social pickleball) underserved. These clubs rent hall time rather than courts, need fair rotation of who plays next, casual and member pricing and community features, and can only pay community-band prices.

### Cited Findings
- CourtReserve's current plans gate on court count (8 courts in Launch, 32 in Momentum), and legacy pricing was per court. — [CourtReserve](https://courtreserve.com/pricing/); [Capterra legacy pricing](https://www.capterra.com/p/152562/CourtReserve/pricing/)
- CourtReserve's and PlayByPoint's entry tiers both start around US$199/month (US$159 annual). — [CourtReserve](https://courtreserve.com/pricing/); [Book & Go on PlayByPoint](https://www.bookandgo.app/en/compare/play-by-point)
- Playtomic's model takes a commission per booking and is marketplace-led. Competitors target clubs unhappy with paying commission on every booking ("Stop paying 4% commission"). — [Book & Go](https://www.bookandgo.app/de/playtomic-alternative)
- Spond's percentage payment fees "can add up over a season" more than clubs expect. — [Medalyst](https://medalyst.io/guides/best-spond-alternatives)
- Hello Club is generic (used across many club types, not racquet-specific) and charges extra for light/access control. — [Enterprise DNA](https://enterprisedna.co/omni/instead-of/hello-club/pricing)

### Inferences
- Niche to own first: **"the club-night app for session-based racquet clubs"**, starting with badminton, then table tennis, social pickleball and club tennis social sessions. Core features: check-in, a fair automated court rotation queue (who's on next), casual vs member pricing, pay-per-session via Stripe, ratings/ladders and inter-club events. CourtReserve, PlayByPoint and Playtomic optimise court rental. Hello Club and Spond are generic. No found vendor leads with session rotation and gamified community for club nights (this needs a feature-level check by other researchers).
- Price at or below Hello Club (from ~NZ$49/month) with a no-commission promise on subscriptions and an optional small, transparent payments margin. Message: "built by a badminton club, for clubs; no per-booking commission".
- Avoid head-on competition with Playtomic in padel and CourtReserve in US pickleball venues until the product has references and a venue tier.

### Gaps
- No user-review mining (Capterra/G2 complaints) was done this session to quantify incumbent weaknesses; recommend a follow-up.

## 7. Legal and commercial

### Takeaway
Treat each club as the data controller ("data is the club's") and the platform as processor. Publish a DPA (GDPR Art. 28-style) usable in NZ/AU/UK/EU. Note NZ's new IPP3A (indirect collection notice duty, in force 1 May 2026), which matters when clubs or associations upload member lists or the platform shares player data across clubs. Keep card data off your servers with Stripe-hosted fields/Checkout to stay in the lightest PCI scope.

### Cited Findings
- NZ Privacy Act IPP3A came into force on 1 May 2026 and applies to personal information collected from that date. It requires notifying individuals when their information is collected from someone other than them, with exceptions such as when the person has already been notified. Several agencies in a chain can each carry obligations. — [Office of the Privacy Commissioner (NZ)](https://www.privacy.org.nz/resources-and-learning/a-z-topics/ipp3a/); [OPC codes decision paper](https://www.privacy.org.nz/assets/Codes-of-Practice-2020/Incorporating-IPP3A-into-Codes-of-Practice-Submitter-feedback-and-decision-paper.pdf); [Bell Gully](https://www.bellgully.com/insights/preparing-for-ipp-3a-new-requirements-effective-1-may-2026/); [Ministry of Justice](https://www.justice.govt.nz/about/news-and-media/news/new-privacy-information-principle-in/)
- Under Stripe Connect, connected accounts belong to the clubs and payouts go to their bank accounts, which supports a "money and data are the club's" position. — [Stripe Support](https://support.stripe.com/questions/monetizing-payments-with-stripe-connect)

### Inferences
- SaaS terms checklist: club owns its member data, with an export (CSV) on demand and on termination plus a deletion window (e.g., 30–90 days). The vendor gets a limited licence to process. Include an uptime target rather than a hard SLA for small tiers, liability caps tied to 12 months' fees, and an annual price-change notice. For the player network, separate the player's own account data (vendor as controller, with consent) from club membership records (club as controller). This split must be clear to handle cross-club profiles and IPP3A/GDPR notices.
- GDPR/UK GDPR for UK/EU clubs: an Art. 28 DPA, a sub-processor list (hosting, Stripe, email/SMS) and an international transfer mechanism. NZ has an EU adequacy decision, which eases EU-to-NZ transfers, but US-hosted sub-processors need SCCs or the Data Privacy Framework. Verify current adequacy status.
- AU Privacy Act 1988 / APPs apply to AU clubs above the small-business threshold, and reforms are ongoing. NZ IPP12 restricts disclosure overseas. Hosting in AU/NZ regions simplifies sales to federations and councils.
- PCI: using Stripe Checkout or Elements/Payment Element (card data entered into Stripe-hosted iframes) typically limits the platform to the simplest self-assessment (SAQ A). This is general knowledge that could not be verified this session because docs.stripe.com was blocked.

### Gaps
- Stripe PCI documentation, NZ IPP12 specifics, current NZ EU-adequacy status and AU Privacy Act reform status were not verified in this session (hosts blocked or searches returned nothing). A lawyer should review the SaaS terms and DPA before selling to UK/EU clubs.
