# Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sport-gear marketplace inside the players' app. Players and clubs list items, buyers ask questions in public, a buyer commits, and the seller confirms. Only then do those two people get a button that opens their own email to each other. No messaging and no payments on the platform. Built as a hidden module.

**Architecture:** A global module `marketplace` (`scope: "global"`, `availability: "hidden"`), usable when at least one of the player's clubs has it on and the player has accepted the marketplace rules (18+). Listing rules (banned items, limits, the commitment state machine) are pure code in `@luvallplay/core/marketplace`. Data lives in `apps/web/lib/marketplace`. Reports, blocks and the review queues are the shared `apps/web/lib/moderation` from the Social plan (Task 2), which this plan **depends on**. Listing photos go through the existing upload and image check. Club listings carry a "Club" badge. Taking payment for them waits on Stripe Connect (audit H5) and isn't in this plan.

**Tech Stack:** as the Social plan: Next.js 16 route handlers, Postgres via `Db`, `@luvallplay/api`, `apps/app` (React, TanStack), `node:test`, journeys.

**Spec:** `docs/plans/luvallplay-build-plan.md` §8 item 4 (Marketplace) and decision G; §4.3; §6.7 (per sport); `./2026-11-26-social-marketplace-security-index.md`; `./2026-11-26-social.md` Task 2 (moderation tables and library).

## Global Constraints

