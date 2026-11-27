# Play Store listing pack (lane N)

Drafts for Play Console, for the **internal testing** step and the store-and-policy step (build plan §4.5.1, step 5). Nothing here is submitted by CI: the owner pastes it into Play Console.

| File | For | Play Console page |
|---|---|---|
| [`listing-en-AU.md`](./listing-en-AU.md) | Default listing, English (Australia) | Grow → Store presence → Main store listing |
| [`listing-vi.md`](./listing-vi.md) | Vietnamese translation | Same page, add the language |
| [`data-safety.md`](./data-safety.md) | Data safety form answers | Policy and programs → App content → Data safety |
| [`content-rating.md`](./content-rating.md) | IARC questionnaire answers and target audience | App content → Content rating / Target audience |

**Rules these drafts follow**

- They describe only what the Android app does today. If a feature isn't built (Vision passes, Juniors, Find a club), it isn't promised. Update the drafts when that changes.
- Items marked **OWNER CHECK** are facts that can't be known from the repository (a live URL, a Play account setting). Don't submit until each is confirmed.
- Play's limits: title 30 characters, short description 80, full description 4000.
- Vision passes are **not sold in the Android app** until Play Billing exists (§4.5.1 step 5), so the listing never mentions prices or passes. The Vision tracker is described as free during the trial, which ends 28 February 2027: **OWNER CHECK** before then, because a "free" claim must be true on the day the listing is read.
