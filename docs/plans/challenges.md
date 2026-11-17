# Plan: Pair challenges, tiers & crowns

Status: **draft for discussion**. Nothing built yet. Items marked **(proposed)** are recommendations waiting on a decision; the open questions are in §11.

**Decided (17 Nov):**
- challenges can be played **anywhere, anytime**; they aren't tied to club play days;
- tiers use the **hybrid**: season **points** (2 per win, 0 per loss) order the leaderboard, a **skill rating** decides the tier;
- a challenge is **one game to 21** (BWF scoring: win by 2, golden point at 29–29);
- **any account holder** can team up and play (members and casual players).

---

## 1. Summary

Players team up into **pairs** by scanning each other's QR code. A pair can put itself **up for challenge**; another pair accepts on the website. When the two pairs meet at the court, one player from each pair scans the other's QR code to **confirm the challenge is on**. After the game they **log the score**, the other pair **confirms it**, and the winners get **2 points** (losers 0). Both pairs are then asked whether to **keep the pairing** and whether to **go back up for challenge**.

On top of that, the leaderboard gets a **Challenges** board with **tiers** (Bronze → Silver → Gold → Platinum → Diamond) and **crowns**, designed so that showing up and playing different people is rewarded as much as winning.

| Piece | What players see |
|---|---|
| **Pairs** | "Team up" on the Player tab: show my QR / scan theirs. One current partner; pair record (W–L, games together). |
| **Challenge board** | `/challenges`: pairs that are up for a game, with when and where, and a "good match" hint. "Put us up" / "Accept". |
| **Check-in** | At the court: one player shows a QR, one opponent scans it. The match is then live. |
| **Score** | Either pair enters the score; the other pair confirms. Disputes go to the admins. |
| **After the game** | "Keep playing together?" and "Up for another challenge?" for both pairs. |
| **Leaderboard** | New **Challenges** tab: points by month/quarter/year/all time, tier badges, crowns. |

Expected running cost: **$0/month** (same stack; QR codes are generated and scanned on the device).

---

## 2. What other platforms do (research)

| Platform | Mechanic | What we take from it |
|---|---|---|
| **Club challenge ladders** (tennis/badminton, Skedge) | Challenge only within a range (±2 positions is the common default); winner takes the place; **no-response forfeit**; **one open challenge per player** | Challenges must expire if not played; limit open challenges per pair so nobody hoards them. Open challenges (any pair can accept) suit our brief better than a strict ladder. |
| **Playtomic** (padel open matches) | Every match is **friendly** or **competitive**; only competitive changes your level. Level is team-based (combined level of each team) and moves more while your **reliability** is low. | Offer a **friendly** challenge that doesn't count, so beginners and new pairs can play without pressure. Rate individuals, compare **team averages**, move new players faster. |
| **DUPR** (pickleball ratings) | Self-reported results stay **"pending"** and don't affect ratings until the opponents **validate** them. | Score is entered by one pair and **confirmed by the other** before points count. |
| **Reclub** (the court board is already modelled on its open-play generator) | Doubles ladders with **fixed partners**; events gated by rating and reliability. | Fixed pairs for the duration of a challenge; tier can be used for "good match" hints rather than hard gates. |
| **Strava Local Legend** | A crown for the person who did a segment **the most times in 90 days**, not the fastest. Rolling window, so it has to be defended. | A participation crown ("Pack Leader") so the most engaged player is celebrated, not just the strongest. |
| **Strava KOM / king-of-the-hill** | A single holder; beat them to take it. | A **Crown pair** that passes to whoever beats them in a challenge. Gives the board a focal point every play day. |
| **Duolingo leagues** | Small groups, weekly promotion and demotion zones. Analysts credit demotion with driving return visits; critics note it pushes grinding easy wins. | Seasons with soft resets, but **no mid-season demotion** (a community club should feel safe, not anxious). |
| **League of Legends ranked** | Tiers Iron→Diamond split into divisions; **demotion protection** after a promotion; decay only at the very top. | Familiar tier names; a tier you reach is kept for the rest of the season. |
| **Chess.com / Lichess** | Fair-play systems watch for **rating manipulation**: farming the same opponent, sandbagging. | Cap how often the same two pairs can score points off each other; admins can void a result. |
| **Elo vs Glicko-2 for small clubs** | Club ladders often pick Glicko-2 because people play rarely; doubles is usually handled by **averaging partners**. | Elo with a larger K for the first matches (simple to explain), team = average of partners. Glicko-2 is an option later. |

