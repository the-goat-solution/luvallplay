# Sport-specific operational needs: tennis, pickleball, padel, table tennis (vs badminton), late 2026

Research note scope: what each sport needs operationally from club software, so a badminton-origin product can see what it must add. Vendor profiles are out of scope; vendor pages are cited only as evidence of what clubs expect.

Method caveats (read first):
- Tool budget was about 16 calls. Two key vendor help/marketing domains (intercom.help for CourtReserve help articles, courtreserve.com) were blocked by the session network policy and could not be fetched. Claims about them come from search-result snippets only.
- A lot of the operational material online is vendor marketing (Book&Go, PADO, CourtReserve, Playtomic). It is flagged as such. Uplift percentages from vendors are directional only.
- Participation data is mostly US (SFIA). Federation/compliance data is mostly UK (LTA, Table Tennis England, Badminton England). Global coverage is uneven.

---

## 1. How clubs in each sport operate: booking model, size, membership, revenue

### Takeaway
The sports split into two operating patterns. Padel, and increasingly commercial tennis and pickleball, sell **court-hours** (often priced dynamically and split between players). Badminton and table tennis clubs mostly run **sessions/club nights** for a roster of members, with pay-and-play guests. Pickleball has both a court-hire model and a big **open-play/drop-in** model that needs queue/rotation tooling. A badminton product's session and club-night model carries over well to table tennis and pickleball open play. Selling to padel and commercial tennis venues needs a strong court-hour booking and pricing engine.

