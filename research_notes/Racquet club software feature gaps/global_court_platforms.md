# Global Racquet/Court Club Management & Booking Platforms (late 2026)

> **Method note (read first):** This session could not fetch vendor sites or review sites directly. courtreserve.com, playbypoint.com, playtomic.com and capterra.com all failed DNS resolution in the sandbox. Everything below comes from web-search result summaries: vendor help-centre and blog pages, aggregators (Capterra, Software Advice, TrustRadius, SoftwareSuggest), industry press, and a lot of **competitor comparison pages** (Book & Go, Raklet, Waresport, Authic, 1club, Doinsport, Fluid, etc.). Competitor pages are marked [competitor] and should be weighed accordingly. Prices are USD unless stated. All dates are 2025–2026 unless flagged. Someone should spot-check the vendors' own pricing pages before any figure is quoted externally.
>
> **Known source error:** The Pickleheads "best pickleball court reservation software" article seems to mix up CourtReserve and PlayByPoint tiers. Its "CourtReserve Essential $199 / Premium $599 with white-label app" matches **PlayByPoint's** published tiers (Essential/Advanced/Premium), not CourtReserve's (Launch/Advance/Momentum). Don't use it for CourtReserve pricing.

---

## 1. Core modules per platform (booking, membership, pricing, open play, coaching, leagues, ratings, POS, access, app, API)

### Takeaway
The market splits into four groups:
- **(a) Racquet-specialist all-in-ones (US):** CourtReserve, PlayByPoint, PodPlay. These have the deepest racquet features: open play, waitlists, DUPR, leagues, access control and white-label apps.
- **(b) Marketplace-led platforms (EU/padel):** Playtomic and MATCHi. They bring player demand and a consumer app but take commission and own the player relationship.
- **(c) Governing-body platforms:** ClubSpark (LTA). Free to clubs, funded by a transaction fee.
- **(d) Generic or enterprise facility and club systems:** Club Automation, Clubessential/ForeTees, Jonas, EZFacility, Upper Hand, Omnify, Skedda, Bookteq. These are broad (billing, POS, F&B, CRM) but have little racquet-social depth.

The racquet specialists' features have converged on the same set: rules-based court grid, membership tiers, peak/dynamic pricing, open play with skill gating and waitlists, lessons/clinics, leagues, rating integrations (DUPR/WPR/UTR), POS, door/light integrations, a branded app and an API/webhooks.

### Cited Findings

