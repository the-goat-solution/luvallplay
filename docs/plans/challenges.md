# Plan: Wolf Points, rank ladder, pair challenges & crowns

Status: **draft for discussion**. Nothing built yet apart from the draft art (§9). Items marked **(proposed)** are recommendations waiting on a decision; the open questions are in §15.

**Decided:**

| Date | Decision |
|---|---|
| 17 Nov | Challenges can be played **anywhere, anytime**; they aren't tied to club play days. |
| 17 Nov | A challenge is **one game to 21** (BWF scoring: win by 2, golden point at 29–29). |
| 17 Nov | **Any account holder** can team up and play (members and casual players). |
| 17 Nov | Teaming up and challenge check-in use a **5-digit code**, not a QR code. |
| 17 Nov | **Every challenge is competitive.** No friendlies; every point counts. |
| 17 Nov | Each player has an **individual rank** on a badminton-themed ladder, earned with **Wolf Points** from **play-day attendance, round robin results and challenge results**. No Elo rating. |
| 17 Nov | **Everyone starts at the bottom, but history counts:** attendance and round robin results already in the database count on launch day. |
| 17 Nov | **Demotion = "keep it polished":** Shuttle and Racket ranks are permanent; Precious Racket and Legend Kit ranks tarnish if you stop playing (never below the start of a league you've reached); the Wolf seats are live, limited and change hands. |
| 17 Nov | Challenge bonuses: **Giant-killer +2, New rival +1, Crown bounty +4, Hot streak +1**. |
| 17 Nov | A play day is worth **1 WP**. |
| 17 Nov | Ladder: **Carbon** becomes **Carbon Fibre Racket**; **Player's Racket is removed** (16 ranks + 2 Wolf seats). |
| 17 Nov | **Players arrange time and place themselves.** The site doesn't handle coordination: no chat, no phone sharing, no venue list, and no time or place on a challenge. |
| 17 Nov | **New graphics for everything that needs them**, following the site's style but kept subtle. A draft set is in `docs/plans/challenge-graphics/` (§9). |
| 17 Nov | The challenge page gets its own **bolder, playful look ("The Arena")**, with extra colours beyond the brand palette (§10). |

---

## 1. Summary

Every player climbs a **rank ladder from a Plastic Shuttle to a Champion's Trophy**, and the very best hold one of the **Wolf seats** at the top (3 Silver Wolves, 1 Alpha Wolf). Ranks are earned with **Wolf Points (WP)**:
- **1 WP** for each play day attended;
- **2 WP** for each round robin win;
- **2 WP** for each challenge win, plus bonuses.

**Challenges** are how players earn points between play days:
1. Two players **team up** by typing the 5-digit code on their partner's screen.
2. The pair **puts itself up for a challenge**.
3. Another pair **accepts** on the website.
4. The four players arrange when and where among themselves.
5. When they meet, one player from each pair **checks in with a 5-digit code**.
6. After the game, one pair enters the score and the other pair **confirms it**.
7. Both pairs are asked whether to **keep the pairing** and whether to **go back up for a challenge**.

| Piece | What players see |
|---|---|
| **Rank & kit bag** | Your current item (e.g. *Carbon Fibre Racket*), a progress bar to the next one, and a kit bag showing every item earned, with locked silhouettes for what's next. |
| **Pairs** | "Team up" on the Player tab: show my code, or type theirs. One current partner; the pair's record. |
| **The Arena** (challenge board) | `/challenges`: a floodlit night-court page where every open challenge is a fight card with an empty "You?" corner, a big VS, rank icons, head-to-head records and the bonuses on offer. |
| **Check-in** | When they meet, one player reads out a 5-digit code and an opponent types it in. The match is live. |
| **Score** | Either pair enters it; the other pair confirms. Disputes go to the admins. |
| **Celebrations** | A rank-up screen, a shareable rank card, and shout-outs on the challenge board feed. |
| **Leaderboard** | New **Wolf Points** and **Challenges** tabs, with rank icons beside every name and crowns. |

Expected running cost: **$0/month** (same stack; the art is static SVG).

---

## 2. What other platforms do (research)

| Platform | Mechanic | What we take from it |
|---|---|---|
| **Gunbound** (your reference) | Ranks climb through item icons (hammers, axes, wands) on fixed point thresholds. The very top ranks (the dragons) are **limited seats** for the top players. | An item ladder on fixed thresholds, with **limited Wolf seats** at the top. Our items and art are original and badminton-themed. |
| **League of Legends ranked** | Tiers grouped into bands; **decay only at the top**; protection after promotion. | Ranks grouped into **4 leagues**; only the upper two leagues tarnish; you never drop out of a league you've reached. |
| **Strava Local Legend** | A crown for doing a segment **the most times in 90 days**, not the fastest. | The **Pack Leader** crown, and Wolf seats decided on **90-day** points. |
| **Strava KOM / king of the hill** | One holder; beat them to take it. | The **Crown pair**, with a **Crown bounty**. |
| **Duolingo leagues** | Demotion drives return visits but causes anxiety; critics note grinding easy wins. | Only inactivity lowers a rank. **Giant-killer** and **New rival** reward harder and more varied games. |
| **Club challenge ladders** (Skedge) | **No-response forfeit**; **one open challenge per player**. | Challenges expire; one open challenge per pair. |
| **DUPR** (pickleball ratings) | A self-reported result stays **pending** until the opponents **validate** it. | The other pair **confirms** the score before points count. |
| **Playtomic** (padel) | Team strength = combined level of both partners. | A pair's strength = the **average rank** of both partners, used for Giant-killer and "good match" hints. |
| **Chess.com / Lichess** | Fair-play teams watch for **farming** the same opponent. | Caps on repeat matchups; admins can void a result. |
| **Rank icon sets** (game UI asset packs) | One shape per tier; consistent line weight and palette; simpler drawings at small sizes. | Frame shape per league, item per rank, two detail levels (§9). |
| **WCAG 1.4.1 Use of Color** | Colour can't be the only way to tell things apart. | Every rank differs in shape, not just material colour, and always has its name as text or an accessible label. |

---

## 3. Wolf Points (WP)

### 3.1 How points are earned

| Source | Points | Already recorded? |
|---|---|---|
| Play day attended | **1** per play day | Yes: `attendance` (court board, round robin, admin ticks, roster) |
| Round robin win | **2** per win, 0 per loss (the existing RR points) | Yes: `rr_results` |
| Challenge win | **2** per win, 0 per loss | New |
| **Giant-killer** | **+2**: win against a pair whose average rank is in a **higher league** than your pair's | New |
| **New rival** | **+1** each for playing (win or lose) a pair in which **neither player** has faced you in a challenge before | New |
| **Hot streak** | **+1** for each challenge win after **3 wins in a row** (resets on a loss) | New |
| **Crown bounty** | **+4** each for beating the Crown pair (they lose the crown) | New |

- Points go **to each player**, not to the pair.
- Points are never taken away for a loss.
- WP is **worked out from the records**, not stored as a running balance, the same as today's leaderboard. Linking a mini game name or fixing attendance updates everyone's rank at once.
- **History counts:** on launch day, every play day and round robin result already in the database counts.

### 3.2 Caps (anti-farming; proposed)

Every challenge counts, so the caps work by **stopping a challenge from being posted or accepted**:
- the same two pairs (or the same four players in any split) can play each other **once a day and three times in 30 days**. The board says "You've played them 3 times this month. Find a new rival (+1)!";
- a player can play at most **4 challenges a day**.

---

## 4. The rank ladder

### 4.1 Ranks (16, plus 2 Wolf seats, in 4 leagues)

Thresholds are **starting proposals** for 1 WP per play day. They'll be tuned after a dry run on the real history (§4.4).

| League | # | Rank (EN) | Rank (VI, to check) | Total WP |
|---|---|---|---|---|
| **1 · Shuttle** | 1 | Plastic Shuttle | Cầu Nhựa | 0 |
| | 2 | Feather Shuttle | Cầu Lông Vũ | 3 |
| | 3 | Shuttle Tube | Ống Cầu | 8 |
| **2 · Racket** | 4 | Wooden Racket | Vợt Gỗ | 16 |
| | 5 | Steel Racket | Vợt Thép | 28 |
| | 6 | Aluminium Racket | Vợt Nhôm | 44 |
| | 7 | Carbon Fibre Racket | Vợt Sợi Carbon | 64 |
| | 8 | Pro Racket | Vợt Chuyên Nghiệp | 90 |
| **3 · Precious Racket** | 9 | Silver-plated Racket | Vợt Mạ Bạc | 125 |
| | 10 | Golden Racket | Vợt Vàng | 165 |
| | 11 | Platinum Racket | Vợt Bạch Kim | 210 |
| | 12 | Diamond Racket | Vợt Kim Cương | 260 |
| **4 · Legend Kit** | 13 | Racket Bag | Túi Vợt | 330 |
| | 14 | Court Shoes | Giày Thi Đấu | 400 |
| | 15 | Club Jersey (Three Wolves) | Áo Câu Lạc Bộ | 480 |
| | 16 | Champion's Trophy | Cúp Vô Địch | 570 |
| **Wolf seats** | – | **Silver Wolf** (3 seats) | Sói Bạc | 2nd–4th by WP in the last 90 days, among Precious Racket or above |
| | – | **Alpha Wolf** (1 seat) | Sói Đầu Đàn | 1st by WP in the last 90 days, among Precious Racket or above |

Pace for a typical regular (one play day and two challenges a week, the odd round robin) is about **4–5 WP a week**:
- a newcomer reaches Feather Shuttle with their first win (or three play days);
- Wooden Racket in about a month;
- Pro Racket in about 5 months;
- Diamond Racket in just over a year;
- Champion's Trophy is a 2–3 year goal.

### 4.2 Demotion: "keep it polished" (decided)

- **Shuttle and Racket leagues are permanent.** You never lose a racket you've earned.
- **Precious Racket and Legend Kit ranks need upkeep:** at least **5 WP in the last 60 days** (one play day and two challenge wins, for example).
  - **Day 60** below that: "Your Golden Racket is tarnishing. Play within 30 days to keep it shiny." The icon dulls (§9.3).
  - **Each further 30 days** below it: the shown rank slips **one rank**, but never below the **start of the highest league you've reached**.
  - **As soon as you're back above 5 WP in 60 days, the rank is restored.** Points were never removed, so returning players get a "Polished!" moment instead of a punishment.
- **Wolf seats are live:** recalculated whenever results change, from the last 90 days.
- Losses never cost points.

### 4.3 What players see

- **Rank card** (Player tab): item icon, rank name, WP total, a progress bar ("26 WP to Pro Racket"), and a breakdown by source (play days / round robin / challenges / bonuses).
- **Kit bag:** every item earned, with locked silhouettes for the next three. Tapping an item shows when and how it was earned ("Carbon Fibre Racket, 12 Mar, beat Sơn & Huy 21–18").
- **Rank-up moment:** the next time the player opens the app, a full-screen card with the new item and a **Share** button (an image made with Next.js's built-in `next/og`).
- **Shout-out** on the challenge board feed: "Ly reached **Carbon Fibre Racket** 🎉".
- **Rank icon beside every name:** leaderboards, the challenge board, pair cards, and optionally the court board.
- Opted-out players (Account → Privacy) still have a rank, visible only to them.

### 4.4 Launch calibration

1. Before launch, run the ladder over the real history as a **dry run**: Admin → Players shows how many players land in each rank.
2. Tune the thresholds so that **regulars land in the Racket league, a handful in Precious Racket, and nobody in Legend Kit**.
3. Thresholds live in one file (`lib/ranks.ts`). Raising one later never takes away a rank someone already holds, because the peak is stored.

---

## 5. Pairs (teaming up)

1. Player A taps **Team up → Show my code**. A big **5-digit code** appears (e.g. `48 213`), valid for **2 minutes**, with **New code** to refresh it.
2. Player B taps **Team up → Enter code**, types it, sees "Team up with **Hòa** (Golden Racket)?" and confirms.
3. A's screen asks "**Ly** wants to team up. Accept?" Once both have confirmed, the pair exists. Asking both sides means a guessed code can't pair you with a stranger.

- **One current partner per player (proposed).** Forming a new pair ends the old one (after a confirmation). Past pairs and their record are kept.
- **Unpair** any time, except while a challenge is accepted or live.
- **Pair name (proposed):** optional, e.g. "Smash Bros", checked against a word filter.
- **Pair card:** record together, current streak, best win, and the pair's average rank.

---

## 6. Challenges

### 6.1 Lifecycle

```
open ──accept──▶ accepted ──code check-in──▶ live ──score entered──▶ awaiting confirmation ──confirm──▶ completed
  │                  │                                                        │
  └─expire/cancel    └─lapses if no check-in within 7 days                    └─dispute ──▶ admin decides
                                                                              └─no reply in 24 h ──▶ auto-confirmed
```

- **Put us up:** either partner taps **We're up for a challenge**, with:
  - how long they're available (today, 3 days or 7 days; proposed);
  - an optional short note ("any level welcome").
- **When and where are up to the players (decided).** The site shows who's up; the players sort out the rest themselves, the way they already do. The site never shares contact details.
- **One open challenge per pair**; it expires at the end of its availability.
- **Accept:** any partner of another pair can accept. Before accepting they see:
  - both pairs' ranks;
  - their head-to-head record ("You're 2–3 against them");
  - the bonuses on offer ("Giant-killer +2 · New rival +1").
- **Accepted challenges** show on both pairs' Player tab ("Up next: vs Sơn & Huy"). Either pair can **call it off** before check-in. If nobody checks in within **7 days**, it lapses.
- **Check-in:** a player in the accepting pair taps **We're here** and gets a 5-digit code. A player in the posting pair types it in. The code works only for that one challenge and only for the other pair, with 5 tries. With games away from the club, this is the proof the pairs actually met.
- **Score:** either pair enters it, **no sooner than 8 minutes after check-in and no later than 24 hours after**. The other pair gets "Confirm 21–17?" with Confirm / That's not right. Points count once confirmed. With no reply within 24 hours it auto-confirms (proposed). "That's not right" goes to **Admin → Challenges** with both versions.
- **Valid scores** (one game to 21, BWF):
  - the winner has 21 and the loser 19 or less; or
  - the winner has 22–29 and leads by exactly 2; or
  - the winner has 30 and the loser 28 or 29.
- **Retired / couldn't finish:** the opponents win 2 WP (no bonuses), so retiring is never a way to dodge a loss. An admin can void it for an injury.

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
| **🐺 Pack Leader** | Most challenges played in the last 90 days. | Rewards showing up, not winning. |
| **🏆 Season champion** | Most WP earned in the quarter. | Permanent trophy on the profile. |

### 7.2 Achievements (one-off badges, no points)

- **First Blood:** first challenge win.
- **Golden Point:** win 30–29.
- **Nail-biter:** win 22–20 or closer.
- **Social Wolf:** played 10 different pairs.
- **Loyal Partner:** 20 challenges with the same partner.
- **Giant-killer:** first Giant-killer win.
- **Crown Taker.**
- **Hot Streak:** 5 challenge wins in a row.
- **Iron Wolf:** 10 play days in a row.
- **Polished:** restored a tarnished rank.

### 7.3 Seasons

- Seasons are **calendar quarters**. They decide the Season champion and the **season badge** ("Q1 2027 · Golden Racket peak").
- Ranks **don't** reset at season end; the ladder is a career. Seasons give everyone a fresh race on the Wolf Points leaderboard.
- **Season finale (proposed):** on the last play day of the quarter, the Season champion, Alpha Wolf, Crown pair and Pack Leader are announced at the hall.

---

## 8. Where it lives in the site

| Area | Change |
|---|---|
| **Profile → Player tab** | Rank card and kit bag at the top; pair card (Team up / Unpair); "My challenges" (open, up next, needs confirming); achievements; season badges. A tab badge when a score needs confirming. |
| **`/challenges` · The Arena** (new; public to view, signed in to act) | The playful challenge page (§10): your pair and "Throw down a challenge", the Crown spotlight, live games, open challenges as fight cards, and a results feed with stickers and rank-up shout-outs. Refreshes every few seconds while visible (same polling as the court board). |
| **`/leaderboard`** | Two new tabs, **Wolf Points** (overall) and **Challenges**, alongside Play days and Round robin. Rank icons and crowns beside names; Wolf seats pinned at the top of Wolf Points. |
| **Admin → Challenges** (new) | Disputes, void a result, end a crown, weekly activity. |
| **Admin → Players** | Rank dry run and threshold check (§4.4); a player's WP breakdown. |
| **Court board** (`/casual-play`) | Optional, later: rank icons on player chips. |
| **API / webhooks / MCP** | `GET /api/v1/me/rank`, `GET /api/v1/me/challenges`; webhook events `rank.changed` and `challenge.result`; MCP tools. Included in data export and account deletion. |
| **Attendance** | Challenges **don't** count as play-day attendance, since they can happen anywhere. |

---

## 9. Graphics

**Draft set:** `docs/plans/challenge-graphics/`
- `preview.png` / `preview.html`: the whole set, plus in-context examples;
- `ranks/`, `crowns/`, `bonuses/`, `achievements/`: one SVG per graphic, each in two detail levels;
- `generate.mjs`: the source the SVGs are generated from.

### 9.1 How it follows the site

The art borrows from the club crest and the profile app rather than from game art:
- **Palette:** only the site's own colours (navy `#184467`, cream, steel, bronze) plus soft material tints: wood, brushed steel, aluminium, carbon, silver, the brand's bronze for gold, platinum and diamond. Nothing saturated, so icons sit quietly beside names.
- **Line:** navy outlines with round joins, like the profile tab icons. Fine strings and feather lines at large sizes echo the drawn rackets and shuttles in the crest.
- **Shapes from the crest:**
  - the Precious Racket shield is cut with the same angular facets as the crest's wolves;
  - Legend Kit carries the crest's banner ribbon;
  - the Wolf seats are a simplified faceted wolf head.
- **Cards:** on the same white cards, 16 px radius and soft navy shadow as the leaderboard; the rank-up card uses the leaderboard hero's navy gradient and Copperplate heading.

### 9.2 How ranks are told apart (shape first, then colour)

- **League = frame shape:**
  - Shuttle: round token;
  - Racket: rounded shield;
  - Precious Racket: faceted shield;
  - Legend Kit: shield with ribbon;
  - Wolf seats: navy crest.
- **Rank = the item:** shuttle, feathers, tube; rackets with different head shapes (round wooden head with a T-joint, squarer modern heads, slim pro head with a bronze grip); bag, shoes, jersey, trophy.
- **Material = colour and finish**, as a secondary cue.
- **Step within the league = pips** along the bottom of the frame.
- **Sparkles** count up through the Precious league (1 to 4), so silver, gold, platinum and diamond differ in more than colour.
- Every icon carries its name as an accessible label, and the name is shown as text wherever there's room (WCAG 1.4.1).

### 9.3 Sizes and states

| Use | Size | Detail level |
|---|---|---|
| Next to names (leaderboards, board, chips) | 16–24 px | **Bold set** (`*.sm.svg`): thicker lines, no strings or pips |
| Rank card, kit bag, achievements | 48–72 px | **Fine set** (`*.lg.svg`) |
| Rank-up card, share image | 120–240 px | Fine set |

- **Tarnished:** the same icon, desaturated and slightly dulled with a CSS filter, plus the word "tarnishing". No separate art is needed.
- **Locked** (kit bag): a pale silhouette.
- **On navy backgrounds:** outlines switch to cream (the icons use `currentColor` once they're inline SVG in a component).
- **Crowns and achievements** are round medallions, so they're never mistaken for a rank. **Bonus chips** are simple line icons in the profile-tab style.

### 9.4 Still to draw in the build

These use the same system:
- an empty state for the kit bag;
- the Team up code screen (same flip tiles as the check-in code in §10);
- the share image layout;
- the season badge (league frame plus quarter label).

The set becomes one `<RankIcon rank size state />` component (inline SVG, about 1–2 KB per icon, no images to load), so rank icons cost nothing extra on the leaderboard.

## 10. The Arena: the challenge page

The rest of the profile stays calm and on brand. **`/challenges` is where the club lets loose:** it should feel like walking into a floodlit court on match night.

**Mockups** (in `docs/plans/challenge-graphics/`; open the `.html` files in a browser to see the motion):

| File | Shows |
|---|---|
| `arena-mobile.png` | The board on a phone |
| `arena-desktop.png` | The board on a desktop (two columns) |
| `arena-flow.png` | A match from start to finish: Accept (versus) → Check in → Score → Victory / Good game |
| `arena.html`, `flow.html` | The working mockups |

### 10.1 Research

- **Versus screens** (fighting and sports games) turn the wait before a match into a "hype moment": two sides split across the screen, names above, a big **VS** in the middle, and a plain background so the players stand out. We use this when a challenge is accepted.
- **Challenge lobbies** (fantasy sports, esports challenge boards) work when each open challenge is a **card with three or four things you can scan at a glance** and joining takes **two taps or fewer**. Each fight card shows: who, their ranks, your head-to-head record, the bonus on offer and how long it's open, with **Accept** right there.
- **Live sports apps** borrow game mechanics: challenge boards, streaks, rewards chips. Those are our bonus chips, the "on fire" streak strip and the results feed.
- **Celebrations:** confetti and big motion should be **one-off and skippable**. With "reduce motion" turned on, each effect becomes a simple fade or still image, and nothing important is shown by motion alone.

### 10.2 Look: "night court"

- **Background:** the brand navy pushed darker (`#08131f` → `#0d2033`), lit by two soft **floodlight beams** from the top corners, with faint **badminton court lines** in perspective behind the title.
- **Extra colours, for this page only:**

  | Colour | Hex | Used for |
  |---|---|---|
  | Smash coral | `#ff6b57` | The pair that threw the challenge down ("their corner"); LIVE |
  | Court teal | `#2fd4b5` | The pair taking it on ("your corner"); Accept |
  | Floodlight yellow | `#ffd54a` | VS badges, the main button, stickers, highlights |
  | Bronze | `#c4892a` / `#e2ae60` | Crowns and Wolf Points, so the brand still runs through it |

  Text on coral, teal and yellow is always the dark ink colour, never white, so it passes contrast checks (white on coral doesn't).
- **Type:**
  - **Copperplate** stays for titles ("THE ARENA", names), so it's still Three Wolves;
  - **Montserrat Black Italic** (already in the site's fonts) for anything sporty: VS, scores, buttons, stickers.
- **Texture:** halftone dots in corners, slanted dividers, slightly tilted stickers ("GOLDEN POINT!", "GIANT-KILLER!"), sunburst rays behind the Crown and the Victory screen.

### 10.3 The board, top to bottom

1. **Title:** "THE ARENA" (VI: "Đấu Trường") with the line *Throw down. Show up. Every point counts.* Below it, live counters: pairs up, live now, games this week.
2. **Your pair:** both avatars with rank icons, the pair record and current streak, and a big tilted yellow **THROW DOWN A CHALLENGE** button that gives a small bounce every few seconds. Underneath: "Any pair can take you on. You sort out when and where." With no pair yet, this card becomes **Team up**.
3. **The Crown:** a gold spotlight card with slowly turning rays, the Crown pair, how long they've held it and how many times they've defended it, and **"Dethrone them: +4 each"**.
4. **Live now:** checked-in games as a coral/teal split card with a pulsing LIVE badge, minutes on court, and a shuttle flying back and forth along a dotted arc.
5. **Open challenges, as fight cards:**
   - the card is split on a slant: the posting pair in the coral corner, and an **empty teal "You & Ly?" corner** with a dashed "?", so the card reads as an invitation;
   - a yellow **VS** disc in the middle, and a "HOT" ribbon on the most-watched challenge;
   - chips for the bonus on offer (Giant-killer +2 / New rival +1 / Even match), how long it's open, and their note;
   - **Accept** in teal, one tap, then the versus screen.
6. **Just happened:** results with stickers (Golden point!, Giant-killer!, Crown defended), rank-ups with a small burst of confetti and the new rank icon, and an **"on fire"** strip for the hottest streak.

On a desktop the page splits in two: your pair, live games and open challenges on the left; the Crown and the feed on the right.

### 10.4 A match, screen by screen (`arena-flow.png`)

1. **Accept → versus screen:** the screen splits diagonally, coral on top and teal below, and a huge yellow **VS** slams in with a starburst behind it. Then "Challenge accepted! Sort out a time and place with them, then check in when you meet," plus the bonus on offer. Shown to both pairs.
2. **Check in:** "WE'RE HERE", with the 5-digit code on **scoreboard-style flip tiles**, a countdown ring until the code refreshes, and "Read this to Huy or Jason".
3. **Score:** an **umpire's flip scoreboard**, one big flip card per pair in its corner colour, with − / + buttons. It checks the score is valid as you go ("✓ Valid score · win by 2 · 30 caps it") and marks the winners with a sticker. **Send to Huy & Jason** to confirm.
4. **Victory:** sunburst, feather-and-confetti burst, a tilted **VICTORY!**, the points counting up ("+5 WP: Win 2 · Giant-killer 2 · New rival 1"), the rank bar filling, then the two questions (keep the pair? throw down again?).
5. **Good game** (the other pair): a calm steel-toned screen with a 🤝, "Good game!", the reminder that losses never cost points, any bonus they still earned, their rank bar, and a suggested **next rival**. It's encouraging, never a defeat screen. This matters most for keeping the community healthy.

### 10.5 Motion (all skipped with "reduce motion")

| Moment | Motion | With reduce motion |
|---|---|---|
| Versus | The halves slide in from opposite sides, the VS slams in and settles (~600 ms) | Still split screen |
| Throw down button | A small bounce every few seconds | Still |
| LIVE | Pulsing dot; a shuttle flies along the arc | Still dot and shuttle |
| Crown | Rays turn slowly | Still rays |
| Check-in code | Tiles flip in one after another | Shown at once |
| Score | The flip card flips on +/− | Number changes |
| Victory / rank up | Confetti and feathers once, WP counts up | Fade in, final number |

- Motion is CSS only, with no animation library; confetti is a few SVG shapes.
- Nothing loops on the Victory screen; the confetti plays once.
- Every effect runs inside `@media (prefers-reduced-motion: no-preference)`.

### 10.6 Making it real

- The page has its own `arena.module.css` with the night-court palette as local variables, so none of it leaks into the rest of the site.
- Fight cards, the versus screen and the flip tiles are small client components.
- Images: none beyond the rank icons (inline SVG). Floodlights, court lines, halftone and rays are CSS gradients and inline SVG, so the page stays as light as the leaderboard.
- Check for every screen: 16 px icons, contrast on coral, teal and yellow, phone and desktop screenshots, and a run with reduce motion on.

---

## 11. Data model (new tables in `lib/challenge-db.ts` and `lib/ranks-db.ts`, `ensure*Tables()` pattern)

```
pairs                 id, player_low_id, player_high_id, name, formed_at,
                      ended_at, ended_reason (unpaired|repaired|declined_after_match|account_deleted)
pair_members          pair_id, player_id, active BOOLEAN   -- partial UNIQUE (player_id) WHERE active
match_codes           id, purpose (pair|checkin), code_hash, owner_player_id, challenge_id NULL,
                      expires_at, consumed_at, consumed_by, attempts
challenges            id, posting_pair_id, accepting_pair_id NULL, note, available_until,
                      status (open|accepted|live|awaiting|completed|disputed|void|expired|cancelled|lapsed|retired),
                      posted_at, accepted_at, checked_in_at, completed_at
challenge_scores      challenge_id PK, posting_score, accepting_score, winner_pair_id,
                      entered_by, entered_at, confirmed_by, confirmed_at, auto_confirmed,
                      disputed_by, disputed_at, dispute_note
challenge_results     challenge_id, player_id, pair_id, won, base_points,
                      bonus_giant_killer, bonus_new_rival, bonus_streak, bonus_crown,
                      points_for, points_against, played_on        -- one row per player
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
  - 1 × each verified, not-removed `attendance` row;
  - `rr_results.rr_points` (through `players.minigame_name`);
  - `challenge_results` base points plus bonuses.

  `player_ranks` is just a cache, rebuilt whenever results change (the moments that already call `revalidateTag("leaderboard")`), plus a daily cron for tarnish and Wolf seats.
- Ranks, thresholds, tarnish and bonus rules are **pure functions in `lib/ranks.ts`**, unit-tested like `lib/stats-periods.ts`.
- "One active pair per player" is a partial unique index, so two confirmations at the same moment can't both succeed.
- Challenge state changes are a single conditional `UPDATE … WHERE status = '<expected>'`, so two pairs can't accept the same challenge.
- Codes: 5 digits, unique among live codes for the same purpose, stored hashed, 2-minute expiry, **5 wrong tries per 10 minutes per player**.

---

## 12. Notifications

| Event | In-app | Web Push (opt-in) | Email |
|---|---|---|---|
| Someone wants to team up / your challenge was accepted / called off | ✓ | ✓ | – |
| Score needs your confirmation | ✓ (tab badge) | ✓ | – |
| Rank up / Wolf seat won or lost / crown won or lost | ✓ | ✓ | – |
| Rank tarnishing (day 60) | ✓ | ✓ | ✓ (rare; one email) |
| Score disputed or voided | ✓ | ✓ | ✓ |

Web Push is free, but on iPhone it works only once the app is added to the Home Screen (iOS 16.4+). It needs VAPID keys (two new env vars) and a `push` handler in `public/sw.js`. Email is kept for rare events, to stay well under Resend's 100/day.

---

## 13. Delivery plan (one PR per phase)

The rank ladder can go live **before** challenges, because attendance and round robin data already exist.

| Phase | Scope | Depends on |
|---|---|---|
| **1. Wolf Points, ranks & art** | `lib/ranks.ts`; `player_ranks`, `rank_events`; `<RankIcon>` from the draft art; rank card, kit bag, rank-up card and share image; Wolf Points leaderboard tab; dry run and calibration on Admin → Players; daily cron for tarnish and seats | – |
| **2. Pairs** | `pairs`, `pair_members`, `match_codes`; Team up (show code / enter code / both confirm); pair card; unpair | – |
| **3. Challenges** | `challenges`, `challenge_scores`, `challenge_results`; **The Arena** (`/challenges`) with fight cards, versus screen, flip-tile check-in, flip scoreboard and Victory / Good game screens (§10); post, accept, call off, expire, lapse; code check-in; score entry with BWF validation, confirm and auto-confirm; after-game prompts; caps; Admin → Challenges; Challenges leaderboard tab | 1, 2 |
| **4. Bonuses, crowns, achievements, seasons** | The four bonuses; `crown_holds`, `achievements`; season badges and champion; feed shout-outs | 3 |
| **5. Notifications & extras** | Web Push; rank icons on the court board; API, webhooks and MCP additions | 3 |

**Verification each phase:**
- `next build` and lint;
- `node --test` units for thresholds, tarnish timing, league floors, seat assignment, each bonus rule, the caps, BWF score validation, code expiry and attempts, and challenge state transitions;
- a Playwright run with two browser contexts acting as two players (team up, post, accept, check in, score, confirm);
- phone and desktop screenshots, including the icons at 16 px on cream and navy.

---

## 14. Risks

- **Games away from the club:** the code check-in, the 8-minute minimum, opponent confirmation, the caps and the dispute queue are what keep results honest.
- **Attendance vs results:** at 1 WP per play day, results drive most of a rank. The dry run shows the split per player.
- **Small pool:** with ~40 active players, a few strong pairs could hold the crowns. New rival and Giant-killer reward everyone else for mixing and challenging up, and Pack Leader goes to whoever plays most.
- **No in-app coordination:** players who don't already know each other need another way to connect (the club's existing group chats). That's by design.
- **iPhone push only after install:** players who use the site in Safari rely on the in-app badge.

---

## 15. Open questions (defaults in brackets)

1. Can someone who speaks Vietnamese check the **VI rank names**?
2. **Thresholds:** fine to tune after the dry run, aiming for nobody in Legend Kit on launch day? [yes]
3. **Draft art:** happy with the direction in `challenge-graphics/preview.png`? Anything to change (e.g. the Legend Kit ribbon, the wolf heads)?
4. **The Arena:** happy with the night-court look, the coral/teal corners and the page name "The Arena" (VI "Đấu Trường")? [yes]
5. One current partner per player, or several pairs at once? [one]
6. Optional **pair names**, with a word filter? [yes]
7. One open board, or separate men's / women's / mixed? [one open board]
8. Auto-confirm an unconfirmed score after 24 h? [yes]
9. Caps: same matchup once a day and 3 times in 30 days; 4 challenges per player per day? [yes]
10. **Retired / couldn't finish** gives the opponents the win (2 WP, no bonuses), unless an admin voids it for injury? [yes]
11. Availability options when posting: today / 3 days / 7 days? [yes]
12. Crown names: Crown pair / Pack Leader / Season champion, or something more Three Wolves? [as listed]
13. A line in the terms that challenge games outside club sessions are arranged by the players, not run by the club? [yes]
14. Season finale: any physical prize from the club? [your call]

---

### Sources

- Gunbound ranks: https://urgametips.com/?p=791, https://cf-inc.shapes.inc/fandom/gunbound/ranking-system (fan pages; exact thresholds and seat counts aren't officially documented)
- League of Legends tiers and decay: https://support-leagueoflegends.riotgames.com/hc/en-us/articles/4405783687443
- Strava Local Legends: https://www.cyclingnews.com/news/how-local-legends-are-made-on-strava, https://dcrainmaker.com/2020/06/strava-legends-feature.html
- Duolingo leagues: https://duolingo.deconstructoroffun.com/mechanics/leagues
- Challenge ladder conventions: https://skedge-web.web.app/help/running-a-ladder, https://skedge-web.web.app/blog/run-a-tennis-ladder
- DUPR match validation: https://dupr.com/post/ensuring-fair-play-the-importance-of-match-validation-on-dupr
- Playtomic levels: https://playerhelp.playtomic.com/hc/en-gb/articles/43310980754193-How-the-Playtomic-level-system-works
- Rating manipulation handling: https://support.chess.com/en/articles/8639319-how-does-matchmaking-work-in-live-chess
- Rank icon sets (shape per tier, consistent line weight, small-size legibility): https://layerlab.itch.io/2d-tier-icon-pack-1, https://roblox-icon-pack-ranks.pages.dev/
- WCAG 1.4.1 Use of Color: https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-without-color, https://alphagov.github.io/wcag-primer/sc/1.4.1.html
- Web Push on iOS: https://documentation.onesignal.com/docs/web-push-for-ios
- Versus screens: https://giantbomb.com/wiki/Concepts/Versus_Screen, https://ssbwiki.com/Versus_splash_screen, https://www.tvtropes.org/pmwiki/pmwiki.php/Main/VersusCharacterSplash
- Challenge lobbies and gamified sports apps: https://contra.com/p/oPBOq2YF-fantasy-football-predictor-app-design, https://geekvibesnation.com/leveling-up-the-viewing-experience-how-live-sports-apps-are-borrowing-video-game-mechanics-to-engage-fans/, https://docs.viewlift.com/docs/configure-matchup-cards
- Reduced motion: https://developer.mozilla.org/en-us/docs/Web/CSS/Guides/Media_queries/Using_for_accessibility, https://primer.style/accessibility/design-guidance/motion-and-animation, https://digitalthriveai.com/en-ca/resources/web-design/write-code-get-confetti/