Technical findings:
- **QR scanning on iPhone:** Safari still doesn't enable the `BarcodeDetector` API, so the in-app scanner needs a small JS/WASM decoder (jsQR or ZXing) loaded only when the scanner opens. `Permissions-Policy` already allows `camera=(self)` (used by photo upload).
- **Notifications:** Resend's free tier is 100 emails/day, too few for per-challenge emails. **Web Push** is free and works on iPhone **only for Home Screen web apps** (iOS 16.4+), which the profile already is, with an install guide. Android/desktop work in the browser.

---

## 3. Recommended design

### 3.1 Pairs (teaming up)

- **Who:** any signed-in player, member or not (decided).
- **How:**
  1. Player A taps **Team up → Show my code**. A QR code appears, valid for **2 minutes** and refreshing every 60 seconds, plus a 6-character code for typing if a camera won't cooperate.
  2. Player B taps **Team up → Scan**, scans it (in-app scanner), sees "Team up with Hòa?" and confirms.
  3. Both phones update within a few seconds: "You're paired with Hòa."
- The QR holds a link (`/q/<token>`), so a phone's own camera app also works: it opens the site, which signs in if needed and then shows the same confirmation.
- **One current partner per player (proposed).** Forming a new pair ends the old one (after a confirmation). Past pairs and their record are kept.
- **Unpair** any time, except while a challenge is accepted or live.
- Tokens are random, stored hashed, single-use and short-lived (same approach as sign-in codes).

### 3.2 Challenge lifecycle

```
open ──accept──▶ accepted ──QR check-in──▶ live ──score entered──▶ awaiting confirmation ──confirm──▶ completed
  │                  │                                                      │
  └─expire/cancel    └─expire/cancel (no check-in by the end of the window) └─dispute ──▶ admin decides
                                                                            └─no reply in 24 h ──▶ auto-confirmed
```

- **Put us up:** either partner posts the pair as available with:
  - **When:** a window, e.g. "Sat 22 Nov, 2–5 pm" or "any evening this week" (at most 7 days ahead, proposed);
  - **Where:** pick a venue from a short club-managed list (Admin → Challenges) or type one; "we'll sort it out" is allowed;
  - optional note ("happy to play anyone", "we bring shuttles");
  - **Competitive / Friendly** (proposed; friendly never earns points or moves ratings).
- **One open challenge per pair**, expiring at the end of its window (proposed).
- **Accept:** any partner of another pair can accept the stated time and place. The board shows a **"good match"** hint when the two pairs' average ratings are close, but doesn't block anyone.
- **Sorting out the details:** because games can be anywhere, the two pairs need a way to talk once accepted. See Q15: a short in-app challenge chat, or opting in to share a phone number.
- **Check-in:** either player of the accepting pair shows the challenge QR; either player of the posting pair scans it. The server checks the scanner is in the *other* pair. With games away from the club this is the **only** proof the pairs actually met, so it's required for every challenge, competitive or friendly. No GPS.
- **Score:** either pair enters it, **no sooner than 8 minutes after check-in and no later than 24 hours after**. The other pair gets "Confirm 21–17?" with Confirm / That's not right. Points count only once confirmed. If nobody answers within 24 hours it auto-confirms (proposed). "That's not right" sends it to **Admin → Challenges** with both versions.
- **Valid scores** (one game to 21, BWF): the winner has 21 and the loser 19 or less; or the winner has 22–29 and leads by exactly 2; or the winner has 30 and the loser 28 or 29. A **"Retired / couldn't finish"** option voids the game without points.
- **After the game** (both pairs, at the same time):
  - "Keep playing together?" **Yes** keeps the pair; **No** ends it.
  - "Up for another challenge?" **Yes** puts the pair straight back on the board (only if they kept the pair).
  - A **Rematch** button offers the same two pairs another game (friendly by default once the points cap below is hit).

### 3.3 Points

- **2 points per win, 0 per loss**, credited **to each player** (pairs change; players are the constant). Pair records are kept too and shown on the pair card.
- Ties broken by point difference, the same as the round robin board.
- **Anti-farming (proposed):** the same two pairs (or the same four players in any split) can earn points off each other **at most once per day and three times per 30 days**. Extra games still count as friendly games in each player's history.
- **Daily cap (proposed):** a player earns points from at most **4 competitive challenges a day**, so one marathon session can't decide a season.
- Admins can **void** a result from Admin → Challenges (reason recorded, players notified).

### 3.4 Skill rating (drives tiers and "good match"; proposed)

