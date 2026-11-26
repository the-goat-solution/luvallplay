# Social, Marketplace and encryption layers: the plan set

Three plans, one per subsystem. Each one gives working, tested software on its own. Build them in this order:

| # | Plan | Why this order | Ships to users when |
|---|---|---|---|
| 1 | [Encryption layers](./2026-11-26-encryption-layers.md) | Social seals report details with it, and both rely on its start-up key check. Also closes gaps that exist today (players' phone numbers in plain text, three copies of the sealing code, the session token in the app's offline cache) | Steps 1–3 and 6–7 as soon as merged. Step 4's switch of reads, and step 5 in production, need the owner's OK |
| 2 | [Social](./2026-11-26-social.md) | The moderation tools (reports, blocks, review queue) are shared with the Marketplace | Gate Z passes (build plan §8) |
| 3 | [Marketplace](./2026-11-26-marketplace.md) | Reuses Social's reports, blocks and queue | Gate Z passes |

## How this fits the build plan

- **Decision Z still decides launch.** `docs/plans/luvallplay-build-plan.md` §8 holds Social and Marketplace back until three things are true: enough clubs and players in the region, someone named to moderate, and the country's legal checks written down with counsel. These plans build both features **dark**, the way lane J built Juniors: the modules are `availability: "hidden"`, they stay off unless switched on, and nothing can switch them on in production while the manifest says hidden. Building now and switching on later doesn't conflict with Z. Switching on does, until the gate passes.
- **Decision AQ (owner, 27 Nov 2026): build Social and Marketplace hidden, launch at the gate.** §8.1 said "Nothing is built for social or the marketplace". The first build task of plan 2 adds this line to the build plan's decisions list and to §8.1.
- **A new lane, "S" (Social and Marketplace).** It owns `packages/core/src/social/**`, `packages/core/src/marketplace/**`, `apps/web/lib/social/**`, `apps/web/lib/marketplace/**`, `apps/web/lib/moderation/**`, `apps/app/src/screens/discover/social/**`, `apps/app/src/screens/discover/market/**`, `app/admin/moderation/**`, and the `social`, `marketplace` entries in `packages/modules/src/registry.ts`. The encryption plan belongs to lane H (hardening) and also owns `packages/crypto/**`. The rules in §9.4 apply: migrations are numbered when they merge, one endpoint file per module, each lane writes only its own delivery log.
- **The Discover tab is lane G's** (`apps/app/src/screens/discover/**`, step G5). Social and Marketplace add sub-sections under it and don't touch G's files. If G5 hasn't merged when Social reaches its app task, lane S opens a small `[lane G]` PR that adds an empty Discover shell with a slot for sub-sections, and tells lane G's thread.

## What Apple and Google actually check

App reviewers don't reject an app for "looking AI-built". What they do reject, and what each plan covers:

| Rule | What it needs | Where |
|---|---|---|
| Apple 1.2 / Play User Generated Content policy | Terms users accept before they post, with no tolerance for objectionable content; a filter; report on every item; block a user; act on reports within 24 hours; contact details published in the app | Social tasks 2, 3, 5, 7; Marketplace tasks 3, 6 |
| Apple 4.2 / 4.3 (minimum functionality, spam and templates) | Real features with real content. No "coming soon" screens, placeholder text or empty tabs in the reviewed build | Hidden modules stay hidden in the review build unless seeded and complete; the review pack (Social task 8) |
| Apple 2.1 (completeness) | A demo account that works, seeded data, review notes | Social task 8, Marketplace task 7 |
| Apple 3.1.1 / 3.1.3(e) | Physical goods and real-world services may use Stripe and not in-app purchase | Marketplace has no platform payments in this plan (payment for verified sellers waits on Stripe Connect, audit H5) |
| Apple 5.1.1(v) / Play account deletion | Deleting an account also deletes posts, comments, follows and listings | Social task 6, Marketplace task 5 |
| App Privacy labels / Play Data safety | Declare "user content" (posts, photos, listings) and contact info used for marketplace contact | Social task 8, Marketplace task 7 |
| Age rating | Unrestricted user content needs an honest questionnaire. Social and Marketplace are adults only | Both plans: 18+ confirmation when opting in, juniors excluded |

### Why some apps look AI-built, and the rules that stop it

Reviewers and users notice the same things: identical rounded cards in a column, purple-to-blue gradients, emoji used as icons, "Welcome to your community hub! 🚀"-style copy, empty states with only a cartoon, and every screen laid out the same way. The rules every UI task in these plans follows:

1. **The app's own look, not a new one.** Colours, type, spacing and radius come from `packages/ui` (`tokens.css`, the club theme, Luvallplay's `rally-coral` used only around social moments, build plan §7.1). No new colours, no gradients, no new fonts.
2. **Existing components first.** `apps/app/src/components` (`Dialog`, `Icon`, `LoadError`, `Stage`, `ClubTag`) and the patterns in `screens/inbox` and `screens/arena`. Run `ui-consistency:finding-patterns` before the first UI task and follow its checklist. Run `ui-consistency:verifying` after each UI task.
3. **Icons from `Icon.tsx` only.** No emoji in the interface.
4. **Copy that sounds like the club.** Short, specific, sport-first ("Sam beat Alex 21–17, 21–19", not "New activity!"). Every string goes in `packages/i18n` in English and Vietnamese. Run the `humanizer` skill over new English copy, and have a Vietnamese speaker check the Vietnamese.
5. **Empty, loading and error states that help.** Every empty state says what to do next and gives one button that does it. Loading uses the screen's own layout as the placeholder. Errors use `LoadError`.
6. **Real content in screenshots and review builds.** Seeded matches, names and listings that read like a badminton club's, never lorem ipsum.
7. **A design check with fresh eyes.** At the end of each plan, a screenshot of every new screen in light and dark, on a phone and a tablet, through `ui-design-review:review` and `vectorlab-ux-skills:anti-slop`. Fix what they find before the store build.

## Owner decisions these plans need

1. ~~Confirm the reading of decision Z~~: agreed 27 Nov (AQ).
2. `CONTACT_KEKS`, `CONTACT_INDEX_KEYS` and `MODERATION_KEKS` as production settings (Vercel encrypted environment variables), like `PUSH_KEKS`.
3. When to switch players' email and phone reads to the sealed columns (encryption task 4), and, at least 14 quiet days later, whether to drop the plain columns (not in these plans).
4. Who moderates: a named person and a published response time (gate Z).