- Hidden until gate Z passes (including Vietnam's E-commerce Law checks for VN). `404 module_off` without access. Nothing in the app shows the Marketplace without it.
- **Adults only:** an 18+ confirmation and the marketplace rules (version `"2026-12"`) are accepted once, before the first listing, question or commitment.
- **No messaging on the platform.** Questions and answers are public on the listing. The contact button appears only for the seller and the buyer the seller confirmed. It returns a `mailto:` link, and every reveal is logged.
- **Player listings are unverified:** no payment through the platform, and every player listing shows the notice "Luvallplay doesn't check sellers or items. Meet in a public place and check the item before you pay." in both languages. Club listings (created in Admin by an owner or admin) show a "Club" badge.
- Limits: title 3–80 characters, description ≤2,000, 1–6 photos, price `0` (shown as "Free") to `10,000,000` minor units in the club's currency, at most 20 active listings per player, a question ≤300, an answer ≤600, 20 questions a day per player.
- Listings expire after **30 days**. A seller can renew up to 3 times. Sold and expired listings disappear from browse within a day (daily cron).
- Categories: `racquets`, `shoes`, `clothing`, `bags`, `balls_shuttles`, `strings_grips`, `training`, `other`. Every listing has a `sport` from its seller's club's sports. Conditions: `new`, `like_new`, `good`, `fair`.
- Location is a town or city only, never an address.
- Banned: weapons, drugs and prescription medicine, alcohol, tobacco and vapes, animals, counterfeit goods, adult content, personal data, gift cards and vouchers, tickets above face value. The rule list is data in `packages/core/src/marketplace/banned.ts`, reviewed by the owner and counsel at the gate.
- Blocks from the Social plan apply here: neither person sees the other's listings or questions, and neither can commit to the other's listing.
- Everything in English and Vietnamese (namespace `market`). UI follows the index's design rules. Migration additive, numbered at merge, rehearsed.

## Review Focus

1. **Two buyers commit at the same moment and the seller taps confirm on both.** Exactly one is confirmed; the other is declined; the listing is `committed`. Task 3 test with two concurrent transactions.
2. **The seller edits the price or description after a buyer has committed.** Blocked (`409 committed`) until the seller releases the buyer. The buyer must never be confirmed on terms they didn't see. Task 2 test.
3. **The contact endpoint called by anyone else** (a third player, a declined buyer, a blocked person, the seller after deleting their account) returns `404 not_found` and logs nothing. Task 3 test.
4. **A price typed as "1.234,50" or "$1,234.50"** in the app gives the same minor units (parsed with the club's country pack, `@luvallplay/core/money`) or a clear `price_invalid`. Task 1 test.
5. **A listing whose photo is still `needs_review`** isn't shown in browse until the photo is approved; its seller sees "Waiting for a photo check". Task 2 test.

---

### Task 1: The rules, as pure code

**Files:**
- Create: `packages/core/src/marketplace/index.ts`, `rules.ts`, `banned.ts`, `commitments.ts`
- Modify: `packages/core/package.json` (export `"./marketplace"`)
- Test: `apps/web/tests/market-rules.test.ts`

**Interfaces:**
- Consumes: `screenText`, `cleanText` from `@luvallplay/core/social` (Social Task 1); `@luvallplay/core/money`.
- Produces:
  - `MARKET_LIMITS = { title: [3, 80], description: 2000, photos: [1, 6], priceMax: 10_000_000, activePerSeller: 20, question: 300, answer: 600, questionsPerDay: 20, days: 30, renewals: 3 } as const`, `MARKET_RULES_VERSION = "2026-12"`, `CATEGORIES`, `CONDITIONS`
  - `checkListing(input: ListingInput, ctx: { currency: string; sports: readonly string[] }): { ok: true; value: CleanListing } | { ok: false; errors: ListingError[] }` with `ListingError` one of `title_required | title_too_long | description_too_long | price_invalid | category_invalid | condition_invalid | sport_invalid | photos_required | too_many_photos | banned_item | not_allowed`
  - `parsePrice(raw: string, currency: string, locale: "en" | "vi"): number | null` (minor units)
  - `type CommitState = "requested" | "confirmed" | "declined" | "withdrawn" | "released"` and `nextCommitState(current: CommitState, event: "confirm" | "decline" | "withdraw" | "release"): CommitState | null` (`null` = not allowed)

- [ ] **Step 1: Failing tests:** each `ListingError`; a banned word in title or description gives `banned_item` (with diacritics folded, e.g. "thuốc lá điện tử" and "thuoc la dien tu"); Review Focus 4; every allowed and refused transition of `nextCommitState` (e.g. `requested + confirm → confirmed`, `declined + confirm → null`, `confirmed + release → released`).
- [ ] **Step 2: Run** `pnpm --filter web exec node --import ./tests/register.mjs --test tests/market-rules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run.** Expected: PASS, plus `pnpm --filter "./packages/*" typecheck`.
- [ ] **Step 5: Commit** `feat(market): listing rules, banned items and the commitment states as pure code`

### Task 2: Tables and listings

**Files:**
- Create: `packages/db/migrations/00NN_marketplace.sql`, entries in `packages/db/schema.ts` and `meta/_journal.json`
- Create: `apps/web/lib/marketplace/members.ts`, `listings.ts`, `browse.ts`
- Test: `apps/web/tests/market-listings.test.ts` (database test)
- Docs: `docs/rehearsals/2026-12-marketplace.md`

**Tables** (platform-wide, per region):
- `market_members (player_id PK, adult_confirmed_at NOT NULL, rules_version NOT NULL, created_at)`
- `market_listings (id bigserial, seller_player_id NOT NULL, seller_tenant_id NULL → tenants /* set = club listing */, sport, category, condition, title, description, search_text /* folded title + description */, price_minor CHECK (price_minor BETWEEN 0 AND 10000000), currency CHAR(3), city, status CHECK IN ('active','committed','sold','expired','removed') DEFAULT 'active', renewals SMALLINT DEFAULT 0 CHECK (renewals <= 3), expires_at NOT NULL, created_at, updated_at)`, indexes `(status, created_at DESC, id DESC)`, `(seller_player_id, status)`, `(sport, category, status)`
- `market_listing_photos (listing_id → market_listings ON DELETE CASCADE, position SMALLINT CHECK 1..6, photo_id → the existing photos table, PK both)`
- `market_questions (id, listing_id ON DELETE CASCADE, asker_id, body, answer, answered_at, state CHECK IN ('visible','held','hidden','removed'), created_at)`
- `market_commitments (id, listing_id ON DELETE CASCADE, buyer_id, state CHECK IN (…five…), created_at, updated_at)`, partial unique `(listing_id) WHERE state = 'confirmed'`, partial unique `(listing_id, buyer_id) WHERE state = 'requested'`
- `market_contact_reveals (id, listing_id, viewer_id, created_at)` (append-only; app role can't update or delete)

**Interfaces:**
- Consumes: Task 1; `blockedEitherWay`, `notBlockedSql` (Social Task 2); the existing photo upload and `moderateImage`.
- Produces:
  - `joinMarket(db, playerId, input: { adultConfirmed: true; rulesVersion: string }): Promise<Result<void, "adult_required" | "rules_outdated">>`, `marketAccess(db, playerId): Promise<{ ok: true; clubIds: number[]; member: boolean } | { ok: false; code: "module_off" | "suspended" }>` (a Social suspension also applies here)
  - `createListing(db, sellerId, input: ListingInput & { clubId: number; photoIds: number[] }): Promise<Result<Listing, ListingError | "not_member" | "too_many_active" | "photo_not_found">>`
  - `updateListing(db, sellerId, id, patch)` → `Result<Listing, ListingError | "not_found" | "committed">`; `renewListing(...)` → `"renewals_used" | "not_found"`; `markSold`, `removeListing`
  - `browse(db, viewerId, q: { sport?: string; category?: Category; text?: string; city?: string; before?: string; beforeId?: number }): Promise<{ listings: ListingCard[]; next: Cursor | null }>`: only `active`, not expired, every photo approved, no blocked sellers, no suspended sellers; text search on `search_text ILIKE` of the folded words
  - `getListing(db, viewerId, id): Promise<Result<ListingDetail, "not_found">>`: the seller also sees their own non-active listings
  - `expireListings(db, now: Date): Promise<number>` (for the cron)
  - `type ListingCard = { id; title; priceMinor; currency; city; sport; category; condition; photoUrl; club: { name: string } | null /* club listing badge */; createdAt }`

- [ ] **Step 1: Failing tests:** Review Focus 2 and 5; the 21st active listing → `too_many_active`; a renewal after three → `renewals_used`; `expireListings` moves past-date listings to `expired` and is idempotent; browse never shows a blocked person's listing; a club listing needs the creator to be that club's owner or admin (via `packages/auth`).
- [ ] **Step 2: Run** (fail). **Step 3: Implement.** **Step 4: Run** `pnpm --filter web test` and `db:drift` (pass).
- [ ] **Step 5: Rehearse** the migration on a Neon branch; write the note.
- [ ] **Step 6: Commit** `feat(market): listings, browsing and expiry (migration, library, tests)`

### Task 3: Public questions, commitments and the contact button

**Files:**
- Create: `apps/web/lib/marketplace/questions.ts`, `commitments.ts`, `contact.ts`
- Test: `apps/web/tests/market-deals.test.ts`

**Interfaces:**
- Produces:
  - `ask(db, askerId, listingId, body)` → `Result<Question, "not_found" | "own_listing" | "not_allowed" | "too_long" | "rate_limited">` (held when screening says `hold`); `answer(db, sellerId, questionId, body)`; `listQuestions(db, viewerId, listingId)`
  - `commit(db, buyerId, listingId)` → `Result<Commitment, "not_found" | "own_listing" | "not_active" | "already">`; `withdraw(db, buyerId, commitmentId)`
  - `confirmBuyer(db, sellerId, commitmentId)` → `Result<void, "not_found" | "taken">`: one transaction with `SELECT … FOR UPDATE` on the listing; sets this one `confirmed`, the other `requested` ones `declined`, and the listing `committed`; the partial unique index is the backstop
  - `releaseBuyer(db, sellerId, listingId)` (back to `active`), `declineBuyer(...)`
  - `contactFor(db, viewerId, listingId): Promise<Result<{ mailto: string; name: string }, "not_found">>`: only the seller or the confirmed buyer; builds `mailto:<other person's email>?subject=<"About your listing: " + title, URL-encoded>`; inserts a `market_contact_reveals` row on success only
- Notifications: an in-app inbox item for "someone wants to buy", "the seller confirmed you" and "your question was answered" (through the existing inbox, `lib/message-notify.ts`). Push waits for a new push kind and isn't in this plan.

- [ ] **Step 1: Failing tests:** Review Focus 1 (two `confirmBuyer` calls on separate connections, `Promise.all`; exactly one `ok`) and 3; asking on your own listing → `own_listing`; a commitment to a `committed` listing → `not_active`; releasing puts the listing back in browse; a reveal row is written per successful call and none on refusal.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** `feat(market): public questions, committing to buy and the contact button for the two people only`

### Task 4: The API, the module and the cron

**Files:**
- Create: `packages/api/src/endpoints/market.ts`, `packages/api/src/schemas/market.ts`; wire into `contract.ts`/`schemas.ts`; regenerate the generated files
- Create: route handlers under `apps/web/app/api/v1/app/market/**`; `apps/web/lib/marketplace/app-market.ts`; `apps/web/app/api/cron/market-expire/route.ts` (uses the existing `lib/cron.ts` guard)
- Modify: `packages/modules/src/registry.ts`:

```ts
export const marketplace = defineModule({
  id: "marketplace", scope: "global", group: "global", payments: "none", plan: "free", availability: "hidden",
  name: { en: "Marketplace", vi: "Chợ đồ thể thao" },
  admin: { nav: [{ group: "Club", href: "/admin/marketplace", label: "Club listings", order: 60 }] },
  crons: [{ id: "market-expire", schedule: "0 15 * * *", path: "/api/cron/market-expire" }],
  liveActivity: "active listings and buyers waiting for a reply",
});
```

- Test: API journeys API31–API36

**Endpoints** (`auth: "session"`, `scope: "account"`, access through `marketAccess`):

| Id | Method and path | Rate limit |
|---|---|---|
| `market.me` / `market.join` | GET / POST `/market/me` | 60/min, 5/10 min |
| `market.browse` | GET `/market/listings?sport&category&text&city&before&beforeId` | 60/min |
| `market.listing` / `market.create` / `market.update` / `market.renew` / `market.sold` / `market.remove` | GET / POST / PATCH `/market/listings/{id}`, POST `…/{id}/renew`, POST `…/{id}/sold`, DELETE `…/{id}` | 60/min, 10/hour create |
| `market.mine` | GET `/market/mine` (listings and their commitments) | 60/min |
| `market.questions` / `market.ask` / `market.answer` | GET / POST `/market/listings/{id}/questions`, PUT `/market/questions/{id}/answer` | 60/min, 20/day ask |
| `market.commit` / `market.withdraw` / `market.confirm` / `market.decline` / `market.release` | POST `…/{id}/commitments`, DELETE `/market/commitments/{id}`, POST `/market/commitments/{id}/confirm`, POST `…/decline`, POST `/market/listings/{id}/release` | 20/10 min |
| `market.contact` | GET `/market/listings/{id}/contact` | 20/hour |

Reports and blocks use the Social plan's `moderation.*` endpoints (target types `listing`, `question`).

- [ ] **Step 1: Failing journeys:** API31 join and list; API32 another player browses, asks, and the seller answers; API33 commit, confirm, and only those two get `contact`; API34 a third player gets 404 on `contact`; API35 module off gives 404 `module_off` everywhere; API36 an old app still works (compat snapshot).
- [ ] **Step 2–4:** Run `pnpm --filter web e2e`, implement, run.
- [ ] **Step 5: Commit** `feat(market): the marketplace endpoints, the module entry and the daily expiry`

### Task 5: Deleting an account and downloading your data

**Files:**
- Create: `apps/web/lib/marketplace/data-rights.ts`
- Modify: `apps/web/lib/app-account.ts` (`deleteAccount` calls `forgetMarket(player.id)`), `apps/web/lib/player-export.ts` (`collectPlayerData` adds `marketplace`)
- Test: `apps/web/tests/market-rights.test.ts`

**Interfaces:**
- Produces: `forgetMarket(db, playerId)` (one transaction: player listings → `removed`, their photos queued for blob deletion; their questions deleted; their commitments `withdrawn`; their membership row deleted; reveal rows keep ids only), `exportMarket(db, playerId)`
- Club listings created by a person who then deletes their account stay: they're the club's. `seller_player_id` moves to the club's first owner.

- [ ] **Step 1: Failing tests:** after `forgetMarket` nothing in browse or questions names them; a buyer who'd been confirmed on their listing sees the listing as removed; a club listing stays and moves to an owner; the export has their listings and questions.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** `feat(market): deleting an account removes its listings and questions; the data download includes them`

### Task 6: Admin: club listings and the review queue

**Files:**
- Create: `apps/web/app/admin/marketplace/page.tsx` (a club's owners and admins create, edit, renew and remove the club's listings; see commitments; reveal contact like a seller)
- Modify: `apps/web/lib/moderation/queue.ts` (Social Task 7): `listing` and `question` targets show a preview and link; actions hide or remove a listing. `prohibited_item` and `scam` reports on a listing hide it at once (`state` stays, `status = 'removed'` only after a moderator confirms)
- Modify: `packages/auth` (the `/admin/marketplace` page for owners and admins)
- Test: `apps/web/tests/market-admin.test.ts`; journey APP68 (a club admin lists an item; a player sees the Club badge, commits; the admin confirms and gets the contact button)

- [ ] **Step 1: Failing tests:** another club's admin can't edit this club's listing; a `prohibited_item` report hides the listing from browse immediately and puts it in the queue; restoring brings it back; the audit log names the listing id, never its words.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** `feat(market): club listings in Admin and listings in the review queue`

### Task 7: The app screens and the store pack

Before starting: reuse the `ui-consistency:finding-patterns` checklist from Social Task 8, and look again at `screens/shop` (the club shop's existing cards and prices).

**Files:**
- Create: `apps/app/src/screens/discover/market/Browse.tsx`, `ListingCard.tsx`, `ListingDetail.tsx`, `ListingForm.tsx`, `MyListings.tsx`, `JoinMarket.tsx`, `data.ts`
- Reuse: `components/ReportSheet.tsx`, `components/OverflowMenu.tsx` (Social Task 8), the photo picker (Android Photo Picker, iOS PHPicker, as Profile uses)
- Modify: `apps/app/src/router.tsx` (lazy routes under `/discover/market`), `packages/i18n` (namespace `market`), the review demo seed (a few believable listings: "Yonex Astrox 88D, 4U, restrung in October", "Court shoes, size 42, worn twice"), `docs/plans/store/marketplace-review-notes.md`, the privacy and Data safety answers (listings and photos as user content; email shared with a confirmed trade partner, at the user's action)
- Test: journeys APP69–APP72

**What each screen shows:**
- **Browse:** a two-column grid of photo cards on phones and more columns on tablets, filters for sport and category as a horizontal row, and search. Price first, then title, then town. Empty state: "Nothing listed for {sport} near you yet", with a "List something" button.
- **ListingDetail:** photos, price, condition, the Club badge or the trade-at-your-own-risk notice, then questions and answers, then one primary action that changes with state ("I want to buy" → "Waiting for the seller" → "Contact seller").
- **ListingForm:** photos first, then title, price (with the currency shown), category, condition and description. It saves a draft locally if the app closes.

- [ ] **Step 1: Failing journeys:** APP69 join and list with two photos; APP70 browse, filter, ask; APP71 commit, the seller confirms, and "Contact seller" opens a `mailto:` link; APP72 module off: no Marketplace entry and deep links show not-found.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Verify the look** as in Social Task 8 Step 5 (`ui-consistency:verifying`, screenshots on phone and tablet, light and dark, English and Vietnamese, `ui-design-review:review`, `vectorlab-ux-skills:anti-slop`). Fix every finding marked important.
- [ ] **Step 6: Commit** `feat(app): the Marketplace under Discover, with review notes and demo listings`

---

**After all tasks:** the full CI list. Then dispatch `backend-design:security-reviewer` on the diff (IDOR on listing, commitment and contact ids; races in confirm; the contact endpoint leaking emails) and fix what it confirms. Log each merged task in lane S's delivery log.