- **Elo, per player.** Everyone starts at 1000. Team rating = average of the two partners. Expected = 1 / (1 + 10^((opponents − us) / 400)).
- **K = 40 for a player's first 10 competitive matches, then 20**, so new players settle quickly (Playtomic's "reliability" idea in its simplest form).
- No margin-of-victory bonus at first (keeps it explainable; can be added later).
- The number itself is shown only to the player; everyone else sees the tier. Players are "Unranked · 3 of 5 placement games" until they've played **5 competitive matches**.
- Admins can set a **starting tier** for a player before their first match (the club already tiers players for the court board and mini game), which avoids a strong player flattening newcomers while they climb out of Bronze.

### 3.5 Tiers

| Tier | Badge |
|---|---|
| **Diamond** | top |
| **Platinum** | |
| **Gold** | |
| **Silver** | |
| **Bronze** | start |

- **Seasons** = calendar quarters (the leaderboard already has quarter periods).
- **Hybrid (decided):** *points* decide the leaderboard order (rewards playing), *rating* decides the tier (reflects skill, so you can't climb tiers just by playing a lot against weaker pairs).
- **No demotion during a season:** a tier, once reached, is kept until the season ends (League of Legends' promotion shield, applied for the whole season).
- **Soft reset at season end:** everyone drops at most one tier, and keeps a permanent "Season 1 · Gold" badge on their profile.
- Boundaries are set from the first few weeks of real ratings (with ~40 active players, fixed thresholds picked in advance would likely put everyone in Silver/Gold). Roughly: Diamond top 10%, Platinum next 20%, Gold next 30%, Silver next 25%, Bronze the rest, then frozen as rating thresholds for the season.

### 3.6 Crowns

| Crown | Who holds it | Why |
|---|---|---|
| **👑 Crown pair** | The pair that most recently beat the Crown pair in a competitive challenge. Starts with the top pair after the first play day. | Gives every play day a headline match. |
| **🐺 Pack Leader** | Most competitive challenges played in the last 90 days (rolling, like Strava's Local Legend). | Celebrates showing up, not just winning. |
| **🏆 Season champion** | #1 on the quarter's Challenges board at season end. Permanent trophy. | The traditional prize. |

- Crown rules that keep it healthy (proposed): the Crown pair must play at least one competitive challenge against a pair in the same or one tier lower **every 14 days**, or the crown goes back on the table. If the Crown pair splits up, the crown is vacant until the next challenge between two Gold+ pairs.
- Crown and tier badges appear next to names on every leaderboard tab, the challenge board and the court board's player list.

### 3.7 Healthy-community guardrails (summary)

- Friendly challenges that never count.
- Points cap for repeat matchups.
- Score confirmation by the other pair; admin dispute queue.
- No mid-season demotion; at most one tier down at season end.
- A crown for participation, not only for winning.
- "Good match" hints instead of hard gates, so beginners can always ask a strong pair for a game.
- Opted-out players (Account → Privacy) can still play challenges; they just aren't listed on the public board, the same as today.

---

## 4. Where it lives in the site

| Area | Change |
|---|---|
| **`/challenges`** (new, public to view; signed-in to act) | Open challenges by date (today, this week), accepted/live matches, recent results, the Crown pair. Venues and times visible only to signed-in players. Refreshes every few seconds while the tab is visible (same polling as the court board). |
| **Profile → Player tab** | Pair card (partner, record, Team up / Unpair), "My challenges" (open, upcoming, needs confirming), rating, tier progress, crowns and season badges. Badge counter on the tab when a score needs confirming. |
| **`/leaderboard`** | Third tab **Challenges**, same periods; tier and crown badges beside names. |
| **Admin → Challenges** (new) | Disputes, void a result, set starting tiers, set tier boundaries for the season, end a crown, venue list, weekly activity. |
| **Court board** (`/casual-play`) | Optional, later: on a club play day an organiser can mark a court **Challenge court**, and the four players in a live challenge are skipped by the rotation until it finishes (Q13). |
| **API / webhooks / MCP** | `GET /api/v1/me/challenges`, `challenge.result` webhook event, MCP tool. Included in data export and account deletion. |
| **Attendance** | Challenges **don't** count as play-day attendance, since they can be played anywhere. The streaks and play-days board stay about club sessions. |

---

## 5. Data model (new tables in `lib/challenge-db.ts`, `ensure*Tables()` pattern)

```
pairs                 id, player_low_id, player_high_id, formed_at, formed_via (qr|code),
                      ended_at, ended_reason (unpaired|repaired|declined_after_match|account_deleted)
pair_members          pair_id, player_id, active BOOLEAN    -- partial UNIQUE (player_id) WHERE active
qr_tokens             id, purpose (pair|checkin), token_hash UNIQUE, short_code_hash,
                      owner_player_id, challenge_id NULL, expires_at, consumed_at, consumed_by
challenges            id, posting_pair_id, accepting_pair_id NULL,
                      window_start, window_end, venue_id NULL, venue_text,
                      kind (competitive|friendly), note, status (open|accepted|live|awaiting|
                      completed|disputed|void|expired|cancelled),
                      posted_at, accepted_at, checked_in_at, completed_at, expires_at
challenge_scores      challenge_id PK, games JSONB [{posting, accepting}], winner_pair_id,
                      entered_by, entered_at, confirmed_by, confirmed_at, auto_confirmed,
                      disputed_by, disputed_at, dispute_note, counts_for_points, cap_reason
challenge_results     challenge_id, player_id, pair_id, won, points, points_for, points_against,
                      rating_before, rating_after, played_on   -- one row per player, feeds leaderboard
challenge_venues      id, name, address, active, sort          -- club-managed list
challenge_messages    id, challenge_id, sender_player_id, body, created_at   -- only if Q15 = chat
player_ratings        player_id PK, rating, competitive_matches, starting_tier, updated_at
season_tiers          season_key, player_id, tier, peak_tier, final_tier
tier_boundaries       season_key, tier, min_rating
crown_holds           crown (pair|pack_leader|season), holder_pair_id, holder_player_id,
                      from_at, to_at, won_in_challenge_id
push_subscriptions    id, player_id, endpoint UNIQUE, p256dh, auth, created_at, last_ok_at
```

- "One active pair per player" is a partial unique index on `pair_members(player_id) WHERE active`, so two scans at the same moment can't both succeed.
- State changes on a challenge are a single conditional `UPDATE … WHERE status = '<expected>'` (the pattern the court board and shop holds already use), so two pairs can't accept the same challenge.
- Ratings are recomputed from `challenge_results` in order when an admin voids an old result.

---

## 6. QR implementation

- **Showing:** a QR generated in the browser (a small encoder, ~10 KB, loaded with the panel) from a link `https://<site>/q/<token>`; the token rotates every 60 s while the panel is open.
- **Scanning:** in-app scanner using `getUserMedia` with the rear camera, `BarcodeDetector` where the browser has it, otherwise jsQR (or ZXing-WASM) loaded only when the scanner opens. A **"Type a code instead"** fallback.
- **Native camera fallback:** scanning with the phone's camera opens `/q/<token>`, which signs in if needed (`safe-next`) and continues. On iPhone the Home Screen app and Safari keep separate sign-ins, so the in-app scanner is the main path.
- **Security:** tokens are 128-bit random, stored as SHA-256 hashes, single-use, 2-minute expiry, rate-limited per player; the check-in token only works for the opposite pair of that one challenge.

---

## 7. Notifications

| Event | In-app (always) | Web Push (opt-in) | Email |
|---|---|---|---|
| Your challenge was accepted | ✓ | ✓ | – |
| Score needs your confirmation | ✓ (tab badge) | ✓ | – |
| Score disputed / voided | ✓ | ✓ | ✓ |
| You lost / won a crown, reached a new tier | ✓ | ✓ | – |

Web Push needs VAPID keys (two new env vars) and a `push` handler in `public/sw.js`. Email stays for rare events only, to stay well under Resend's 100/day.

---

## 8. Delivery plan (one PR per phase)

| Phase | Scope | Depends on |
|---|---|---|
| **1. Pairs** | `pairs`, `pair_members`, `qr_tokens`; QR show/scan component (lazy-loaded decoder, typed-code fallback); `/q/[token]`; pair card on the Player tab | – |
| **2. Challenges** | `challenges`, `challenge_scores`, `challenge_results`, `challenge_venues`; `/challenges` board; post (when/where)/accept/cancel/expire; coordination (Q15); QR check-in; score entry with BWF validation and confirm; after-match prompts; points caps; Admin → Challenges (disputes, void, venues) | 1 |
| **3. Leaderboard, ratings, tiers, crowns** | `player_ratings`, `season_tiers`, `tier_boundaries`, `crown_holds`; Challenges tab on `/leaderboard`; badges everywhere names appear; season reset cron; admin starting tiers and boundaries | 2 |
| **4. Notifications & court board** | Web Push (subscriptions, service worker handler, opt-in prompt after install); Challenge court on the court board; API/webhook/MCP additions | 2 |

**Verification each phase:** `next build`, lint, `node --test` units for the pure logic (Elo, tier assignment, points cap, state transitions, token expiry), and a Playwright run with two browser contexts playing two players (QR shown as an image in one, decoded in the other via the typed-code path), with phone and desktop screenshots.

---

## 9. Cost

| Item | Cost |
|---|---|
| QR generation and scanning | $0 (on device) |
| Web Push | $0 (browser push services) |
| Database rows | negligible on the current Postgres plan |
| Email | only disputes/voids; well inside Resend's free tier |

---

## 10. Risks

- **Games away from the club:** the club can't see these games. The QR check-in, the 8-minute minimum, opponent confirmation, the repeat cap and the dispute queue are what keep results honest. Worth a line in the terms that challenge games outside club sessions are arranged by the players, not run by the club (insurance/liability).
- **Meeting people you don't know:** pairs arrange games with players they may not have met; venues and times are shown only to signed-in players, and contact details are never shared without opting in.
- **Small player pool:** with ~40 active players, a few strong pairs could dominate; the participation crown, tiers and "good match" hints are there to keep it interesting for everyone else.
- **Self-reported scores:** mitigated by check-in, opponent confirmation, the dispute queue and the repeat cap.
- **iPhone push only after install:** players who use the site in Safari will rely on the in-app badge.

---

## 11. Open questions

Answered 17 Nov:
1. Where/when → **anywhere, anytime**.
2. Tiers → **hybrid** (points order the board, rating sets the tier).
3. Format → **one game to 21**.
4. Who → **any account holder**.

To settle before phase 2–3 (defaults in brackets):
5. Categories: one open board, or separate men's / women's / mixed? [one open board]
6. One current partner per player, or several pairs at once? [one]
7. Friendly (non-counting) challenges? [yes]
8. Auto-confirm an unconfirmed score after 24 h? [yes]
9. Repeat-matchup cap: once per day, three per 30 days; and at most 4 counted challenges per player per day? [yes]
10. Season length: calendar quarter? [yes]
11. Crown set: Crown pair, Pack Leader, Season champion — and are the names right, or something more Three Wolves (e.g. "Alpha pair")? [as listed]
12. Should the existing mini game tiers seed starting tiers? [yes, admin-confirmed]
13. Court board: on club play days, should organisers be able to set aside a Challenge court? [later, optional]
14. Should challenge points ever merge with round robin points into one overall board? [no, separate tab]
15. **How do two pairs arrange a game once accepted?** A short in-app chat per challenge (4 people, closes 2 days after the game), or each player can choose to share their phone number with the other pair? [in-app chat; phone sharing opt-in]
16. Which **venues** go on the starting list (the club's own hall, plus others players use)?
17. How far ahead can a challenge be posted? [7 days]

---

### Sources

- Challenge ladder conventions: https://skedge-web.web.app/help/running-a-ladder, https://skedge-web.web.app/blog/run-a-tennis-ladder, https://en.wikipedia.org/wiki/Ladder_tournament, https://rec.usask.ca/campus-rec/intramurals/game-rules/badminton.php, https://badmintonclub.uwaterloo.ca/levels
- Playtomic levels, friendly vs competitive: https://playerhelp.playtomic.com/hc/en-gb/articles/43310980754193-How-the-Playtomic-level-system-works, https://help.playtomic.com/en/articles/5689294-friendly-vs-competitive-open-matches
- DUPR match validation: https://dupr.com/post/ensuring-fair-play-the-importance-of-match-validation-on-dupr
- Reclub doubles ladders: https://help.reclub.co/hc/reclub-help/en/categories/reclub
- Strava Local Legends: https://www.cyclingnews.com/news/how-local-legends-are-made-on-strava, https://dcrainmaker.com/2020/06/strava-legends-feature.html
- Duolingo leagues: https://duolingo.deconstructoroffun.com/mechanics/leagues
- League of Legends tiers and demotion: https://support-leagueoflegends.riotgames.com/hc/en-us/articles/4405783687443
- Doubles ratings in small clubs: https://unhladder.duckdns.org/about, https://keepscore-pickleball.pages.dev/ratings
- Rating manipulation handling: https://support.chess.com/en/articles/8639319-how-does-matchmaking-work-in-live-chess
- BarcodeDetector on Safari: https://caniuse.com/mdn-api_barcodedetector, https://bugs.webkit.org/show_bug.cgi?id=198174
- Web Push on iOS: https://documentation.onesignal.com/docs/web-push-for-ios, https://www.macrumors.com/2023/02/16/ios-16-4-web-push-notifications/
