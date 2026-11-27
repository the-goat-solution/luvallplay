# Age rating with Social on: questionnaire answers (lane S)

The answers that change once Social is in the reviewed build, for **Play Console → App content → Content rating** (IARC) and **Target audience**, and for **App Store Connect → App Information → Age Rating**. Lane N's sheet for the app without Social is [`docs/store/content-rating.md`](../../store/content-rating.md): every answer not listed here stays as it is there. The owner submits, and the person who submits is the one who attests.

**Why the rating goes up.** Social lets adults post text and photos that other people see. It is moderated, but nothing a person writes can be promised in advance, and the feature is for adults only (18+ confirmation when joining, juniors excluded; Social plan, Global Constraints). The rating is set to match that: **17+ on the App Store, Mature 17+ (or 18+ where the board has it) on Google Play.** Don't argue a lower result: an adults-only feature under an "Everyone" rating is the mismatch reviewers look for.

## Google Play: IARC questionnaire

| Question | Answer with Social | Changed from lane N's sheet? |
|---|---|---|
| Category | **Social networking** if Play offers it for an app with a feed, profiles and follows; else "All other app types" with the same answers below | Yes |
| Do users interact or exchange content? | **Yes**: posts, comments, photos, profiles | Wider |
| Is user-generated content moderated? | **Yes**: a text filter, an image check on every photo, report on every item, block, a review queue with 24-hour and 12-hour deadlines | New |
| Can users report content and block other users? | **Yes** (the ⋯ menu on every post, comment and profile). **Check on the build** | Was an OWNER CHECK |
| Can users communicate privately (direct messages)? | **No** in Social. (The club inbox carries messages from the club to its members; answer for that as lane N's sheet does) | No |
| Does the app share the user's location with other users? | **No** | No |
| Unrestricted web access (is it a browser, or can users post links others open)? | **No**. It isn't a browser. **Check on the build (Task 8)** that an address typed into a post or comment is shown as plain text and not made into a link; if it is a link, say so here and re-read Play's definition | No |
| Violence, sexual content, profanity, drugs, gambling, hate in the app's **own** content | **No** to each. The community rules forbid them in what people post, and the questionnaire asks about user content separately | No |
| Digital purchases | As lane N's sheet. Social sells nothing | No |
| Directed at children? | **No** | No |

Expected result: a higher tier than today, carried by "Users interact" and user-generated content. **Take the rating the questionnaire gives. If it comes out below Mature 17+,** don't re-answer to push it up: use Target audience (below) and the store listing to say 18+.

## Google Play: Target audience and content

| Item | Answer |
|---|---|
| Target age groups | **18 and over only** (unchanged) |
| Appeals to children? | No |
| Ads | No ads |
| Families policy | Not applicable. Juniors have no sign-in and can never have a social profile |
| Child Safety Standards (social apps) | Required once Social is in the build: the standards page and contact in [`social-review-notes.md`](./social-review-notes.md) |

## Apple: age rating questions

Apple's wording changed in 2025 (the tiers are now 4+, 9+, 13+, 16+ and 18+ in the new system; older documents and the Social plan say 17+). **To confirm on the day against the form App Store Connect shows:** choose the tier that restricts the app to adults, which the plan calls 17+.

| Question | Answer |
|---|---|
| Cartoon or realistic violence; sexual content or nudity; profanity or crude humour; alcohol, tobacco or drugs; horror; gambling; contests | **None** for each (the app's own content has none) |
| **User-generated content** (in-app controls / capabilities section) | **Yes**. Moderated: filter, report, block, moderators with a deadline |
| **Messaging and chat** | **To confirm with lane N**: the club inbox exists today outside Social. Social itself adds none |
| **Unrestricted web access** | **No** |
| Medical or treatment information | No |
| Age assurance / parental controls | **No**. Joining Social asks for a declaration of being 18 or older. It is a declaration, not a check of a document |
| Made for Kids | **No** |
| Override to a higher rating | **Yes, if the answers give less than the adult tier**: set it by hand to 17+ (18+ in the new tiers) |

## What is true behind these answers

- **Adults only is a self-declaration.** `players` holds no date of birth. `social_profiles.adult_confirmed_at` records when the person said it. Don't answer any question as if age were verified.
- **Juniors** (under 16) are profiles a guardian manages, with no sign-in (build plan §6.8). They can't join Social.
- **Moderation is real only when someone is on it.** The "moderated" answers rest on a named moderator and the response times (gate Z). Until then Social is on for the review demo club only.

## To confirm

- With **lane N**: that `docs/store/content-rating.md` is updated in the same release that puts Social in the build, so the two sheets never disagree.
- With **the owner**: whether the listing should say "18+" in words as well.
- With **counsel**: whether Vietnam asks for an age label of its own (Decree 147/2024; build plan §8 gate).