### Cited Findings
**Market size and momentum (US, SFIA 2026 Topline, covering calendar 2025)**
- Pickleball: about 24.3M US participants in 2025, up from 4.2M in 2020, adding about 4.5M in one year. The SFIA mid-2026 update showed only +1.3% growth in H1 2026, after five years as the fastest-growing sport — [GCN](https://gcn.com/pickleball-hits-million-players-record-250/20794/); [SFIA mid-year](https://sfia.org/?p=10831); [RecManagement](https://recmanagement.com/articles/155719/participation-hits-new-high-sfias-2026-topline-report-finds)
- Padel: 1.1M US players in 2025, the first year SFIA tracked it separately. It was the fastest-growing activity (+14.5%) in the mid-2026 update — [SFIA mid-year](https://sfia.org/?p=10831); [Youth Sports Business Report](https://youthsportsbusinessreport.com/new-sfia-data-shows-which-sports-are-driving-facility-demand-in-2026/)
- Tennis: 27.3M US players in 2025 (+6.2% YoY) — [SGI Europe](https://www.sgieurope.com/consumer/us-tennis-hits-record-273-million-players/119656.article)
- Table tennis: 15.9M US participants in 2025 (+0.7%) — [Sports Facilities Companies](https://sportsfacilities.com/blog/which-sports-are-driving-facility-demand-in-2026/)
- Global padel: about 5,000 new padel clubs opened worldwide in 2025, for a total above 20,900 clubs and 58,300 courts. This comes from a vendor blog and the underlying source (likely Playtomic's Global Padel Report) was not verified — [Golfmanager](https://golfmanager.com/how-golf-clubs-are-adding-padel-and-other-sports/)
- 58,300 courts across 20,900 clubs works out to about 2.8 courts per padel club on average (calculated from the figures above).

**Padel: commercial court-hour model**
- Padel courts in most US urban markets are priced at about $40–$100 per court-hour, roughly $10–$25 per player when split four ways. This is vendor/blog guidance — [Book&Go / Dojo Business search summary](https://dojobusiness.com/blogs/news/padel-center-set-competitive-profitable-rates)
- Operators treat revenue per court per hour as the core KPI. One operator-facing piece argues that a small club with high utilisation, good lighting and active programming can outperform a larger poorly utilised one — [Golfmanager](https://golfmanager.com/how-golf-clubs-are-adding-padel-and-other-sports/); [Book&Go](https://www.bookandgo.app/en/blog/how-to-increase-court-utilization-rates-by-40)
- If most revenue comes from memberships, dynamic pricing has less upside — [Book&Go](https://bookandgo.app/fr/blog/sports-club-revenue-strategies-dynamic-pricing-memberships-more)
- Golf resorts are adding padel courts to existing venues, which makes multi-sport venues a real buyer segment — [Golfmanager](https://golfmanager.com/how-golf-clubs-are-adding-padel-and-other-sports/)

**Badminton: session/club night, seasonal membership and pay-and-play**
- UK badminton clubs typically sell seasonal membership plus pay-and-play guest sessions. Examples: West Bridgford BC charges £175 adult and £87.50 junior/concession per season, with Badminton England membership not included — [West Bridgford BC](https://sites.google.com/view/westbridgfordbc/membership)
- Markland Hill Racquets Club (a multi-sport club on ClubSpark) charges £3 member / £11 non-member per adult badminton session — [Markland Hill](https://clubspark.lta.org.uk/MarklandHillRacquetsClub/Badminton/Schedule)
- Clubs cap membership because of limited hall court time (Ely BC: applicants may be refused "because of court constraints") — [Ely BC](https://sites.google.com/site/elyvictbad/the-club/membership-fees)
- Some clubs bundle national-body (Badminton England) registration into club fees and others keep it separate. Some require it as a condition of joining — [Swavesey BC](https://sites.google.com/view/swaveseybc/membership); [Falcons BC](https://sites.google.com/view/falconsbc/membership)

**Table tennis: club/league model**
- Table tennis clubs are organised around affiliated leagues and clubs. USATT runs sanctioned tournaments and a separate league rating system. Some US leagues use the USATT League Rating System, where points are exchanged based on the rating spread — [USATT ratings guide](https://usatt.simplycompete.com/info/ratings); [Charlotte TT Club](https://charlottetabletennisclub.wildapricot.org/ratings)
- In England, local leagues commonly run on the TableTennis365 platform. Several search hits were league sites hosted there — [TableTennis365 Newton Abbot](https://tabletennis365.com/NewtonAbbot/MediaLibrary/Download/4XcgC5JODUWtMzwbshn6-Q/66375)

**Pickleball: court hire, open play and leagues**
- Open play (drop-in, rotating partners) is a core format. Clubs run it with paddle stacks/racks or with apps — [Selkirk](https://www.selkirk.com/blogs/pickleball-education/pickleball-etiquette-how-the-paddle-rack-system-works-during-open-play); [Bounce](https://www.bounce.game/blog/open-play-pickleball)

### Inferences
- **Badminton product strengths that transfer:** club nights/sessions, seasonal membership, pay-and-play, and capacity caps map almost one-to-one onto table tennis club nights and pickleball open play.
- **Biggest structural gap for padel and commercial tennis/pickleball:** a court-grid booking engine sold by the hour, with member vs non-member rates, peak/off-peak pricing, booking windows and per-player payment. The product cannot sell to padel venues without this.
- Typical court counts: padel averages about 3 courts per club (calculated above). No reliable sourced figures were found for tennis, pickleball or table tennis. From general industry knowledge (unverified here), tennis clubs commonly have 4–12 courts, commercial pickleball venues 8–20+, and table tennis clubs 4–12 tables. The writer should treat these as unverified.
- Revenue mix: padel leans on court hire, coaching and open matches. Tennis and pickleball add leagues, clinics, ball-machine hire and pro shop. Badminton and table tennis lean on membership/session fees and league entry. The F&B and pro-shop share was not found in sources (see Gaps).

### Gaps
- No sourced typical court/table counts for tennis, pickleball or table tennis clubs, and no global revenue-mix breakdowns by sport (F&B %, pro shop %, coaching %). Market reports such as Playtomic's Global Padel Report and SFIA facility reports are paywalled or were not fetched.
- No national Badminton England membership/affiliated-club totals were found.
- No sourced data on table-hire/robot-hire norms at table tennis clubs.

---

## 2. Sport-specific requirements: scoring, ratings and APIs, partner matching, courts, weather, hardware, equipment, coaching

### Takeaway
Ratings integration is the clearest sport-specific table-stakes item. Pickleball clubs expect **DUPR**, padel clubs expect **Playtomic levels** (if on Playtomic) or **WPR** (Americas), tennis clubs increasingly expect **UTR**, and table tennis uses **USATT/Ratings Central** or national league ratings. Each rating has a different scale and access model: DUPR uses a club API key, UTR uses a partner OAuth API by application, and WPR is integrated by CourtReserve and Playbypoint. Outdoor sports (tennis, pickleball, outdoor padel) also need weather/rain-out workflows, and unstaffed venues need door-access integration (Brivo is the documented one).

### Cited Findings
**Pickleball: DUPR**
- DUPR offers a free club programme (a club module with member roster, club leaderboard, and the ability to submit club members' matches to DUPR) — [DUPR club resources](https://www.dupr.com/club-resources)
- In CourtReserve, clubs enable DUPR under Settings → Additional Features and enter a club-specific **DUPR API key** to sync — [CourtReserve integrations overview (search snippet; page not fetchable)](https://intercom.help/courtreserve/en/articles/12091300-overview-courtreserve-integrations); [DUPR–CourtReserve partnership](https://www.dupr.com/post/courtreserve-transforms-pickleball-experience-with-strategic-dupr-partnership)
- Integrations announced in 2026 show the expected feature set: rating pull for seeding/format setup, score upload after each event, automatic rating updates (Good Game Sports, June 2026); DUPR-rated open play with simplified result reporting (PickleQ, August 2026); rating-gated open play and tournaments, result submission and club leaderboards (TeamReach, July 2026). Playtomic also partnered with DUPR — [Good Game Sports](https://www.dupr.com/post/dupr-partners-with-good-game-sports-to-power-club-play); [PickleQ](https://www.dupr.com/post/pickleq-streamlines-open-play-and-dupr-match-reporting); [TeamReach](https://www.dupr.com/post/dupr-and-teamreach-announce-strategic-partnership-to-power-player-ratings-and-engagement-across-one-of-pickleballs-largest-communities); [Playtomic–DUPR](https://www.dupr.com/post/playtomic-partners-with-dupr-to-power-the-next-era-of-community-driven-pickleball)
- DUPR has a Club Partnership Agreement governing club use — [DUPR Club Partnership Agreement](https://www.dupr.com/club-partnership-agreement)
- No public DUPR developer API reference was found. Endpoints, auth and terms need direct confirmation with DUPR.

**Tennis (and pickleball): UTR**
- UTR Sports launched the **Engage API** in February 2025 so partner apps can sync player profiles and ratings. Access is by application, with OAuth client ID/secret issued by UTR Sports. Launch partners were Match Tennis, PicklePlay, Live Pickleball and Playtime Scheduler, with Sofascore and Double Match Point added later — [UTR Engage API](https://www.utrsports.net/pages/engage-api); [UTR press: new partners](https://www.utrsports.net/blogs/press/utr-sports-expands-its-ecosystem-with-new-api-integration-partners); [Engage API launch release](https://business.mammothtimes.com/mammothtimes/article/gnwcq-2025-2-20-utr-sports-launches-engage-api-to-enable-seamless-data-sharing-for-players-across-partner-apps)
- UTR has unverified (questionnaire-based) and **verified** ratings. Verified ratings use only results from verified third-party event providers/tournament directors. So club match results only count toward verified ratings if the club software is a recognised results provider — [UTR Engage API](https://www.utrsports.net/pages/engage-api)
- UTR Sports also sells its own tennis/pickleball club software and is the "Official Club Software and Rating System of the USPTA", which makes it a competitor as well as a rating source — [UTR clubs](https://www.utrsports.net/pages/clubs)
- The PyPI/GitHub "utr" libraries are unofficial. One release was yanked — [PyPI utr](https://pypi.org/project/utr/1.1.0/)

**Padel: Playtomic levels, WPR, FIP**
- Playtomic levels run 0–7. Players start from a questionnaire. Level changes weigh the levels of all four players, team combined level and a reliability factor that grows with play — [Playtomic level system](https://playerhelp.playtomic.com/hc/en-gb/articles/43310980754193-How-the-Playtomic-level-system-works)
- World Padel Rating (WPR) launched in December 2022 (formerly RedPADEL Rating) and uses a 0–21 scale. It is the official rating of the USPA (partnership July 2024) and the Canadian Padel Association. CourtReserve integrates WPR, and Playbypoint partnered with WPR in June 2025 — [Padelbrowser](https://www.padelbrowser.com/blog/padel-ratings-uspa-fip-wpr-nprp); [USPA–WPR](https://padelusa.org/united-states-padel-association-and-world-padel-rating-announce-partnership/); [CourtReserve WPR integration](https://courtreserve.com/?p=23623); [WPR–Playbypoint](https://rcnamericaflorida.blogspot.com/2025/06/world-padel-rating-wpr-and-playbypoint.html)
- The FIP ranking is a pro ranking (best 22 results over a rolling 52 weeks across Premier Padel/FIP Tour), not a club-level rating. US seeding hierarchy: FIP ranking, then USPA national ranking, then WPR — [Padelbrowser](https://www.padelbrowser.com/blog/padel-ratings-uspa-fip-wpr-nprp)

**Table tennis: USATT / Ratings Central**
- USATT ratings are used for sanctioned tournaments and leagues — [USATT ratings guide](https://usatt.simplycompete.com/info/ratings); [USATT ranking explained](https://usatt.org/ranking-system-explained)
- Ratings Central is a separate system that clubs, leagues and tournaments can join. Its scale is not convertible to USATT's, and it says USATT ratings inflate and vary regionally — [Ratings Central scale](https://www.ratingscentral.com/RatingScale.php); [Ratings Central](https://www.ratingscentral.com/)

**Doubles/partner matching**
- Playtomic automatically creates "open matches" in every open slot, enabled per sport (padel/tennis) and court type. Players need a level to join. Results move levels if at least one player per team has a level — [Playtomic Manager: open matches](https://helpmanager.playtomic.com/hc/en-gb/articles/20535035123473-How-to-configure-Open-Matches-at-your-Club)
- TeamReach/DUPR: rating-band-gated open play — [TeamReach](https://www.dupr.com/post/dupr-and-teamreach-announce-strategic-partnership-to-power-player-ratings-and-engagement-across-one-of-pickleballs-largest-communities)

**Weather / rain-out (outdoor tennis, pickleball, padel)**
- Club policies vary and are encoded in booking terms. Examples: an automatic refund only if cancelled online at least 1 hour before; non-member refund only if cancelled at least 6 hours before; for rain, the customer must cancel more than 2 hours before or still pay; rain bookings transferable to another slot, with a $5 fee for a refund instead — [Tennis Australia club (Hamilton Park) wet weather](https://play.tennis.com.au/hamiltonparktennisclub/Booking/WetWeather); [North Park TC refund policy](https://play.tennis.com.au/NorthParkTennisClub/Booking/RefundPolicy); [Camden Active terms](https://camdenactive.camden.gov.uk/terms); [Hamilton Park terms of hire](https://play.tennis.com.au/hamiltonparktennisclub/Termsofhire)
- Light rain is often not grounds for cancellation ("courts dry quite quickly"). Coaching continues in light rain and the lead coach cancels for heavy rain or unsafe conditions — [Hamilton Park wet weather](https://play.tennis.com.au/hamiltonparktennisclub/Booking/WetWeather); [Sheen Common coaching weather policy](https://clubspark.lta.org.uk/SheenCommon/Coaching/WeatherPolicy)
- Padel example: weather cancellation is at management's discretion, with players notified 1 hour before via the Playtomic app or phone — [search summary of club policies](https://parksports.co.uk/faqs/category/cancellations-refunds-credits)
- Park Sports (UK public tennis operator) has a published FAQ on credits/refunds when unsure if a booking or coaching session will go ahead — [Park Sports](https://parksports.co.uk/faqs/category/cancellations-refunds-credits)

**Door access / unstaffed venues**
- CourtReserve's official **Brivo** integration grants access only during valid reservations or registered events, with a static PIN per player. It costs $25/month on lower plans (included on Scale/Enterprise), plus Brivo's own API subscription and lock hardware. It needs a Brivo account and API key — [CourtReserve Brivo help (snippet)](https://help.courtreserve.com/en/articles/10126640-brivo-integration-access-control); [Introducing Brivo for CourtReserve](https://courtreserve.com/?p=10060)
- CourtReserve also markets code-free guest entry for public bookings — [CourtReserve access control for public booking](https://courtreserve.com/?p=23153)
- **Kisi**: a CourtReserve user requested a Kisi integration on CourtReserve's feedback board, so it was not shipped at the time of the post. Kisi itself lists integrations with PodPlay, Playbypoint and AllBooked (Skedda) — [CourtReserve feedback](https://feedback.courtreserve.com/communities/1/topics/2867-kisi-access-control-integration); [Kisi blog](https://www.getkisi.com/blog/racket-ball-software)

### Inferences
- **Ratings: table-stakes by sport.** Pickleball means DUPR (read rating and submit results), effectively mandatory for US/Asia-Pacific pickleball clubs given how many 2026 partner announcements there were. Padel needs a native level system or WPR (Americas). In Europe, Playtomic levels dominate but are tied to Playtomic's own platform, and no public Playtomic ratings API was found. Tennis UTR is a strong differentiator in the US (Engage API, by application) but less central at UK/European recreational clubs. Table tennis rating integration is low priority: ratings are federation/league-run and often not API-exposed.
- **Scoring formats a multi-sport product must model** (from general sport knowledge, not verified in this session): tennis sets/games with tiebreaks and match tiebreaks; padel uses tennis scoring, including the "golden point"/star point variants; pickleball plays to 11 (or 15/21) win-by-2 with side-out or rally scoring; table tennis is best of 3/5/7 games to 11; badminton is rally scoring to 21, best of 3. Result entry must support these structures, especially for rating submission.
- **Weather handling** is a gap for an indoor-origin badminton product. It needs bulk cancel/credit for a court or time range, configurable rain policies (credit vs refund vs transfer, cut-off hours, fees), coach-initiated session cancellation, and push/SMS notification. Weather API–driven alerts would be a differentiator.
- **Door access** matters for 24/7 unstaffed padel/pickleball venues. Brivo is the proven pattern (reservation-window PINs). Kisi, Igloohome and smart-lighting controllers were not confirmed in sources (see Gaps).
- **Equipment rental** (padel rackets/balls, pickleball paddles, tennis ball machines) can be modelled as booking add-ons. No sources were found quantifying demand.

### Gaps
- Smart court-lighting controller integrations (named in the brief as integrated by CourtReserve/Playtomic) were not confirmed. Searches returned nothing, and courtreserve.com/intercom.help were blocked by the network policy.
- Igloohome integration evidence was not found.
- No public developer documentation was found for the DUPR API, a Playtomic levels API or a WPR API. Access appears to be partnership-based.
- No ITTF or BWF club-level rating API was found. ITTF/BWF world rankings are for elite players. Club-level ratings are national/league systems (USATT, Ratings Central, TT England league averages, Badminton England grading), not verified here.
- No sourced data on ball-machine rental pricing/usage or coaching package structures.

---

## 3. Padel-specific: high-utilisation commercial venues, dynamic pricing, 4-player matchmaking, split payment

### Takeaway
Padel venues are commercial, high-utilisation businesses. Three features are table-stakes: dynamic/peak pricing; **open matches** where single players fill the fourth slot, gated by level; and **per-player split payment at booking**, prepaid online. Playtomic has set player expectations: open matches are about 20% of bookings it manages.

### Cited Findings
- Common pricing is demand-based by time of day and day of week. Examples include off-peak discounts for bookings within 12 hours and a small surge for last-minute prime time. Vendor guidance warns that perceived fairness and transparency are critical — [Book&Go dynamic pricing](https://www.bookandgo.app/es/blog/dynamic-pricing-for-sports-courts-implementation-guide); [Book&Go strategies](https://www.bookandgo.app/pt/blog/dynamic-pricing-strategies-sports-courts)
- Vendor claims of a 15–30% revenue-per-court-hour uplift within 90 days are unsourced marketing — [Book&Go](https://www.bookandgo.app/en/blog/how-to-increase-court-utilization-rates-by-40)
- Playtomic: players can pay the full court fee or split it. Open matches must be paid online (app or Club Wallet), with no pay-at-club option — [Playtomic help: match model](https://help.playtomic.com/en/articles/5713889-a-general-overview-the-match-model); [Playtomic legal conditions](https://playtomic.com/legal-conditions)
- Playtomic's Pablo Carro: open matches are "almost 20%" of total monthly bookings managed on Playtomic — [Padel Smash Academy podcast](https://share.transistor.fm/s/d3433ec5)
- Clubs can also create open matches manually from Playtomic Manager — [Playtomic Manager help](https://helpmanager.playtomic.com/hc/en-gb/articles/48305440234129-How-to-create-an-open-match-from-Playtomic-Manager)
- PADO markets automatic payment splitting between 2 or 4 participants as a club feature — [PADO for clubs](https://pado.app/for-club)
- A padel bookkeeping guide (July 2026) highlights court utilisation and deferred revenue (prepaid packs/memberships) as finance concerns — [Beancount padel bookkeeping](https://beancount.io/blog/2026/07/16/padel-club-bookkeeping-court-utilization-deferred-revenue-guide)
- Padel clubs typically run 90-minute slots. This comes from general industry knowledge and was not verified in this session.

### Inferences
- **Padel table-stakes:** court-grid booking with 60/90-minute slots; peak/off-peak/member pricing; per-player split payment with each player's share charged at booking (and release of the slot if unpaid); open-match creation with level bands; 4-player match result entry feeding a level system; marketplace/discoverability for non-members; equipment rental add-ons; wallet/credit packs.
- **Padel differentiators:** automated demand-based pricing, auto-generated open matches in empty slots, waitlist/last-minute fill notifications, cross-club player networks, WPR integration in the Americas, and access control for unstaffed opening hours.
- Against Playtomic's consumer network, a badminton-origin product would compete on club-owned data and lower fees rather than player liquidity.

### Gaps
- No independent (non-vendor) data on the actual revenue impact of dynamic pricing or split payment.
- No sourced data on padel slot length norms or no-show/late-cancel penalty norms (likely common but unverified).

---

## 4. Pickleball-specific: open play rotation, growth, community vs commercial, DUPR

### Takeaway
Pickleball's distinctive operational problem is running fair, fast **open play** for many drop-in players across a few courts. The analogue paddle stack/rack is being digitised. DUPR integration for rating-gated sessions and result submission is now expected. Growth slowed sharply in H1 2026 (+1.3%), which is likely to raise competition among commercial venues and their focus on retention and engagement tooling.

### Cited Findings
- Paddle stacking protocols are "not universal": facilities run rotation differently — [Selkirk](https://asia.selkirk.com/blogs/education/pickleball-etiquette-how-does-paddle-stacking-work)
- Common rules: the next group of (typically four) paddles takes the next open court. Players who step away remove their paddle and rejoin at the back. Some sessions use winners-stay/challenge court — [TeamSideline paddle stacking rules](https://teamsideline.com/sites/apex/content/36932/Pickleball-Paddle-Stacking-Rules); [The Dink](https://www.thedinkpickleball.com/the-best-paddle-queuing-and-rotation-methods-for-open-play-pickleball/); [Selkirk paddle rack](https://www.selkirk.com/blogs/pickleball-education/pickleball-etiquette-how-the-paddle-rack-system-works-during-open-play)
- Digital queue tools now exist. PickleQ positions itself as managing the whole open-play experience plus DUPR reporting. PaddleStack is a free iPad session manager. Pickleheads offers round-robin tools and DUPR club linking — [PickleQ](https://www.dupr.com/post/pickleq-streamlines-open-play-and-dupr-match-reporting); [PaddleStack App Store](https://apps.apple.com/app/id6759310557); [Pickleheads open play](https://www.pickleheads.com/blog/organize-pickleball-open-play); [Pickleheads DUPR club link](https://www.pickleheads.com/blog/link-dupr-club)
- Growth: from 4.2M (2020) to 24.3M (2025) US players, then +1.3% in H1 2026 — [GCN](https://gcn.com/pickleball-hits-million-players-record-250/20794/); [SFIA mid-year](https://sfia.org/?p=10831)
- DUPR adoption by platforms in 2026 spans club software, open-play apps, tournament tools and community apps (CourtReserve, Playtomic, Good Game Sports, PickleQ, PICKCR in Latin America, TeamReach, CourtsApp) — [DUPR–PICKCR](https://www.dupr.com/post/dupr-and-pickcr-announce-strategic-technology-partnership-to-power-pickleballs-growth-across-latin-america); [CourtsApp–DUPR](https://thekitchenpickle.com/blogs/news/courtsapp-dupr-partnership-verified-pickleball-matches/)
- UTR also rates pickleball (UTR-P) and its Engage API has pickleball partners (PicklePlay, Live Pickleball) — [UTR press](https://www.utrsports.net/blogs/press/utr-sports-expands-its-ecosystem-with-new-api-integration-partners)

### Inferences
- **Pickleball table-stakes:** open-play sessions with check-in, a digital queue that mimics the paddle stack (configurable: 4-on/4-off, winners-stay, skill-banded courts), DUPR-gated registration, DUPR result upload, round robins/ladders/leagues, and court hire.
- **Differentiators:** fairness algorithms (balancing games played and avoiding repeat partners), court-side kiosk/TV display, auto result capture to DUPR, and member engagement for retention as growth plateaus.
- **Strong fit for a badminton-origin product:** badminton club nights face the same "who plays next on which court" rotation problem. An existing badminton queue/rotation feature is directly reusable for pickleball and is a credible wedge.
- **Community vs commercial:** community/parks and rec venues need low-cost drop-in, volunteer-run sessions and shared-court scheduling with tennis (line conflicts). Commercial indoor venues need court hire, memberships, door access and F&B/pro-shop POS. This is inferred; no sourced segmentation data was found.

### Gaps
- No sourced figures on the split between community/municipal and commercial pickleball venues, or on DUPR's registered-user or club count in 2026.
- Pickleball Australia, Pickleball NZ and USA Pickleball club-affiliation/reporting requirements were not researched within budget.

---

## 5. What sport federations expect clubs to report or maintain

### Takeaway
UK federations (LTA for tennis/padel, Table Tennis England, Badminton England) make affiliation/registration conditional on safeguarding standards: a named trained Welfare Officer, criminal record checks, policies and codes of conduct, an annual risk assessment, and (for tennis) accredited coaches. They expect clubs to keep these current and notify changes. Club software that tracks officer roles, check expiry dates, coach accreditation and affiliation status would ease annual renewal.

### Cited Findings
- **LTA venue registration** (tennis, and padel at LTA venues) is renewed annually. Clubs must have a trained, active Welfare Officer, with a satisfactory criminal record check (DBS/PVG) through the LTA. The LTA must be notified within 28 days if a Welfare Officer leaves. An annual risk assessment of the venue and facilities is required, plus criminal record checks for specified roles — [LTA venue safeguarding standards](https://www.lta.org.uk/about-us/safeguarding/venue-standards/); [LTA Venue Registration Regulations 2024–25](https://www.lta.org.uk/4a7af4/siteassets/roles/venues/file/lta-venue-registration-regulations-2024-2025.pdf)
- One LTA club page lists six standards to meet: safeguarding policy, diversity and inclusion, Welfare Officer, criminal record checks, risk assessment, and coaching safeguarding — [Bridge Tennis Club](https://clubspark.lta.org.uk/BridgeTennisClub/Events/Safeguarding)
- **LTA coach accreditation:** venues must build LTA Coach Accreditation into coach recruitment. Sources conflict on the threshold. The governance guide says Level 3+, while the venue standards page and safeguarding-training page say Level 2+ since Autumn 2022, including overseas/external qualifications — [LTA club governance guide](https://www.lta.org.uk/siteassets/roles/venues/file/club-governance-guide-a4-digital.pdf); [LTA coaching standards](https://www.lta.org.uk/about-us/safeguarding/coaches/coaching-standards); [LTA safeguarding training](https://www.lta.org.uk/roles-and-venues/coaches/development/safeguarding-training/)
- **Table Tennis England:** affiliated clubs/leagues must adopt TTE's Safeguarding Policy and a Code of Conduct, and should have a named Club Welfare Officer. DBS checks are required for regulated activity with under-18s/adults at risk. Incidents are reported to the club welfare officer and TTE safeguarding team. Free safeguarding e-learning is available — [TTE safeguarding guidelines](https://www.tabletennisengland.co.uk/content/uploads/2022/02/2.-Safeguarding-Guidelines-Dec-2020.js.pdf); [TTE policies](https://www.tabletennisengland.co.uk/?p=173)
- **Badminton (Scotland/Wales/England):** national bodies run club affiliation, and individual player membership is often a condition of club membership — [Badminton Scotland club affiliation](https://badmintonscotland.org.uk/club-affiliation); [Badminton Wales club affiliations](https://badminton.wales/clubaffiliations/); [Falcons BC](https://sites.google.com/view/falconsbc/membership)
- **US padel:** the USPA is building a white-label platform with Tournated and WPR for sanctioning/ratings, so federation-linked systems may become the reporting channel — [Primetime Padel](https://primetimepadel.beehiiv.com/p/primetime-padel-update-uspa-joins-forces-with-tournated-to-modernize-american-padel)
- In the UK, the LTA's own club platform (ClubSpark) hosts many tennis club sites, as shown by the many clubspark.lta.org.uk policy pages in results — [e.g. Sheen Common](https://clubspark.lta.org.uk/SheenCommon/Coaching/WeatherPolicy)

### Inferences
- **Federation-compliance table-stakes (UK):** store club roles (Welfare Officer, deputy) with training and DBS dates and expiry alerts; maintain a coach register with accreditation status/expiry; host policy documents and codes of conduct with member acknowledgment; record annual risk assessments; and record national-body membership IDs per player.
- **Differentiators:** direct sync of affiliation numbers with national body systems (e.g. Badminton England, TTE, LTA), automated affiliation renewal checklists, and exports for annual returns.
- In the UK the LTA's ClubSpark is the incumbent for tennis. A badminton-origin product selling to UK tennis clubs would compete with a federation-provided tool.

### Gaps
- No primary source on what affiliation numbers or membership counts clubs must submit annually to each federation (fields, deadlines). USA Pickleball, Tennis Australia, Pickleball Australia, USATT club-affiliation reporting and Badminton England club affiliation requirements were not reached within budget.
- No information on any federation API for submitting member counts or verifying coach accreditation.

---

## 6. Compliance and safety features: waivers, minors/guardians, safeguarding, incidents, accessibility

### Takeaway
Safeguarding (UK/Commonwealth framing) and liability waivers (US framing) are both table-stakes. The specific workflows come mostly from federation safeguarding standards. Little sport-specific accessibility guidance was found.

### Cited Findings
- Federations require named welfare officers, DBS-checked staff and volunteers working with under-18s, codes of conduct, and an incident reporting route to the welfare officer and national safeguarding team — [TTE safeguarding guidelines](https://www.tabletennisengland.co.uk/content/uploads/2022/02/2.-Safeguarding-Guidelines-Dec-2020.js.pdf); [LTA venue standards](https://www.lta.org.uk/about-us/safeguarding/venue-standards/)
- Club safeguarding statements and policies are published on club booking sites (e.g. a TT club on OpenResa, LTA clubs on ClubSpark), so policy publishing inside the platform is an established pattern — [Bournemouth Sports TT Club](https://openresa.com/club/Bmthsportstt/pages/bournemouth-sports-table-tennis-club-safeguarding-statement); [Elham Sports Club](https://clubspark.lta.org.uk/ElhamSportsClub/AboutUs/Safeguarding)
- Booking terms (cancellation, weather, refunds) are commonly embedded in booking flows and need acceptance at checkout — [Hamilton Park terms of hire](https://play.tennis.com.au/hamiltonparktennisclub/Termsofhire); [Camden Active terms](https://camdenactive.camden.gov.uk/terms)

### Inferences
- **Table-stakes:** digital waivers with versioning and e-signature (especially US pickleball/padel, where players visit unstaffed or as guests); junior profiles linked to guardian accounts, with guardian consent, medical/emergency contact and photo consent; incident/accident report forms routed to the welfare officer; staff/coach/volunteer check-expiry tracking; terms acceptance at checkout.
- **Differentiators:** safeguarding case logs with restricted access, automated alerts when a coach's DBS/accreditation lapses, blocking expired coaches from being scheduled, and accessibility attributes on courts (wheelchair tennis/para table tennis/para badminton suitability, step-free access) shown in booking.
- US waivers and UK safeguarding are different legal regimes. A global product needs both.

### Gaps
- No sources were found on US-specific waiver legal expectations for racquet clubs, on incident-report formats expected by insurers, or on accessibility features expected by federations (e.g. wheelchair tennis or para table tennis requirements for club booking systems).
- GDPR/children's-data requirements for storing junior information were not researched.
