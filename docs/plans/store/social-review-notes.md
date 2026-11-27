# Social: notes for the store reviewers (lane S)

Text for **App Store Connect → App Review Information → Notes** and **Play Console → App content → App access** (and the "Notes" box of a release). The owner pastes it; nothing here is submitted by CI. It sits beside lane N's listing pack ([`docs/store/`](../../store/README.md)) and covers Social only.

**Before pasting, check every line against the build being submitted.** Written 27 Nov 2026, when the rules, the tables, reports, blocks, profiles and follows were built (Social plan Tasks 1–3) and the feed, the API, account deletion, the review queues and the app screens were not (Tasks 4–8). A line about something that didn't ship must come out: a review note that describes a feature the reviewer can't find is a rejection under 2.1.

Blanks to fill are marked `[[like this]]`. Items marked **OWNER** are settings or decisions only the owner has.

## What to fill in first

| Blank | Where it comes from |
|---|---|
| `[[demo email]]`, `[[demo sign-in code]]` | The review demo account (build plan §4.3, "2.1 Completeness"; lane N). **OWNER**: it is a production sign-in setting |
| `[[review demo club]]` | The demo account's club. Its id is the first entry of `SOCIAL_PILOT_TENANTS` in the deployment the review build talks to. **OWNER** |
| `[[safety contact]]` | The value of the setting `SAFETY_CONTACT_EMAIL`. One address, read by a person. The same address goes in Play Console → App content → Child safety, and it is what the app shows in Settings → Help and what `/safety/child-safety` on luvallplay.com shows. **OWNER** (gate Z: the named moderator) |
| `[[standards page]]` | `https://luvallplay.com/en/safety/child-safety` once the site is live at that address. **OWNER CHECK** the live URL |

## The taps: to confirm against the built screens (Task 8)

These are the plan's paths. Walk them on the review build and correct the wording before pasting.

- [ ] Discover → Social → **Join** (display name, who can see me, "I'm 18 or older", "I agree" to the community rules)
- [ ] The **⋯** menu on a post, a comment and a profile → **Report** (a reason, then optional details) and **Block**
- [ ] Join screen → **Community rules**; also reachable later from Social (route `/discover/social/rules`)
- [ ] Settings → **Blocked people** (the list, with Unblock)
- [ ] Settings → Help → **Report a safety concern** (shows the safety contact)
- [ ] Settings → **Delete account** (two taps, as today)

## Notes to paste (English)

> **Social (user-generated content)**
>
> Luvallplay has a social section for adult players: a profile, follows, a feed of match results, rank-ups, photos and short posts, with kudos and comments. It has no private messages.
>
> **Where it is live.** Social is switched on club by club. It is live for our pilot clubs only, and the demo account's club, [[review demo club]], is one of them, so everything below works with the demo account. Players in other clubs don't see Social at all until their club is added. Nothing in this build is dormant or unlocked by a hidden switch.
>
> **To reach it.** Sign in with [[demo email]] and the code [[demo sign-in code]]. Open Discover → Social and tap Join. Joining asks for a display name, who can see you, a confirmation that you are 18 or older, and agreement to the community rules. The feed already holds posts from other demo players.
>
> **Adults only.** Nobody can join Social without confirming they are 18 or older; the confirmation is stored with its time. Children never have a sign-in in Luvallplay: a junior's profile is managed by a guardian's account and can't join Social. The age rating is set to match (17+).
>
> **Terms.** The community rules must be accepted before joining and can't be skipped. They forbid objectionable content and abusive behaviour, with no tolerance for it. When the rules change, everyone is asked again.
>
> **Filter.** Text is screened before it is saved (English and Vietnamese, with or without accents, and letter-for-number spellings). Clearly abusive text is refused; borderline text is held for a moderator and isn't shown to others meanwhile. Every photo goes through an automated image check before it can appear in a post; a photo the check is unsure about is held for a person to look at.
>
> **Report.** Every post, comment and profile has a ⋯ menu with Report. Pick a reason, add details if you want, send.
>
> **Block.** The same menu has Block. It works both ways and at once: neither person sees the other's profile, posts or comments, and neither can follow the other. Blocked people are listed in Settings → Blocked people.
>
> **Acting on reports.** Reports are answered within 24 hours. Reports about child safety, sexual content, self-harm, violence or hate go to Luvallplay's own moderators and are answered within 12 hours. A moderator can hide or remove the content and suspend the person in every club. A suspension stays if the person deletes the account and signs up again.
>
> **Contact.** Safety concerns: [[safety contact]], also shown in the app under Settings → Help. Our child-safety standards: [[standards page]].
>
> **Deleting an account** (Settings → Delete account) also deletes the person's social profile, posts, comments, kudos, follows and post photos.

## Play Console: where each piece goes

| Page | What to enter |
|---|---|
| App content → **App access** | "All or some functionality is restricted" → the demo account and code, and the three "To reach it" sentences above |
| App content → **Child safety** (Child Safety Standards policy) | Standards URL: `[[standards page]]`. Contact: `[[safety contact]]`. In-app reporting: Yes (the ⋯ menu → Report → "Child safety"). The questions about complying with child-safety laws and reporting to authorities: **to confirm with counsel** before answering ([`child-safety-process.md`](./child-safety-process.md)) |
| App content → **Data safety** | [`data-safety.md`](./data-safety.md) |
| App content → **Content rating**, **Target audience** | [`age-rating.md`](./age-rating.md) |
| Policy → **User Generated Content** | Covered by the notes above: terms accepted before posting, in-app report and block, moderation, and a way to remove abusive people |

## Which rule each line answers

| Rule | Answered by |
|---|---|
| Apple 1.2: terms with no tolerance for objectionable content | "Terms" |
| Apple 1.2: a method for filtering | "Filter" |
| Apple 1.2: a mechanism to report, and timely responses | "Report", "Acting on reports" |
| Apple 1.2: the ability to block abusive users | "Block" |
| Apple 1.2: published contact information | "Contact" |
| Apple 2.1: a working demo account and data | "To reach it" |
| Apple 2.3.1: no hidden or dormant features | "Where it is live" |
| Apple 5.1.1(v), Play account deletion | "Deleting an account" |
| Play Child Safety Standards | "Contact", the standards page |

## Not in this build (don't mention, don't promise)

- Private or direct messages in Social.
- Profile photos: people are shown by display name and initials only.
- Cross-club challenges, and automatic posts for new gallery photos (deferred; build plan §8 item 3).
- The Marketplace (its own notes come with its plan).

## Open points

- **The response times are published promises.** 24 hours and 12 hours are the plan's numbers; the named moderator and the times are the owner's decision at gate Z. Don't paste them until someone is on the rota to meet them.
- **Real names.** The notes say nothing of real names because Social never shows them: people appear by the display name they chose and a random id.
- **The seeded feed.** "The feed already holds posts" depends on the review demo seed (`apps/web/scripts/db/seed-review-demo.mjs`, the rest of Task 9). If it hasn't run on the review deployment, the feed is empty and that sentence must go.