**CourtReserve (US, St. Augustine FL; tennis/pickleball/padel)**
- Core platform: court and lesson booking, memberships, invoicing, POS and reporting. Advance tier adds API access, Flex Leagues, a stringing module and selected integrations. Momentum adds branded domains, a branded mobile app and all integrations — [Waresport [competitor]](https://www.waresport.com/blog/is-courtreserve-worth-it-2026-alternatives); [reserving.ai](https://reserving.ai/blog/courtreserve-pricing)
- Open play: recurring open-play sessions with a maximum registration count. A customisable court waitlist on the member portal notifies players when slots open; the default is first come, first served. Leagues are a module that has to be enabled — [CourtReserve New Admin Guide](http://help.courtreserve.com/en/articles/11164239-new-admin-guide)
- DUPR integration syncs ratings into member profiles and can restrict event/league registration by rating. The rating is checked only at registration. It costs $25/month on Launch and is included in Advance, Momentum and Enterprise — [CourtReserve help: DUPR integration](http://help.courtreserve.com/en/articles/8265424-courtreserve-dupr-integration)
- Integrations list names DUPR, USTA Connect, World Padel Rating, and Brivo for door access. Doors/courts entry is managed via two access providers — [CourtReserve integrations overview](http://help.courtreserve.com/en/articles/12091300-overview-courtreserve-integrations); [CourtReserve integrations guide](https://courtreserve.com/tennis-pickleball-software-integrations/)
- CourtReserve lists Clubessential as an integration, with single sign-on from the Clubessential portal. So it sells into private country clubs as a racquet add-on to the club's core ERP — [CourtReserve integrations guide](https://courtreserve.com/tennis-pickleball-software-integrations/)
- UTR support is listed only by a third party ("DUPR and UTR via paid integrations"). It is not on CourtReserve's own integration list, so treat it as unconfirmed — [Raklet [competitor]](https://www.raklet.com/alternatives/courtreserve-vs-raklet/)
- Kiosk mode is mentioned by a comparison site, but I found no official doc for it — [Raklet [competitor]](https://www.raklet.com/alternatives/courtreserve-vs-raklet/)
- Over 2,000 racquet clubs and paddle facilities use it (Oct 2025) — [Business Wire via Morningstar](https://www.morningstar.com/news/business-wire/20251021345748/courtreserve-secures-a-54-million-growth-investment-from-mainsail-partners-to-accelerate-innovation-in-racquet-paddle-club-software)

**PlayByPoint (US, Miami; pickleball/tennis/padel)**
- Booking, scheduling, POS and member management — [CB Insights](https://www.cbinsights.com/company/playbypoint)
- **Game Match**: a built-in matchmaking feature that turns a reservation into an open social game. The player creates an open match, sets a skill range and others join. Ranges can use NPRP (1–7), NRP (1–7), DUPR (2–8), WPR (0–21) or Club Locker (1–7). It is rules-based, not AI — [PlayByPoint help: Game Match](https://help.playbypoint.com/en/articles/12144816-game-match-making-your-club-more-social)
- Open play, lessons and programmes run in one system. Players join open play in the app, and caps and sign-ups are automatic — [PlayByPoint blog](https://www.playbypoint.com/blog/open-play-lessons-programs-one-system/)
- **Swish integration** for leagues and tournaments. Connected DUPR IDs pass automatically to Swish for score submission — [PlayByPoint help: Swish](https://help.playbypoint.com/en/articles/11801440-swish-integration-effortless-league-tournament-management)
- Add-ons: webhooks access $99/mo (single facility) or $250/mo (up to 10 facilities); check-in beacon $25 one-time; TV display module $50 one-time — [PlayByPoint pricing, via search summary](https://www.playbypoint.com/pricing/)
- PlayByPoint's own example of why clubs switch: Picklewood's prior software "can book a court, but can't book a kids lesson… can't do kids camps" — [PlayByPoint blog [vendor]](https://www.playbypoint.com/blog/court-reserve-alternative/)

**Playtomic / Playtomic Manager (Spain; padel-first, also tennis/pickleball)**
- Plan features listed on the pricing page: blocking, chats, customers, integrations, matches, payments, public classes, reports, scheduling, tournaments. Standard has 48-hour support response — [Playtomic pricing page (search snippet)](https://playtomic.com/pricing)
- Plans are chosen in the Billing menu after Stripe is configured (Standard / Professional). Some sources also name a third tier, "Championship" or "Champion" — [Playtomic Manager help centre](https://helpmanager.playtomic.com/hc/en-gb/articles/20535458071313-Pricing-and-subscription-plans); [SoftwareSuggest](https://www.softwaresuggest.com/playtomic-manager/pricing)
- Hardware integration: Manager sends bookings to the club's hardware provider (lights/access), paired via an API token. Named examples: Smart Padel, QT System, Micro Solution — [Playtomic Manager help: hardware](https://helpmanager.playtomic.com/hc/en-gb/articles/20534244219665-How-to-integrate-and-configure-your-hardware-with-Playtomic-Manager)
- One third-party lighting/gate vendor says integration access requires the Champion or Master plan — [Court Intelligence](https://courtintelligence.co.uk/playtomic-integration/)
- Has a club membership feature and a player-side "Premium" subscription — [Playtomic help: Club Membership](https://helpmanager.playtomic.com/hc/en-gb/articles/20534703609745-Club-Membership-Feature); [Playtomic help: Premium plan for players](https://helpmanager.playtomic.com/hc/en-gb/articles/20534670300561-Playtomic-Premium-Plan-for-players)
- Dynamic/peak pricing is listed as a feature by directories, with no detail — [SourceForge](https://sourceforge.net/software/product/Playtomic-Manager/)

**MATCHi (Sweden; padel/tennis/badminton/squash/table tennis/pickleball/golf)**
- Online court booking and payments, memberships, activities, coach scheduling, a booking widget, webhooks/APIs for partners, access and lighting control integrations, marketing automation integrations, and PadelLevels player ratings — [1club [competitor]](https://1club.ai/blog/best-padel-club-management-software-2026); [MATCHi](https://www.matchi.se/?lang=en_US)
- Split payment only for 2 or 4 players, only in the app (not web). Paying for a booking yourself is free; the service fee applies to splits — [padelsnipe](https://padelsnipe.com/en/blog/playtomic-alternatives-2026)
- **Supports badminton** natively, which matters for a badminton product: MATCHi is a direct European competitor — [cal.com blog](https://cal.com/blog/best-padel-booking-software)

**ClubSpark (LTA, UK; tennis-led, also padel/pickleball)**
- Core features: Court Booking, Coaching, Membership, plus a club website builder — [ClubSpark/Sport:80 help](https://sportlabs.zendesk.com/hc/en-us/articles/203030535-What-are-the-Costs-of-Clubspark)
- Live club pages show tiered booking prices from 1 April 2026: Wimbledon Park adult evening/weekend £14.60/hr; Southwark peak £5.20 per 30 min, with member discounts. Membership packages include coaching-only memberships, monthly direct-debit coaching memberships (£25/mo at Coach4All) and seasonal membership years. The platform supports peak/off-peak pricing, member-free booking, Direct Debit (GoCardless) and Stripe — [ClubSpark Wimbledon Park](https://clubspark.lta.org.uk/wimbledonpark/Booking/Courtbookingpage); [ClubSpark Tennis in Southwark](https://clubspark.lta.org.uk/TennisInSouthwark/bookinginfo); [ClubSpark Coach4All](https://clubspark.lta.org.uk/coach4all/Membership/Join); [ClubSpark Park Tennis Club](https://clubspark.lta.org.uk/parktennisclub/Membership/Join)

**PodPlay (US; pickleball, hardware-led "autonomous" venues)**
- Reservations, events, coaching, membership, analytics and payments, plus hardware: scoreboards, customer-triggered replays, door access, 24/7 remote security monitoring — [PodPlay FAQ](https://docs.podplay.app/support-and-troubleshooting/general-faqs)
- DUPR skill-based booking restrictions and automatic score submission to DUPR — [PodPlay FAQ](https://docs.podplay.app/support-and-troubleshooting/general-faqs)
- Access control via Kisi, integrated with PodPlay's white-label apps. The "Autonomous" tier allows low- or no-staff operation — [Kisi blog](https://www.getkisi.com/blog/racket-ball-software); [PodPlay autonomous](https://podplay.app/autonomous-outdoors)
- Raised $8M — [The Dink](https://www.thedinkpickleball.com/podplay-raises-8m-to-power-the-future-of-frictionless-pickleball/)

**Club Automation (Daxko; US fitness and racquet clubs)**
- Membership management, court booking, online registration, billing engine, facility access control, member self-service portal, reporting — [RacquetDesk [competitor]](https://racquetdesk.com/best-tennis-club-software/); [ActivityMessenger](https://activitymessenger.com/blog/best-tennis-club-management-software-in-depth-comparison/)
- Positioned for large, enterprise-level clubs with complex membership structures — [WodGuru](https://wod.guru/blog/tennis-club-software/)

**Clubessential / ForeTees (US private country clubs)**
- ForeTees court module covers tennis, pickleball, padel and other racquet sports. A multi-purpose court blocker handles shared tennis/pickleball layouts — [ForeTees Courts](https://www.foretees.com/Courts)
- Clubessential's courts module uses court grouping for mixed court types (tennis, pickleball, bocce), with booking by time slot, duration and party size — [Clubessential docs](https://clubessential.atlassian.net/wiki/spaces/OF/pages/3473974/Courts+Member+Booking)
- Members book through the ForeTees app. Clubs set advance booking windows, e.g. 3 days — [Del Rio CC](https://www.delriocountryclub.com/amenities/racquet-sports); [TVR Pickleball Club](https://www.tvrpickleballclub.com/Court-Schedules)

**Bookteq (UK, owned by Playfinder; multi-sport facilities, pitches, pavilions, councils/schools)**
- Online bookings, payments and invoicing; block bookings; automatic email/SMS reminders; recurring payments; reporting; configurable facilities, pricing and booking rules; multi-facility mode; operator approval before a booking is confirmed — [Software Advice](https://www.softwareadvice.com/membership-management/bookteq-profile/); [Capterra UK](https://www.capterra.co.uk/software/211620/bookteq)
- Access and floodlight control and an outsourced "Managed Booking Service" are bespoke-priced (G-Cloud 15 listing, Jan 2026) — [G-Cloud pricing doc](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/705623/806807843973490-pricing-document-2026-01-30-0918.pdf)
- Linked to the Playfinder consumer marketplace — [Playfinder partner](https://playfinder.com/partner)

**Upper Hand (US; training/coaching facilities)**
- Strongest in training and coaching. The Grow plan adds facility/resource management, retail/inventory, and staff/payroll — [CoachIQ [competitor]](https://www.coachiq.io/blog/sports-facility-management-software); [eSoft Planner [competitor]](https://www.esoftplanner.com/feeds/blog/sports-facility-management-software)

**EZFacility (US; multi-sport complexes)**
- Positioned for larger multi-sport operations — [CoachIQ [competitor]](https://www.coachiq.io/blog/sports-facility-management-software)

**Omnify (US; class/activity businesses)**
- Online booking, class and appointment scheduling, payments. Marketing targets kids' activities and class businesses; no confirmed court-booking or racquet-specific features — [Software Advice](https://www.softwareadvice.com/coaching/omnify-profile/)

**Skedda (generic space booking)**
- Built for shared spaces (offices, meeting rooms, studios, venues). No court-specific features found — [GetApp](https://www.getapp.com/all-software/a/skedda-bookings/)

**Emerging AI-native entrants (2025–2026)**
- CourtIQ: "AI-native facility OS". Skill-gated open play with waitlists, DUPR-aware eligibility, kiosk check-in — [CourtIQ](https://courtiq.live/)
- Clubhouse: open play starts with a few courts and adds more as sign-ups grow; discounted extension offered to players already on court when the next slot is empty; churn-prediction analytics — [Clubhouse](https://www.clubhousesports.ai/)

### Inferences
- **Table-stakes modules** (every racquet specialist has them): rule-based court grid with advance windows, membership tiers with member pricing, peak/off-peak pricing, open play/drop-in with caps, waitlist notifications, lessons/clinics/programmes, event registration, POS/pro shop, reporting, a member mobile app, and online payments (Stripe).
- **Differentiators in the US specialists:** rating-gated registration (DUPR/WPR), social matchmaking ("open match" from a booking), league/tournament engines (native or via Swish), door/light access integrations (Brivo, Kisi), check-in beacons/kiosks/TV displays, a stringing module, webhooks/API, and a white-label app on top tiers.
- **For a badminton product:** rating systems for badminton are not standardised the way DUPR/UTR/WPR are, so a generic "skill level range" field plus a pluggable rating integration would cover the same need. Badminton-specific rating sources are covered by the other researcher.
- The "autonomous venue" pattern (PodPlay, CourtIQ): door access + cameras + kiosk + booking-gated entry. It is a growing upsell for unstaffed venues and is hardware-dependent.

### Gaps
- No primary feature data found for **Jonas Club Software** racquet modules or for **EZFacility** court-specific features.
- **TeamReach-type team-communication tools** were not researched in depth: no racquet-specific results surfaced, and the sport-social apps are covered by another researcher.
- CourtReserve kiosk mode, QuickBooks/Xero sync and Kisi support are **not confirmed** by official docs in these searches.
- Playtomic's own feature-by-plan matrix could not be retrieved; the sandbox blocked playtomic.com.
- No "Sportlogiq-type" racquet player found. Sportlogiq is a hockey/soccer analytics firm, so not relevant.

---

## 2. White-label / custom-branded member apps and their price

### Takeaway
A white-label app is usually locked to the top tier or sold as a setup-fee add-on:
- **CourtReserve:** about $499 setup plus a one-year contract, or included in Momentum ($499–549/mo).
- **PlayByPoint:** Premium only ($599/mo on annual).
- **PodPlay:** white-label apps run alongside per-court tiers.

The marketplace models (Playtomic, MATCHi) generally **do not** give clubs their own branded app; players book inside the vendor's consumer app. ClubSpark is LTA-branded with club micro-sites. Competitors explicitly market against the "branded app tax," which points to a gap a white-label product can fill.

### Cited Findings
- CourtReserve: the branded mobile app is a $499 setup plus a one-year contract. Launch and Advance get only a "Powered by CourtReserve" co-branded portal; Momentum includes branded domains and a branded app — [Raklet [competitor]](https://www.raklet.com/alternatives/best-courtreserve-alternatives/); [Waresport [competitor]](https://www.waresport.com/blog/is-courtreserve-worth-it-2026-alternatives); [Pickleheads](https://www.pickleheads.com/pickleball-gear/best-pickleball-court-reservation-software)
- A competitor markets itself as a "CourtReserve Alternative Without the Branded App Tax" — [Book & Go [competitor]](https://www.bookandgo.app/en/courtreserve-alternative)
- PlayByPoint: Essential includes a standard (PlayByPoint-branded) app. The white-label app, concierge onboarding and priority support are Premium only, at $599/mo on annual; one competitor says $499/mo is the monthly rate (unverified and inconsistent, since monthly would normally cost more) — [PlayByPoint pricing (search summary)](https://www.playbypoint.com/pricing/); [Fluid [competitor]](https://www.fluidpb.com/compare/playbypoint)
- PodPlay: Kisi access control "seamlessly integrates with PodPlay's white-label apps" — [Kisi blog](https://www.getkisi.com/blog/racket-ball-software)
- Playtomic: sources conflict. One directory says clubs can take bookings through their own white-label app. Authic and Doinsport say there is no white-label app and players book in the Playtomic app — [SourceForge](https://sourceforge.net/software/product/Playtomic-Manager/); contradicted by [Authic [competitor]](https://www.authic.io/blog/the-12-best-padel-club-management-software-tools-in-2026) and [Doinsport [competitor]](https://doinsport.com/en/blog/alternative-to-playtomic-which-management-software-to-choose-for-your-padel-club)
- MATCHi: the club runs through MATCHi as an intermediary and doesn't keep its own direct booking brand. Clubs wanting a branded app are pointed to "club-first" platforms — [Best Padel Club Booking Software (meetscarlet)](https://meetscarlet.com/guides/best-padel-club-software/); [getrivals](https://getrivals.app/articles/padel-apps/apps-matchi-vs-playtomic)

### Inferences
- Market price anchor for a branded app: **about $500 one-off setup, or about $500–600/mo all-in plan**. A white-label badminton product that includes branding at a lower tier would undercut the US leaders on their most visible upsell.
- Club owners' main objection to marketplaces is losing the player relationship and data (see Section 4). A white-label app that keeps the club's brand and data is the counter-position, and smaller vendors (Book & Go, Flow/askai, Padel iQ, Smash) are already using it.

### Gaps
- No confirmed white-label pricing for MATCHi, Club Automation, Clubessential, EZFacility or Upper Hand.
- Clubessential/Jonas are known in the market to provide club-branded member apps, but no source was retrieved in this session, so that is unconfirmed here.

---

## 3. Published pricing tiers, fees and target customers

### Takeaway
- **US racquet specialists:** published flat tiers at $159–$599/mo, scaled by court count or features, plus card processing at about 2.7–2.9% + $0.15–0.30.
- **PodPlay:** per-venue plus per-court pricing.
- **EU marketplaces:** low or opaque subscriptions plus booking commission (Playtomic) or setup + monthly + transaction fee (MATCHi).
- **ClubSpark:** free to LTA venues with a 0.8% platform fee.
- **Enterprise club systems:** quote-only.

### Cited Findings

| Platform | Published tiers / pricing | Fees | Target customer | Source |
|---|---|---|---|---|
| **CourtReserve** | Launch $199/mo ($159 annual), up to 8 courts; Advance $369/mo ($329 annual), up to 16 courts; Momentum $549/mo ($499 annual), up to 32 courts; Enterprise custom. DUPR add-on $25/mo on Launch. Branded app $499 setup. Older Capterra listing "$25/mo base" looks outdated | Processing fees not confirmed | Tennis/pickleball/padel clubs, 2,000+ facilities, North America | [Pickleheads](https://www.pickleheads.com/pickleball-gear/best-pickleball-court-reservation-software); [Waresport](https://www.waresport.com/blog/is-courtreserve-worth-it-2026-alternatives); [Sports Booking Mgmt](https://sportsbookingmanagement.com/compare/courtreserve); [CR DUPR help](http://help.courtreserve.com/en/articles/8265424-courtreserve-dupr-integration); [Capterra](https://www.capterra.com/p/152562/CourtReserve/pricing/) |
| **PlayByPoint** | Essential $199/mo; Advanced $399/mo; Premium $599/mo (all annual contracts). Capterra "$99.99 per feature/mo" looks outdated | Cards: Essential 2.9% + $0.30; Advanced/Premium 2.7% + $0.15. Webhooks $99–250/mo | Pickleball/tennis/padel clubs, US | [PlayByPoint pricing](https://www.playbypoint.com/pricing/); [itechguides](https://www.itechguides.com/best/court-reservation-software/playbypoint/); [Capterra](https://www.capterra.com/p/179783/PlayByCourt/) |
| **PodPlay** | Basic $100 venue + $30/court; Basic Plus $100 + $60/court; Pro $300 + $150/court (video courts); Autonomous $500 + $350/court (access control). Hardware about $2,500/court | — | Pickleball venues, including unstaffed | [PodPlay FAQ](https://docs.podplay.app/support-and-troubleshooting/general-faqs) |
| **Playtomic Manager** | Standard / Professional (/ Championship or Champion). Third-party figures: $38, $88, $276/mo. Not publicly displayed; price set after a sales call | Booking commission deducted before payout, rate unpublished. Estimates: about 4% on bookings, up to 20% on open matches [competitor]; 5–15% [competitor]. Players also pay a service fee | Padel-first clubs, Europe, expanding to US/UK/DE | [SoftwareSuggest](https://www.softwaresuggest.com/playtomic-manager/pricing); [youarepadel](https://youarepadel.com/en/playtomic-reviews-alternatives); [cluba.app](https://cluba.app/en/resources/blog/playtomic-fees-for-clubs); [askai/Flow [competitor]](https://askai.sa/compare/playtomic); [Padel iQ [competitor]](https://padeliq.io/compare/playtomic) |
| **MATCHi** | Custom quote: setup fee + monthly + transaction fee. One directory says from about €99/mo + 1–2% (unverified). No free plan or trial | Player service fee on split payments | Racket venues in Nordics/Europe, multi-sport including badminton | [1club](https://1club.ai/blog/best-padel-club-management-software-2026); [zipdo](https://zipdo.co/best/padel-booking-software/) |
| **ClubSpark (LTA)** | Free for LTA-registered venues and LTA-accredited coaches | 0.8% ClubSpark fee per online transaction (from the member's payment) plus Stripe/GoCardless fees (page updated around Apr 2026) | UK tennis clubs, parks, coaches | [ClubSpark help](https://sportlabs.zendesk.com/hc/en-us/articles/203030535-What-are-the-Costs-of-Clubspark) |
| **Bookteq** | From about £80/mo. Access/floodlight control and Managed Booking Service bespoke. Playfinder partner plans from £50/mo (unclear if Bookteq) | — | UK multi-sport facilities, councils, schools, pavilions | [Software Advice](https://www.softwareadvice.com/membership-management/bookteq-profile/); [SportMember](https://www.sportmember.co.uk/en/clubmanagement/best-booking-system-for-sports-clubs-and-venues); [G-Cloud](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/705623/806807843973490-pricing-document-2026-01-30-0918.pdf); [Playfinder](https://playfinder.com/partner) |
| **Skedda** | From $99/mo (annual). Sources conflict on structure: Starter 15 spaces; or $99/$149/$199 flat; or per-space | — | Generic shared spaces | [Toolradar](https://toolradar.com/tools/skedda/pricing); [FrontDesk Review](https://frontdeskreview.com/software/desk-booking/skedda/) |
| **Upper Hand** | Start $79/mo, Grow $199/mo (annual). Add-ons: website builder $50/mo, Advanced Insights $50/mo | — | Coaches, training facilities, franchises | [CoachIQ](https://www.coachiq.io/blog/sports-facility-management-software); [eSoft Planner](https://www.esoftplanner.com/feeds/blog/sports-facility-management-software) |
| **EZFacility** | Quote-only. Third-party estimates: $99/mo, $144/mo, or $400–700/mo mid-size | — | Large multi-sport complexes | [Capterra compare](https://www.capterra.com/compare/54308-151570/EZFacility-Club-Management-vs-Upper-Hand); [sportskey](https://sportskey.com/post/best-sports-facility-management-softwares/) |
| **Omnify** | Growth Pro $149/mo (5 staff), Accelerate Pro $349/mo (10), Scale Pro $599/mo. Alternative listing: $79/$199/$499. No setup fee | Scale Pro 0.5% transaction fee | Kids' activity/class businesses | [TrustRadius](https://www.trustradius.com/products/omnify/pricing); [Capterra](https://capterra.com/p/149645/Omnify/pricing/); [Findstack](https://findstack.com/products/omnify/pricing) |
| **Club Automation** | Quote-only. Capterra lists "$150 per user/month" (unverified) | — | Large fitness and racquet clubs | [Capterra](https://www.capterra.com/p/130770/Club-Automation/) |
| **Clubessential/ForeTees, Jonas** | Not published | — | Private country/golf clubs with racquet amenities | [ForeTees](https://www.foretees.com/Courts) |

**Funding and scale (context for competitive intensity)**
- CourtReserve: $54M growth investment from Mainsail Partners, Oct 2025. Funds go to product, support, integrations and North American reach; the founders retained control — [Business Wire via Morningstar](https://www.morningstar.com/news/business-wire/20251021345748/courtreserve-secures-a-54-million-growth-investment-from-mainsail-partners-to-accelerate-innovation-in-racquet-paddle-club-software); [The Dink](https://www.thedinkpickleball.com/pickleball-platform-courtreserve-secures-54m-investment-the-dream-is-to-scale/)
- Playtomic:
  - **March 2025 round:** €65M (€55M equity + €10M Santander debt). Gross revenues above €240M in 2024 (+40%); 6,000 clubs; 1.5M monthly active players — [Cluster Padel](https://www.clusterpadel.com/en/associate-news/20250319/playtomic-raises-%E2%82%AC65-million-to-strengthen-its-leadership-in-europe-and-accelerate-its-exp.aspx)
  - **Crowdcube, Dec 2025:** £4.5M from about 4,600 investors. Reported €346M transacted (+51% y/y) and €29M net revenue (+38% y/y) to Sept 2025 — [Crowdcube](https://www.crowdcube.com/companies/playtomic/pitches/qrMYkb); [Tracxn](https://tracxn.com/d/companies/playtomic/__NG3HC79RRpuPHrMXH53BY7ak3ZqbgHyYucTPSiA0YF4)
  - **Revenue trackers conflict:** Dealroom's $2.6B is an obvious error — [Dealroom](https://dealroom.co/companies/playtomic/)
  - One unverified mention of an acquisition of "TIMP" in Sept 2026 — [search summary; unverified]
- PodPlay raised $8M — [The Dink](https://www.thedinkpickleball.com/podplay-raises-8m-to-power-the-future-of-frictionless-pickleball/)
- PlayByPoint: privately held, VC-backed; no 2025–26 round found — [CB Insights](https://www.cbinsights.com/compare/courtreserve-vs-playbycourt)

### Inferences
- **Price bands a white-label badminton product competes against:** about $80–200/mo entry (Bookteq, CourtReserve Launch, PlayByPoint Essential, Upper Hand), $330–400/mo mid, $500–600/mo top tier with branded app.
- Court count is the main scaling unit for CourtReserve and PodPlay. Playtomic, MATCHi and ClubSpark monetise transactions instead.
- **Effective take-rates:** about 2.7–2.9% card processing (US specialists), 0.8% + processor (ClubSpark), and an unpublished commission on top of the subscription (Playtomic). A transparent "no booking commission" stance is a recognised selling point in competitor marketing.
- Badminton clubs, mostly community and volunteer-run with low revenue per court, sit well below the US specialists' $159+/mo floor. ClubSpark's free + 0.8% model is the closest price analogue for volunteer clubs.

### Gaps
- Could not verify any pricing directly on vendor pages (sandbox DNS block). CourtReserve card-processing rates were not found.
- No published pricing for MATCHi, Playtomic (official), Club Automation, Clubessential, ForeTees, Jonas or EZFacility.
- GBP/EUR pricing for the US vendors outside North America was not found.

---

## 4. What reviews say clubs love and hate; switching reasons

### Takeaway
- **CourtReserve:** well rated for admin depth and fast feature iteration. Competitors call its UX dated and labour-intensive.
- **PlayByPoint:** fewer reviews, with conflicting support ratings.
- **Playtomic:** clubs dislike the commission and losing ownership of the player relationship; players complain about refunds.
- **Club Automation:** easy to use day-to-day but drags on billing accuracy, cost overruns and speed.

Common switching triggers: the inability to handle kids' programmes/camps, member booking confusion that pushes work back to the front desk, commissions, billing errors, and the wish for one all-in-one system with your own brand.

Independent evidence (Reddit, club forums) was **not** retrievable in this session. Most "cons" come from competitor marketing.

### Cited Findings

**CourtReserve**
- Capterra 4.7/5 (53 reviews); ease of use 4.5; customer service 4.5; mobile access 4.1 — [Capterra](https://www.capterra.com/p/152562/CourtReserve/reviews/)
- What reviewers like: a capable admin side with features added regularly at admins' request; desktop and mobile apps; a single login for admin and member; live-chat support; a "family business" feel with personal attention — [Capterra](https://www.capterra.com/reviews/152562/CourtReserve)
- Cons: at least one reviewer found the help feature hard to use. The sample of cons is thin — [Capterra](https://www.capterra.com/reviews/152562/CourtReserve)
- PlayByPoint's own comparison quotes operators:
  - CourtReserve's admin "feels like older software"
  - It needs more manual owner work
  - Members find booking confusing and go to the front desk instead
  - Pickleball XPO: "a bit of a dinosaur"
  - Santa Monica Pickleball Center: "had to do a lot more work"
  - [PlayByPoint blog [vendor/competitor]](https://www.playbypoint.com/blog/court-reserve-alternative/)
- Competitors also attack the branded-app setup fee and the tier-gated integrations (API and DUPR on higher tiers) — [Book & Go [competitor]](https://www.bookandgo.app/en/courtreserve-alternative); [Waresport [competitor]](https://www.waresport.com/blog/is-courtreserve-worth-it-2026-alternatives)

**PlayByPoint**
- Capterra 4.5/5 (20 reviews); support channels include 24/7 live rep and chat — [Capterra](https://www.capterra.com/p/179783/PlayByCourt/)
- SourceForge shows a support score of 1.0/5 (sample size unknown), which conflicts with Capterra — [SourceForge](https://www.sourceforge.net/software/product/Playbypoint)
- Switching story: a club left its previous system because it couldn't book kids' lessons or camps — [PlayByPoint blog](https://www.playbypoint.com/blog/court-reserve-alternative/)

**Playtomic**
- Club grievances (from competitor sites):
  - Commission on card bookings, with quiet midweek hours still unfilled
  - Clubs try to move repeat players onto their own channel to avoid commission and keep their data
  - [askai/Flow [competitor]](https://askai.sa/compare/playtomic); [Padel iQ [competitor]](https://padeliq.io/compare/playtomic); [Smash [competitor]](https://www.smashappofficial.com/en/blog/looking-for-a-playtomic-alternative)
- Player complaints on Trustpilot:
  - A court under maintenance was still bookable, and Playtomic pointed the player to the club for a refund
  - Unrequested annual membership charges
  - Refunds refused under cancellation windows
  - [Trustpilot UK](https://uk.trustpilot.com/review/www.playtomic.io)
- Commission and tier prices aren't published. Pricing is set after a sales call — [youarepadel](https://youarepadel.com/en/playtomic-reviews-alternatives); [cluba.app](https://cluba.app/en/resources/blog/playtomic-fees-for-clubs)

**MATCHi**
- Strong for venue booking, memberships, activities and coach scheduling. Split payment is limited to 2 or 4 players and to the app. Clubs don't keep their own booking brand — [1club](https://1club.ai/blog/best-padel-club-management-software-2026); [padelsnipe](https://padelsnipe.com/en/blog/playtomic-alternatives-2026)

**Club Automation**
- Capterra about 4.0–4.1/5 (about 77 reviews) — [Capterra](https://www.capterra.com/p/130770/Club-Automation/)
- Likes: simple, fast, cloud-based, a clean interface; "easier to use than similar software" — [G2](https://www.g2.com/products/club-automation/reviews); [Software Advice](https://www.softwareadvice.com/club-management/club-automation-profile/reviews/)
- Hates:
  - "told us we would save money but… our fees were double"
  - Proration isn't optional
  - Training at launch was too short and there was no dedicated contact
  - Slow and buggy; inaccurate billing that is hard to resolve
  - "Do not get this software" (G2)
  - [Capterra p3](https://www.capterra.com/p/130770/Club-Automation/reviews?page=3); [G2](https://www.g2.com/products/club-automation/reviews); [ActivityMessenger](https://activitymessenger.com/blog/best-tennis-club-management-software-in-depth-comparison/)
- Feels heavy and less intuitive for smaller academies — [WodGuru](https://wod.guru/blog/tennis-club-software/)

**General buyer advice in the category**
- Ask for a 12-month total cost of ownership projection. The range runs from $39/mo (eSoft Planner) to $499+/mo (CourtReserve Momentum) — [topspindigital](https://topspindigital.co/blog/racquet-sports-club-software-2026)
- Compare total cost including transaction fees and setup, not just the headline monthly price — [sportskey](https://sportskey.com/post/best-sports-facility-management-softwares/)

### Inferences
- Recurring pain points to design against:
  1. Admin UX that needs heavy manual work.
  2. Member booking flows confusing enough to drive phone/desk calls.
  3. Opaque or rising fees (commission, setup, tier-gated integrations).
  4. Billing inaccuracy and inflexible proration.
  5. Weak support for juniors (kids' lessons, camps).
  6. Loss of brand and data to marketplaces.
- Things clubs value: rapid feature responsiveness to admin requests (CourtReserve), a single login for admin and member, live-chat support, and social features that fill courts without staff (Game Match, open play).

### Gaps
- **Reddit threads (r/pickleball, r/tennis, r/padel) and club forums were not retrievable.** No independent first-hand owner complaints about CourtReserve, PlayByPoint or MATCHi were found. Most "cons" are from competitor marketing.
- G2 review details for CourtReserve and PlayByPoint were not retrieved.
- No reviews were found for ClubSpark, Bookteq, ForeTees or Jonas specifically for racquet use.

---

## 5. 2025–2026 trends: AI, dynamic pricing, social matchmaking, open-play automation, payments revenue models

### Takeaway
Six trends stand out:
1. **Consolidation into all-in-one platforms.**
2. **Dynamic pricing becoming standard.**
3. **Rating-gated open play and matchmaking**, with DUPR as the de facto pickleball standard and WPR/PadelLevels for padel.
4. **"Autonomous" unstaffed venues** (access control + cameras + kiosks).
5. **AI as a marketing differentiator:** churn prediction, demand forecasting, AI skill assessment. Mostly vendor claims.
6. **Revenue models shifting to payments take-rates** (processing margin, commission, player service fees, player subscriptions).

Capital is flowing in: CourtReserve $54M (2025), Playtomic €65M (2025) plus crowdfunding, PodPlay $8M.

### Cited Findings
- **All-in-one:** clubs consolidate because shared scheduling, pricing and reporting data reveals slow slots for targeted programming; patching disconnected systems wastes operator time — [PlayByPoint guide [vendor]](https://www.playbypoint.com/guides/why-racquet-sports-clubs-are-switching-to-all-in-one-management-software-in-2026/)
- **Dynamic pricing:**
  - 1club: rates adjust automatically by time of day, day of week or demand — [1club](https://1club.ai/blog/best-tennis-club-management-software-2026)
  - Clubhouse: a discounted extension offered to players already on court when the next slot is empty — [Clubhouse](https://www.clubhousesports.ai/)
  - Playtomic is also listed with peak/off-peak/dynamic pricing — [SourceForge](https://sourceforge.net/software/product/Playtomic-Manager/)
- **Open-play automation:**
  - Clubhouse adds courts as sign-ups grow — [Clubhouse](https://www.clubhousesports.ai/)
  - CourtIQ: skill-gated sessions, waitlists, DUPR eligibility, kiosk check-in — [CourtIQ](https://courtiq.live/)
  - PlayByPoint: automatic caps and sign-ups — [PlayByPoint blog](https://www.playbypoint.com/blog/open-play-lessons-programs-one-system/)
- **Social matchmaking:** PlayByPoint Game Match uses rating-range open matches, and Playtomic is built around open matches. Playtomic's commission on open matches is reportedly up to 20% (competitor claim) — [PlayByPoint help](https://help.playbypoint.com/en/articles/12144816-game-match-making-your-club-more-social); [askai/Flow [competitor]](https://askai.sa/compare/playtomic)
- **Ratings integration as an expectation:**
  - DUPR integration is listed by PlayByPoint, PodPlay and CourtReserve — [CourtReserve help](http://help.courtreserve.com/en/articles/8265424-courtreserve-dupr-integration); [PodPlay FAQ](https://docs.podplay.app/support-and-troubleshooting/general-faqs)
  - Tournament organisers use DUPR data to balance brackets — [Waresport](https://www.waresport.com/blog/best-pickleball-club-management-software)
  - CourtReserve integrates World Padel Rating; MATCHi uses PadelLevels — [CourtReserve integrations](http://help.courtreserve.com/en/articles/12091300-overview-courtreserve-integrations); [1club](https://1club.ai/blog/best-padel-club-management-software-2026)
- **AI skill assessment:** DUPR and Volley launched an AI on-court assessment (Aug 2026) for player placement, league balancing, open-play organisation and tailored coaching — [DUPR blog](https://www.dupr.com/post/dupr-and-volley-launch-ai-powered-on-court-assessment)
- **AI analytics claims:** "AI-native" vendors (1club, CourtIQ) pitch forecasting, revenue-per-slot reporting and churn prediction; Clubhouse flags members likely to churn. All are vendor claims — [CourtIQ](https://courtiq.live/); [Clubhouse](https://www.clubhousesports.ai/); [1club](https://1club.ai/blog/best-padel-club-management-software-2026)
- **AI video:** PlayByPoint-associated AI video processing (stats, highlights, officiating). PodPlay offers customer-triggered replays and scoreboards — [CB Insights](https://www.cbinsights.com/company/playbypoint); [PodPlay FAQ](https://docs.podplay.app/support-and-troubleshooting/general-faqs)
- **Autonomous / unstaffed venues:** PodPlay Autonomous tier ($500 venue + $350/court) bundles cameras, automated door access and 24/7 remote monitoring — [PodPlay FAQ](https://docs.podplay.app/support-and-troubleshooting/general-faqs)
- **Payments revenue models:**
  - Tiered card-processing margins (PlayByPoint 2.9% + $0.30 down to 2.7% + $0.15) — [PlayByPoint pricing](https://www.playbypoint.com/pricing/)
  - Platform fee on transactions (ClubSpark 0.8%) — [ClubSpark help](https://sportlabs.zendesk.com/hc/en-us/articles/203030535-What-are-the-Costs-of-Clubspark)
  - Marketplace commission plus player service fee (Playtomic) — [cluba.app](https://cluba.app/en/resources/blog/playtomic-fees-for-clubs)
  - Split-payment service fees (MATCHi) — [padelsnipe](https://padelsnipe.com/en/blog/playtomic-alternatives-2026)
  - Player-side premium subscriptions (Playtomic Premium) — [Playtomic help](https://helpmanager.playtomic.com/hc/en-gb/articles/20534670300561-Playtomic-Premium-Plan-for-players)
  - Playtomic transacted €346M in the year to Sept 2025 with €29M net revenue, implying a blended take of roughly 8% of GMV across all revenue lines (my calculation) — [Crowdcube](https://www.crowdcube.com/companies/playtomic/pitches/qrMYkb)
- **Capital influx:** CourtReserve $54M (Mainsail, Oct 2025); Playtomic €65M (Mar 2025) + £4.5M crowdfund (Dec 2025); PodPlay $8M — [Morningstar/Business Wire](https://www.morningstar.com/news/business-wire/20251021345748/courtreserve-secures-a-54-million-growth-investment-from-mainsail-partners-to-accelerate-innovation-in-racquet-paddle-club-software); [Cluster Padel](https://www.clusterpadel.com/en/associate-news/20250319/playtomic-raises-%E2%82%AC65-million-to-strengthen-its-leadership-in-europe-and-accelerate-its-exp.aspx); [The Dink](https://www.thedinkpickleball.com/podplay-raises-8m-to-power-the-future-of-frictionless-pickleball/)

### Inferences
**Likely feature gaps to check in the badminton white-label product, ranked by how universal they are among leaders:**
1. Rules-based court grid: advance windows by membership tier, max bookings per member, cancellation windows, peak/off-peak.
2. Open play/drop-in sessions with caps, skill-range gating, waitlist with auto-notify/auto-promote, and auto-expanding courts.
3. "Open match" social matchmaking from a booking, with a skill range.
4. Membership tiers with member pricing, packages/credits/punch cards, guest fees, family accounts.
5. Lessons/coach scheduling, clinics/programmes, junior camps.
6. Leagues/ladders/tournaments, native or via an integration such as Swish.
7. Rating integration hooks (a generic skill-level field plus pluggable external ratings).
8. Payments: split payments, stored cards, a clear fee model.
9. Branded app/domain (white-label), the leaders' top-tier upsell.
10. Access/light control integrations (Kisi, Brivo, smart-light providers) and kiosk/beacon check-in.
11. POS/pro shop, stringing.
12. Webhooks/API.
13. Reporting: utilisation and revenue per slot.
14. AI extras: churn flags, demand-based pricing suggestions.

**Positioning:** "your brand, your players, no booking commission, branded app included" is the counter-narrative competitors use against both Playtomic (commission, data) and CourtReserve (app fee, tier gating). It suits a white-label badminton offering.

### Gaps
- No independent analyst data on adoption rates of AI or dynamic pricing among clubs. Trend evidence comes mostly from vendor blogs.
- No industry-press articles (Racquet Sports Industry, Pickleball Business, Padel Business Magazine) were retrieved in this session.
- Playtomic's 2026 product announcements (AI features, the reported TIMP acquisition) are unverified.
