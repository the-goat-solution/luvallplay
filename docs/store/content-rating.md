# Content rating and target audience: draft answers

For Play Console → App content → Content rating (IARC questionnaire) and Target audience and content. Answers are for the Android app as built; the owner (not CI) submits them, and the person who submits is the one who attests them.

## IARC questionnaire

**Category:** *All other app types* (not a game, not a social network or dating app). If Play's wording pushes a club-and-sport community app into "Social", choose that, and answer the interaction questions the same way.

| Question | Answer |
|---|---|
| Violence (of any kind, including cartoon) | No |
| Sexual content or nudity | No |
| Profanity or crude humour | No |
| Controlled substances (drugs, alcohol, tobacco) | No |
| Gambling or simulated gambling | **No.** Points and ranks have no cash value and can't be bought. |
| Horror or fear | No |
| Discrimination, hate | No |
| Do users interact or exchange content? | **Yes**: club messages and photos shared with a club. Moderation: report, block and moderation within 24 hours (§4.3, rule 1.2; **OWNER CHECK:** confirm those controls are in the app before answering "report and block available") |
| Does the app share the user's location with other users? | No |
| Does it allow digital purchases? | **No in this build** (passes are hidden until Play Billing exists). Club memberships and session fees are real-world services paid through Stripe. Change this answer when Vision passes ship. |
| Does it let users send unrestricted web access or open links? | The app opens `https` pages in an in-app browser (Stripe's billing page, receipts, a club's website). Answer as Play defines "web browsing": **No**, it isn't a browser. |
| Is it directed at children? | **No** |

Expected result: lowest age tier (e.g. IARC 3+, PEGI 3, ESRB Everyone) with the "Users interact" notice. If the rating differs, don't argue the result down: re-check the answers.

## Target audience and content

| Item | Answer |
|---|---|
| Target age groups | **18 and over only** (§4.5.1 step 5). Don't tick any age group under 18. |
| Appeals to children? | No. Sport clubs, a sign-in by email code, and payments are not child-directed. |
| Ads | No ads |
| Families policy | Not applicable until Juniors is switched on; that needs its own review first (guardian-managed junior profiles). |

## Other App content declarations (same section)

| Declaration | Answer |
|---|---|
| Privacy policy | Required: **OWNER CHECK** the live URL |
| App access (login needed) | **Yes**: provide Play's reviewers a test account with a fixed sign-in code (see plan §4.3, "2.1 Completeness": the review demo account). **OWNER CHECK:** that account must exist before submitting. This is a production sign-in setting, so it is the owner's decision. |
| Government app, financial features, health | No / No (payments are for club fees via Stripe, not a financial service) / No |
| News app, COVID-19 app | No |
| Advertising ID | **No**: the app doesn't use it |
