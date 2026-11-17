# Plan: Wolf Points, rank ladder, pair challenges & crowns

Status: **draft for discussion**. Nothing built yet. Items marked **(proposed)** are recommendations waiting on a decision; the open questions are in §12.

**Decided:**

| Date | Decision |
|---|---|
| 17 Nov | Challenges can be played **anywhere, anytime**; they aren't tied to club play days. |
| 17 Nov | A challenge is **one game to 21** (BWF scoring: win by 2, golden point at 29–29). |
| 17 Nov | **Any account holder** can team up and play (members and casual players). |
| 17 Nov (rev.) | Teaming up and challenge check-in use a **5-digit code**, not a QR code. |
| 17 Nov (rev.) | **Every challenge is competitive.** No friendlies; every point counts. |
| 17 Nov (rev.) | Each player has an **individual rank** on a badminton-themed ladder (~18 ranks in **4 leagues**, plus 2 limited "Wolf" seats). It is earned with **Wolf Points** from **play-day attendance, round robin results and challenge results**. This replaces the earlier "skill rating sets the tier" idea, so there's no Elo rating. |
| 17 Nov (rev.) | **Everyone starts at the bottom, but history counts:** attendance and round robin results already in the database count on launch day, so ranks form from real play. |
| 17 Nov (rev.) | **Demotion = "keep it polished":** Shuttle and Racket ranks are permanent; Precious Racket and Legend Kit ranks tarnish if you stop playing (never below the start of a league you've reached); the Wolf seats are live, limited and change hands. |
| 17 Nov (rev.) | Challenge bonuses: **Giant-killer +2, New rival +1, Crown bounty +4, Hot streak +1**. |

---

## 1. Summary

Every player climbs a **rank ladder from a Plastic Shuttle to a Champion's Trophy**, and the very best hold one of the **Wolf seats** at the top (3 Silver Wolves, 1 Alpha Wolf). Ranks are earned with **Wolf Points (WP)**:
- turning up to a play day: **2 WP**;
- each round robin win: **2 WP**;
- each challenge win: **2 WP**, plus bonuses.

**Challenges** are how players earn points between play days, anywhere they like:
1. Two players **team up** by typing the 5-digit code on their partner's screen.
2. The pair **puts itself up for a challenge**, saying when and where.
3. Another pair **accepts** on the website.
4. When they meet, one player from each pair **checks in with a 5-digit code**.
5. After the game, one pair enters the score and the other pair **confirms it**.
6. Both pairs are asked whether to **keep the pairing** and whether to **go back up for a challenge**.

| Piece | What players see |
|---|---|
| **Rank & kit bag** | Your current item (e.g. *Carbon Racket*), a progress bar to the next one, and a kit bag showing every item earned so far, with locked silhouettes for what's next. |
| **Pairs** | "Team up" on the Player tab: show my code, or type theirs. One current partner; the pair's record. |
| **Challenge board** | `/challenges`: pairs up for a game with when and where, rank badges, head-to-head records and a bonus preview ("Giant-killer +2 available"). |
| **Check-in** | At the court, one player reads out a 5-digit code and an opponent types it in. The match is live. |
| **Score** | Either pair enters it; the other pair confirms. Disputes go to the admins. |
| **Celebrations** | A rank-up screen, a shareable rank card, and shout-outs on the challenge board feed. |
| **Leaderboard** | New **Wolf Points** and **Challenges** tabs, with rank icons beside every name and crowns. |

Expected running cost: **$0/month** (same stack; no camera, QR library or paid service).

---

## 2. What other platforms do (research)

| Platform | Mechanic | What we take from it |
|---|---|---|
| **Gunbound** (the reference you gave) | Ranks climb through item icons (hammers, axes, wands) on fixed point (GP) thresholds. The very top ranks (the dragons) are **limited seats** held by the top players, not a points threshold. Single then double icons make rank-ups frequent. | An item ladder on fixed thresholds, with **limited "Wolf" seats** at the top. Our items and art are original and badminton-themed (no Gunbound names or icons). |
| **League of Legends ranked** | Tiers are grouped into bands; **decay only at the top**; protection after promotion. | Ranks grouped into **4 leagues**; only the upper two leagues tarnish when inactive; you never drop out of a league you've reached. |
| **Strava Local Legend** | A crown for the person who did a segment **the most times in 90 days**, not the fastest; the rolling window means it must be defended. | The **Pack Leader** crown, and Wolf seats decided on **90-day** points so they stay live. |
| **Strava KOM / king of the hill** | One holder; beat them to take it. | The **Crown pair**, with a **Crown bounty**. |
| **Duolingo leagues** | Demotion drives return visits but also causes anxiety; critics note grinding easy wins. | Inactivity, not losing, is what lowers a rank. **Giant-killer** and **New rival** bonuses reward harder and more varied games over grinding. |
| **Club challenge ladders** (tennis/badminton, Skedge) | **No-response forfeit**; **one open challenge per player**; a challenge range. | Challenges expire; one open challenge per pair; no range limit, but bonuses for challenging up. |
| **DUPR** (pickleball ratings) | A self-reported result stays **pending** until the opponents **validate** it. | Score entered by one pair, **confirmed by the other** before points count. |
| **Playtomic** (padel) | Friendly vs competitive matches; team strength = combined level of both partners. | **No friendlies** (your call: every point counts). A pair's strength = the **average rank of both partners**, used for the Giant-killer bonus and "good match" hints. |
| **Reclub** (the court board's model) | Doubles ladders with **fixed partners**. | Fixed partners for the length of a challenge. |
| **Chess.com / Lichess** | Fair-play teams watch for **farming** the same opponent. | Caps on repeat matchups, and admins can void a result. |

Technical findings:
- **No camera needed:** a 5-digit code works on any phone, can be read out loud across a court, and avoids Safari's missing `BarcodeDetector` (a QR scanner on iPhone would have needed an extra decoder library).
- **Notifications:** Resend's free tier is 100 emails/day, too few for per-challenge emails. **Web Push** is free and works on iPhone **only for Home Screen web apps** (iOS 16.4+), which the profile already is, with an install guide.

---

## 3. Wolf Points (WP)

### 3.1 How points are earned

| Source | Points | Already recorded? |
|---|---|---|
| Play day attended | **2** per play day (proposed: the same as a win, because turning up is what keeps the club going) | Yes: `attendance` (court board, round robin, admin ticks, roster) |
| Round robin win | **2** per win, 0 per loss (the existing RR points) | Yes: `rr_results` |
| Challenge win | **2** per win, 0 per loss | New |
| **Giant-killer** | **+2**: win against a pair whose average rank is in a **higher league** than your pair's average | New |
| **New rival** | **+1** each for playing (win or lose) a pair in which **neither player** has faced you in a challenge before | New |
| **Hot streak** | **+1** for each challenge win after **3 wins in a row** (the streak resets on a loss) | New |
| **Crown bounty** | **+4** each for beating the Crown pair (they lose the crown) | New |

- Points go **to each player**, not to the pair, because pairs change and players are the constant.
- Points are never taken away for a loss.
- A player's WP total is **worked out from the records**, not stored as a running balance, the same as today's leaderboard. Linking a mini game name or fixing attendance on Admin → Play days updates everyone's rank at once.
- **History counts (decided):** on launch day, every play day and round robin result already in the database counts.

### 3.2 Caps (anti-farming; proposed)

Every challenge counts, so the caps work by **stopping a challenge from being posted or accepted**, not by making it count for nothing:
- the same two pairs (or the same four players in any split) can play each other **once a day and three times in 30 days**. The board says "You've played them 3 times this month. Find a new rival (+1)!";
- a player can play at most **4 challenges a day**.

---

## 4. The rank ladder

### 4.1 Ranks (~18 plus 2 seats, in 4 leagues)

Thresholds are **starting proposals**. They'll be tuned after a dry run on the real history (§4.4).

| League | # | Rank (EN) | Rank (VI, to check) | Total WP |
|---|---|---|---|---|
| **1 · Shuttle** | 1 | Plastic Shuttle | Cầu Nhựa | 0 |
| | 2 | Feather Shuttle | Cầu Lông Vũ | 4 |
| | 3 | Shuttle Tube | Ống Cầu | 10 |
| **2 · Racket** | 4 | Wooden Racket | Vợt Gỗ | 20 |
| | 5 | Steel Racket | Vợt Thép | 35 |
| | 6 | Aluminium Racket | Vợt Nhôm | 55 |
| | 7 | Carbon Racket | Vợt Carbon | 80 |
| | 8 | Player's Racket | Vợt Tuyển Thủ | 110 |
| | 9 | Pro Racket | Vợt Chuyên Nghiệp | 150 |
| **3 · Precious Racket** | 10 | Silver-plated Racket | Vợt Mạ Bạc | 200 |
| | 11 | Golden Racket | Vợt Vàng | 260 |
| | 12 | Platinum Racket | Vợt Bạch Kim | 330 |
| | 13 | Diamond Racket | Vợt Kim Cương | 410 |
| **4 · Legend Kit** | 14 | Racket Bag | Túi Vợt | 500 |
| | 15 | Court Shoes | Giày Thi Đấu | 600 |
| | 16 | Club Jersey (Three Wolves) | Áo Câu Lạc Bộ | 720 |
| | 17 | Champion's Trophy | Cúp Vô Địch | 850 |
| **Wolf seats** | – | **Silver Wolf** (3 seats) | Sói Bạc | top 2–4 by WP in the last 90 days, among Precious Racket or above |
| | – | **Alpha Wolf** (1 seat) | Sói Đầu Đàn | top 1 by WP in the last 90 days, among Precious Racket or above |

Pace for a typical regular (one play day a week, two challenges a week, the odd round robin) is about **5–6 WP a week**:
- first rank-up on their **first play day**;
- Wooden Racket within about a month;
- Pro Racket in about 6 months;
- Diamond Racket in about 18 months;
- Champion's Trophy is a multi-year goal.

The early ranks come quickly on purpose, so newcomers feel progress straight away. The club jersey as a rank ties in with the real Port Hills Dawn jersey in the shop.

### 4.2 Demotion: "keep it polished" (decided)

- **Shuttle and Racket leagues are permanent.** You never lose a racket you've earned.
- **Precious Racket and Legend Kit ranks need upkeep:** at least **6 WP in the last 60 days** (one play day and one challenge win, for example).
  - **Day 60** below that: "Your Golden Racket is tarnishing. Play within 30 days to keep it shiny." The icon shows a dull finish.
  - **Each further 30 days** below it: the shown rank slips **one rank**, but never below the **start of the highest league you've reached** (a Golden Racket stays at least Silver-plated).
  - **As soon as you're back above 6 WP in 60 days, the rank is restored.** Points were never removed, so returning players get a "Polished!" moment instead of a punishment.
- **Wolf seats are live:** recalculated whenever results change, from the last 90 days. They change hands, and they're the only ranks you can lose to someone else.
- Losses never cost points, so nobody has a reason to avoid playing stronger pairs.

### 4.3 What players see

- **Rank card** (Player tab): item icon, rank name, WP total, a progress bar ("14 WP to Carbon Racket"), and how each source contributed (play days / round robin / challenges / bonuses).
- **Kit bag:** a grid of every item earned, in order, with locked silhouettes for the next three. Tapping an item shows the date it was earned and the game that earned it ("Carbon Racket, 12 Mar, beat Sơn & Huy 21–18").
- **Rank-up moment:** the next time the player opens the app, a full-screen card with the new item and a **Share** button (an image made with Next.js's built-in `next/og`, for Messenger, Facebook or Zalo).
- **Shout-out** on the challenge board feed: "Ly reached **Carbon Racket** 🎉".
- **Rank icon beside every name:** leaderboards, the challenge board, pair cards, and (optional) the court board's player list.
- **Item art:** about 20 original flat icons in brand colours. Materials show as colour and finish: wood, brushed steel, aluminium, carbon weave, silver, gold, platinum, diamond sparkle. Wolves for the top seats. Drawn as SVG, so they're small and easy to swap if a designer redraws them later.
- Opted-out players (Account → Privacy) still have a rank, visible only to them, as today.

### 4.4 Launch calibration

1. Before launch, run the ladder over the real history as a **dry run**: Admin → Players shows how many players land in each rank.
2. Tune the thresholds so that **regulars land in the Racket league, a handful in Precious Racket, and nobody in Legend Kit** (something to aim for).
3. Confirm, then switch it on.
4. Thresholds live in one file (`lib/ranks.ts`). Raising a threshold later never takes away a rank someone already holds, because the peak is stored.

---

## 5. Pairs (teaming up)

1. Player A taps **Team up → Show my code**. A big **5-digit code** appears (e.g. `48 213`), valid for **2 minutes**, with **New code** to refresh it.
2. Player B taps **Team up → Enter code**, types it and sees "Team up with **Hòa** (Golden Racket)?"; B confirms.
3. A's screen asks "**Ly** wants to team up. Accept?" Once both have confirmed, the pair exists. Asking both sides means a guessed code can't pair you with a stranger.

- **One current partner per player (proposed).** Forming a new pair ends the old one (after a confirmation). Past pairs and their record are kept.
- **Unpair** any time, except while a challenge is accepted or live.
- **Pair name (proposed):** optional, e.g. "Smash Bros", checked against a word filter. It shows on the board alongside both names.
- **Pair card:** record together, current streak, best win, and the pair's average rank.

---

## 6. Challenges

### 6.1 Lifecycle

```
open ──accept──▶ accepted ──code check-in──▶ live ──score entered──▶ awaiting confirmation ──confirm──▶ completed
  │                  │                                                        │
  └─expire/cancel    └─expire/cancel (no check-in by the end of the window)   └─dispute ──▶ admin decides
                                                                              └─no reply in 24 h ──▶ auto-confirmed
```

- **Put us up:** either partner posts the pair as available with:
  - **When:** a window, e.g. "Sat 22 Nov, 2–5 pm" or "any evening this week" (at most 7 days ahead, proposed);
  - **Where:** pick from the club's venue list (Admin → Challenges) or type one;
  - optional note ("happy to play anyone", "we bring shuttles").
- **One open challenge per pair**, expiring at the end of its window.
- **Accept:** any partner of another pair can accept the stated time and place. Before accepting they see:
  - both pairs' ranks;
  - their head-to-head record ("You're 2–3 against them");
  - the bonuses on offer ("Giant-killer +2 · New rival +1").
- **Talking it through:** once accepted, the four players need to sort out details. See Q15 (in-app chat, or opt-in phone sharing).
- **Check-in:** a player in the accepting pair taps **We're here** and gets a 5-digit code. A player in the posting pair types it in. The code works only for that one challenge and only for the other pair, with 5 tries. With games away from the club, this is the proof the pairs actually met.
- **Score:** either pair enters it, **no sooner than 8 minutes after check-in and no later than 24 hours after**. The other pair gets "Confirm 21–17?" with Confirm / That's not right. Points count once confirmed. With no reply within 24 hours it auto-confirms (proposed). "That's not right" goes to **Admin → Challenges** with both versions.
- **Valid scores** (one game to 21, BWF):
  - the winner has 21 and the loser 19 or less; or
  - the winner has 22–29 and leads by exactly 2; or
  - the winner has 30 and the loser 28 or 29.
- **Retired / couldn't finish:** the opponents win 2 WP (no bonuses), so retiring is never a way to dodge a loss. An admin can void it instead for an injury.

### 6.2 After the game (both pairs, at the same time)

1. **Points:** "+5 WP: win 2 · Giant-killer 2 · New rival 1", with the rank bar filling. If they ranked up, the rank-up card follows.
2. "**Keep playing together?**" **Yes** keeps the pair; **No** ends it.
3. "**Up for another challenge?**" **Yes** puts the pair straight back on the board.
4. **Rematch** (only if the caps allow) or **Find a new rival**, which lists open pairs they've never played.

---

## 7. Crowns, achievements and seasons

### 7.1 Crowns

| Crown | Who holds it | Notes |
|---|---|---|
| **👑 Crown pair** | The pair that most recently beat the Crown pair. The first holder is the winner of the first challenge between two Precious Racket+ pairs. | **+4 Crown bounty** each for taking it. The holders must play at least one challenge every **14 days**, or the crown goes vacant. If the pair splits, it's vacant. |
| **🐺 Pack Leader** | Most challenges played in the last 90 days. | Rewards showing up, not winning (Strava's Local Legend). |
| **🏆 Season champion** | Most WP earned in the quarter. | Permanent trophy on the profile. |

### 7.2 Achievements (one-off badges, no points)

Small, collectable, and mostly about *how* people play, so every level of player can earn them:
- **First Blood:** first challenge win.
- **Golden Point:** win 30–29.
- **Nail-biter:** win 22–20 or closer.
- **Social Wolf:** played 10 different pairs.
- **Loyal Partner:** 20 challenges with the same partner.
- **Giant-killer:** first Giant-killer win.
- **Crown Taker.**
- **Hot Streak:** 5 challenge wins in a row.
- **Iron Wolf:** 10 play days in a row (uses the existing streaks).
- **Polished:** came back and restored a tarnished rank.

### 7.3 Seasons

- Seasons are **calendar quarters** (the leaderboard already has quarter periods). They decide the Season champion and the **season badge** ("Q1 2027 · Golden Racket peak").
- Ranks **don't** reset at season end; the ladder is a career. Seasons give everyone a fresh race on the Wolf Points leaderboard.
- **Season finale (proposed):** on the last play day of the quarter, the Season champion, Alpha Wolf, Crown pair and Pack Leader are announced at the hall. Any physical prize (e.g. a tube of shuttles) is the club's call (Q19).

---

## 8. Where it lives in the site

| Area | Change |
|---|---|
| **Profile → Player tab** | Rank card and kit bag at the top; pair card (Team up / Unpair); "My challenges" (open, upcoming, needs confirming); achievements; season badges. A tab badge when a score needs confirming. |
| **`/challenges`** (new; public to view, signed in to act) | Open challenges by date, accepted and live games, results feed with rank-up shout-outs, the current crowns. Venues and times shown only to signed-in players. Refreshes every few seconds while visible (same polling as the court board). |
| **`/leaderboard`** | Two new tabs, **Wolf Points** (overall) and **Challenges**, alongside Play days and Round robin. Same periods; rank icons and crowns beside names; the Wolf seats pinned at the top of Wolf Points. |
| **Admin → Challenges** (new) | Disputes, void a result, venues, end a crown, weekly activity. |
| **Admin → Players** | Rank dry run and threshold check (§4.4); a player's WP breakdown. |
| **Court board** (`/casual-play`) | Optional, later: rank icons on player chips; a "Challenge court" an organiser can set aside on a play day (Q13). |
| **API / webhooks / MCP** | `GET /api/v1/me/rank`, `GET /api/v1/me/challenges`; webhook events `rank.changed` and `challenge.result`; MCP tools. Included in data export and account deletion. |
| **Attendance** | Challenges **don't** count as play-day attendance, since they can happen anywhere. |

---

## 9. Data model (new tables in `lib/challenge-db.ts` and `lib/ranks-db.ts`, `ensure*Tables()` pattern)

```
pairs                 id, player_low_id, player_high_id, name, formed_at,
                      ended_at, ended_reason (unpaired|repaired|declined_after_match|account_deleted)
pair_members          pair_id, player_id, active BOOLEAN   -- partial UNIQUE (player_id) WHERE active
match_codes           id, purpose (pair|checkin), code_hash, owner_player_id, challenge_id NULL,
                      expires_at, consumed_at, consumed_by, attempts
challenges            id, posting_pair_id, accepting_pair_id NULL, window_start, window_end,
                      venue_id NULL, venue_text, note,
                      status (open|accepted|live|awaiting|completed|disputed|void|expired|cancelled|retired),
                      posted_at, accepted_at, checked_in_at, completed_at, expires_at
challenge_scores      challenge_id PK, posting_score, accepting_score, winner_pair_id,
                      entered_by, entered_at, confirmed_by, confirmed_at, auto_confirmed,
                      disputed_by, disputed_at, dispute_note
challenge_results     challenge_id, player_id, pair_id, won, base_points,
                      bonus_giant_killer, bonus_new_rival, bonus_streak, bonus_crown,
                      points_for, points_against, played_on        -- one row per player
challenge_venues      id, name, address, active, sort
challenge_messages    id, challenge_id, sender_player_id, body, created_at   -- only if Q15 = chat
player_ranks          player_id PK, wp_total, wp_90d, wp_60d, earned_rank, shown_rank,
                      peak_rank, league_floor, tarnish_warned_at, seat (alpha|silver|NULL),
                      updated_at                                    -- cache, rebuilt from records
rank_events           id, player_id, kind (up|tarnish|restore|seat_won|seat_lost), from_rank,
                      to_rank, cause_ref, created_at, seen_at       -- drives rank-up cards and feed
achievements          player_id, code, earned_at, ref, PRIMARY KEY (player_id, code)
crown_holds           crown (pair|pack_leader|season), holder_pair_id, holder_player_id,
                      season_key, from_at, to_at, won_in_challenge_id
push_subscriptions    id, player_id, endpoint UNIQUE, p256dh, auth, created_at, last_ok_at
```

- **WP is worked out from the records:**
  - 2 × verified, not-removed `attendance` rows;
  - `rr_results.rr_points` (through `players.minigame_name`);
  - `challenge_results` base points plus bonuses.

  `player_ranks` is just a cache, rebuilt whenever results change (the same moments that already refresh the leaderboard with `revalidateTag("leaderboard")`), plus a daily cron for tarnish and Wolf seats.
- Ranks, thresholds, tarnish and bonus rules are **pure functions in `lib/ranks.ts`**, unit-tested like `lib/stats-periods.ts`.
- "One active pair per player" is a partial unique index, so two confirmations at the same moment can't both succeed.
- Challenge state changes are a single conditional `UPDATE … WHERE status = '<expected>'` (the court board and shop pattern), so two pairs can't accept the same challenge.
- Codes: 5 digits, unique among live codes for the same purpose, stored hashed, 2-minute expiry, **5 wrong tries per 10 minutes per player**. Pairing always needs both players to confirm.

---

## 10. Notifications

| Event | In-app | Web Push (opt-in) | Email |
|---|---|---|---|
| Someone wants to team up / your challenge was accepted | ✓ | ✓ | – |
| Score needs your confirmation | ✓ (tab badge) | ✓ | – |
| Rank up / Wolf seat won or lost / crown won or lost | ✓ | ✓ | – |
| Rank tarnishing (day 60) | ✓ | ✓ | ✓ (rare; one email) |
| Score disputed or voided | ✓ | ✓ | ✓ |

Web Push needs VAPID keys (two new env vars) and a `push` handler in `public/sw.js`. Email is kept for rare events, to stay well under Resend's 100/day.

---

## 11. Delivery plan (one PR per phase)

The rank ladder can go live **before** challenges, because attendance and round robin data already exist. That gives players something new straight away, and lets us tune the thresholds on real numbers.

| Phase | Scope | Depends on |
|---|---|---|
| **1. Wolf Points & ranks** | `lib/ranks.ts` (thresholds, leagues, tarnish, seats); `player_ranks`, `rank_events`; rank card, kit bag and item icons; rank-up card with share image; Wolf Points leaderboard tab with rank icons; dry run and calibration on Admin → Players; daily cron for tarnish and seats | – |
| **2. Pairs** | `pairs`, `pair_members`, `match_codes`; Team up (show code / enter code / both confirm); pair card; unpair | – |
| **3. Challenges** | `challenges`, `challenge_scores`, `challenge_results`, `challenge_venues`; `/challenges` board; post, accept, cancel, expire; coordination (Q15); code check-in; score entry with BWF validation, confirm and auto-confirm; after-game prompts; caps; Admin → Challenges; Challenges leaderboard tab | 1, 2 |
| **4. Bonuses, crowns, achievements, seasons** | Giant-killer, New rival, Hot streak, Crown bounty; `crown_holds`, `achievements`; season badges and champion; board feed shout-outs | 3 |
| **5. Notifications & extras** | Web Push; rank icons on the court board; Challenge court; API, webhooks and MCP additions | 3 |

**Verification each phase:**
- `next build` and lint;
- `node --test` units for thresholds, tarnish timing, league floors, seat assignment, each bonus rule, the caps, BWF score validation, code expiry and attempts, and challenge state transitions;
- a Playwright run with **two browser contexts** acting as two players (team up by code, post, accept, check in, score, confirm), with phone and desktop screenshots.

---

## 12. Open questions (defaults in brackets)

**Points and ranks**
1. Is a play day worth **2 WP**, the same as a win? [yes]
2. Are the **rank names** right? Is "Player's Racket" what you meant by "play racket"? Should anything else go in the Legend Kit league (e.g. strings, grips, a Shuttle Machine)? [as in §4.1]
3. Can someone who speaks Vietnamese check the **VI rank names**?
4. **Thresholds:** fine to tune after the dry run, aiming for nobody in Legend Kit on launch day? [yes]
5. **Item art:** I draw a simple original SVG set in brand colours, or a designer draws them? [I draw a first set; easy to replace]

**Pairs and challenges**
6. One current partner per player, or several pairs at once? [one]
7. Optional **pair names**, with a word filter? [yes]
8. One open board, or separate men's / women's / mixed? [one open board]
9. Auto-confirm an unconfirmed score after 24 h? [yes]
10. Caps: same matchup once a day and 3 times in 30 days; 4 challenges per player per day? [yes]
11. **Retired / couldn't finish** gives the opponents the win (2 WP, no bonuses), unless an admin voids it for injury? [yes]
12. How far ahead can a challenge be posted? [7 days]

**Community**
13. Court board: rank icons on chips, and a Challenge court organisers can set aside? [later, optional]
14. Crown names: Crown pair / Pack Leader / Season champion, or something more Three Wolves? [as listed]
15. **How do two pairs arrange a game once accepted?** A short in-app chat per challenge (closes 2 days after the game), or opt-in phone number sharing with the other pair? [in-app chat; phone sharing opt-in]
16. Which **venues** go on the starting list?
17. A line in the terms that challenge games outside club sessions are arranged by the players, not run by the club? [yes]
18. Should the round robin and play days tabs stay on the leaderboard next to Wolf Points? [yes]
19. Season finale: any physical prize from the club? [your call]

---

## 13. Risks

- **Games away from the club:** the code check-in, the 8-minute minimum, opponent confirmation, the caps and the dispute queue are what keep results honest.
- **Attendance outweighing play:** if play days dominate WP, ranks reward turning up over winning. The dry run shows the split per player; the play-day value is one constant to adjust.
- **Small pool:** with ~40 active players, a few strong pairs could hold the crowns. New rival and Giant-killer reward everyone else for mixing and challenging up, and Pack Leader goes to whoever plays most.
- **Meeting people you don't know:** venues and times are shown only to signed-in players; contact details are never shared without opting in.
- **iPhone push only after install:** players who use the site in Safari rely on the in-app badge.

---

### Sources

- Gunbound ranks: https://urgametips.com/?p=791, https://cf-inc.shapes.inc/fandom/gunbound/ranking-system (fan pages; the exact thresholds and seat counts aren't officially documented)
- League of Legends tiers and decay: https://support-leagueoflegends.riotgames.com/hc/en-us/articles/4405783687443
- Strava Local Legends: https://www.cyclingnews.com/news/how-local-legends-are-made-on-strava, https://dcrainmaker.com/2020/06/strava-legends-feature.html
- Duolingo leagues: https://duolingo.deconstructoroffun.com/mechanics/leagues
- Challenge ladder conventions: https://skedge-web.web.app/help/running-a-ladder, https://skedge-web.web.app/blog/run-a-tennis-ladder, https://en.wikipedia.org/wiki/Ladder_tournament
- DUPR match validation: https://dupr.com/post/ensuring-fair-play-the-importance-of-match-validation-on-dupr
- Playtomic levels and match types: https://playerhelp.playtomic.com/hc/en-gb/articles/43310980754193-How-the-Playtomic-level-system-works, https://help.playtomic.com/en/articles/5689294-friendly-vs-competitive-open-matches
- Reclub: https://help.reclub.co/hc/reclub-help/en/categories/reclub
- Rating manipulation handling: https://support.chess.com/en/articles/8639319-how-does-matchmaking-work-in-live-chess
- BarcodeDetector on Safari: https://caniuse.com/mdn-api_barcodedetector
- Web Push on iOS: https://documentation.onesignal.com/docs/web-push-for-ios
