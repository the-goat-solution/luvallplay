# Website design D ("Rally") — handoff digest

Source: the Luvallplay website design canvas, board **D · Rally — A + C, every module, Vision, layered depth**
(https://claude.ai/artifact/9ZN762cjvaZw7zzJzjzuM5, artboard `89b6cbfe0abf`). The board is 1440 px wide, about 8000 px tall and interactive.
`OptionD.dc.html` is the design's own source (a `<x-dc>` template with a small `DCLogic` script, not production code), and
`tokens.json` is the brand tokens the design was built against (same as the "Luvallplay brand" design system).
Translate it into Next.js components. Don't copy the markup.

## Page structure (anchors in the design)

| Anchor | Section | Notes |
|---|---|---|
| `top` | **Header**: Find a club · What's inside · Vision (NEW chip) · For clubs · EN · VI switch · Get the app | Sticky; collapses on mobile |
| `top` | **Live ticker** of sessions ("LIVE NOW", looping): Friday social · badminton · 14 going; Open play · pickleball; Five-a-side · futsal; Ladder night · tennis | Sample items. Replace with true content |
| `top` | **Hero**: "Your club's favourite night of the week." + one-line promise + *Find a club near you* / *Bring your club*; four photo slots; **live score card** (Court 2, LIVE, animated 0–0 to 21–19 with "love all, play" note); Home mini-card with next play day; "Linh sent you kudos" | The score animation is `setInterval` based and shows 21–19 statically under `prefers-reduced-motion` |
| `top` | **Sports chips**: "Started with badminton. Open to every club that plays regularly." Badminton, Pickleball, Tennis, Futsal, Netball, Volleyball, Squash, Table tennis | Mark anything not live as "coming soon" |
| `features` | **"Everything in your kit bag."**: seven tools in a bento: Sessions and sign-ups (with Tue/Sat cards), Rankings, Challenges, Memberships, Club finder, Social, Marketplace (NEW) | Layered cards (`.d-card`, hover lift) |
| `vision` | **Vision** ("Film your game. See every rally."): phone-behind-the-court story, a video still with an overlay (Rally 14 · 23 shots, highlights), shot-type bars (clear, drop, smash, net), avg and longest rally, a where-you-played court map, four benefits | Vision is real (badminton only for now). The numbers in the design are samples |
| `vision-how` | **App mock** and **how it works**: Home screen mock (next play day, rank #4, Arena challenge) and three steps (Find your people → Book a casual session → Play, score, cheer); App Store and Google Play badges | Store badges only when the app is in the stores |
| `rankings` | **"Climb the ladder at your level."**: this week's movers list | Per club and per sport. Don't show invented players |
| `finder` | **"Who's playing tonight?"**: sport chips, a suburb/city input, club cards, *Book a casual session*, empty state "No clubs for that sport yet. Know one? Invite them to Luvallplay." | Interactive: chips filter, empty state works |
| `clubs` | **For club organisers**: "Bring your club. Keep your colours." + *Start your club* / *Book a walkthrough*; a founding-club quote slot; Three Wolves card (Christchurch · social play twice a week) with stat slots | Quote, member counts and other numbers are placeholders `[…]` in the design |
| `pricing` | **Players: Free** and **Clubs: [YOUR PRICE] / month**, "everything included" | See decisions below |
| footer | "Love all, play." and About · Help · Privacy · Terms | |

## Decisions from the planning thread (24 Nov) that override the sample content

- **Only true, verifiable facts.** No invented members, clubs, quotes, rankings or numbers. Three Wolves plays twice a week in Christchurch and badminton is live; other sports, social and marketplace are "coming soon". Slots stay empty (with a tasteful fallback) until real content exists.
- **Pricing:** Players: Free. Clubs: **"Free for founding clubs"**, with a note that paid plans come later and clubs get notice before any change. No price numbers.
- **English and Vietnamese**, both written natively (see build plan §7.4).
- The "18+" label in the finder cards is sample copy: juniors are supported through guardian accounts (build plan §6.8), so show each club's real audience instead.
- Photos: the design has `Photo: …` placeholders. Use the brand's illustration style or colour-block fallbacks until real, consented photos exist.
