# Phase 3b runbook: junior accounts

Build plan §6.8, decision V. Test plan §3.17, journey J1, gate "3b Junior accounts".

**The rule for all of it: shipped dark.** The Juniors module is off, Three Wolves does not enable it, and no real child's profile is created in production. Everything is tested with made-up children on test databases and previews. Existing adults must see no change, and each step proves it with the characterisation check.

## Status

| # | Step | State |
|---|---|---|
| 1 | Data guard counts junior profiles as people; tables for a junior's bookings and attendance (migration `0012`) | Built and rehearsed (18 accounts, 0 problems). **#119 merged 25 Nov 00:46 UTC; confirm whether `0012` has run on production.** Merged code expects the tables (drift, `verify.mjs`, the row-level security heartbeat), and running `0013` would also run `0012` (audit C0) |
| 2 | `juniors` and `forms-waivers` modules; switching Juniors on needs an owner, a fresh sign-in check and the safeguarding policy acknowledged | **Built** (25 Nov, lane J): both modules are in the registry, hidden; the switch-on guard and its page are tested. Nothing can switch it on in production (§2a) |
| 3 | Guardian side: a "Family" section, adding a child, consent | **Built** (26 Nov): the library, four app endpoints, the Family screen in the players' app, and two end-to-end journeys (§2b). Not built: inviting a second guardian |
| — | The audit's "Migration 0012 details" (migration `0015_junior_details`) | **Done** (26 Nov): rehearsed on a copy of production and run in production by lane T (19 accounts, 0 problems, as reported through the coordinating thread), then merged (#178) (§2c) |
| 4 | Waivers, emergency contacts, encrypted medical notes | **Part built** (26 Nov): the tables and the library for emergency contacts and encrypted medical notes, with tests (migration `0016_junior_care`, additive, rehearsed locally; lane T numbers and runs it). A note is encrypted before it reaches the database; the guardian writes it; on the club's side only an owner reads it until safety-checked coaches exist (step 6). Waivers: the tables and library are built with tests (migration `0017_club_forms`, additive, rehearsed locally): a club publishes a form, new wording is a new version that asks every guardian again, a guardian signs for a child by typing their name, a signature is never edited. Not built: the screens for signing (app) and for publishing (admin, with step 6) |
| 5 | Booking and paying for a child | **Booking built** (26 Nov): the shared place-count helpers (#202) and the child-booking library (#203) are merged; the app's three booking endpoints and the "Play days" part of the Family screen are in review (journey APP54). At a club that charges, the screen says paying in the app isn't available yet and nothing can be booked unpaid. Not built: paying, which is the next PR and needs your OK before it merges |
| 6 | Club side: junior roster, coach safety checks, who may see what | Not started |
| 7 | A guardian exports and deletes a child's data | Not started |
| 8 | Growing up at 16 | Only if 1 to 7 are solid |

## 1. How a junior is stored (plan change)

**Decision: a junior's profile and everything a junior does live in tables of their own.** `junior_profiles` (from Phase 3) holds the child: a name, a birth year, a club, no email, no phone. A child's bookings and attendance go in `junior_bookings` and `junior_attendance`, which point at the profile. The existing tables are not touched.

Why not put a child's rows in the existing `bookings` and `attendance` tables, with a column naming the child:
- Those tables are keyed by an account's email (`bookings.email` is required; a day's attendance is one row per email). A child has no email. Using the guardian's would collide the day a guardian and a child, or two siblings, play together.
- Everything that reads those tables (stats, boards, the calendar, reminders, exports) treats a row as an adult who can be emailed and shown. Each would need a "not a child" condition, and one missed condition is a child on a public board or a reminder sent about the wrong person.
- With separate tables the three hard rules hold by construction: a junior **can't sign in** (no account), **is never emailed or texted** (no address anywhere), and **is never public** (no existing query reads the rows).
- It keeps this work out of the read paths under shadow comparison for Phase 3's step 11.

Why not make a child a non-login row in the accounts table: it breaks what that table means everywhere (unique email, sessions, phone, the admin Players list, emails, Stripe customers, exports), and each of those would need a guard.

The one shared thing: a child's booking takes a place on the play day, so booking and cancelling update the day's count of places through the existing code. That is a write, not one of the compared reads. It arrives with step 5.

**The data guard counts each junior profile as a person.** Their id in reports is `junior:<number>`. Their rows are checked one child at a time, exactly like an account's, so losing one child's attendance names that child. New checks: a profile that disappears (`DEPENDENT_MISSING`) or is deleted (`DEPENDENT_DELETED`), and a child left with no guardian (`DEPENDENT_WITHOUT_GUARDIAN`), because then nobody could see, manage or delete that child's data. Reports say "18 accounts checked" as before while there are no juniors, and "18 accounts and 2 junior profiles checked" when there are.

## 2. Step 1: migration `0012_junior_activity` (one production step, additive)

| Part | What |
|---|---|
| `junior_bookings` | The child, the play day, **the guardian who booked and pays**, the payment, the amount in the currency's smallest unit with its currency, the status. One live booking per child per day |
| `junior_attendance` | The child, the play day, who marked it |
| Same club, enforced by the database | A child's booking or attendance can't be written under another club, even by the owner connection |
| Club-owned from day one | `tenant_id` named by the app (no default), foreign keys `ON DELETE RESTRICT`, row-level security enabled and forced, listed in `packages/db/tenancy.ts`, covered by the isolation suite |

No row changes. Nothing in the app reads or writes these tables yet.

**Rehearsal (24 Nov), on `rehearsal-phase-3`, reset to a fresh copy of production:** data guard 18 accounts, 0 problems; 3.3 s; adults' views identical; no drift; verify consistent. Report: `docs/rehearsals/2026-11-phase3b-junior-activity.md`.

**Production run, done 26 Nov 2026, 00:44 UTC** (by lane T's session, approved by the owner; `--to 0012`, so `0013` ran separately afterwards): restore point `pre-phase-3b-junior-activity`; 3.3 s; data guard 19 accounts, 0 problems; no drift; verify consistent, row-level security on 61 tables. Rehearsed again the day before on a fresh copy of production. The record is in the Phase 3 runbook §13.2. What follows is how it was prepared.

```bash
# 1. Restore point: a Neon branch from main, now. Name: pre-phase-3b-junior-activity
cd apps/web
export POSTGRES_URL='<production direct connection string>'
export PRODUCTION_DATABASE_HOSTS='ep-shiny-rain-a76n3kg6.ap-southeast-2.aws.neon.tech'
pnpm data-guard snapshot --out .data-guard/prod-before.json
pnpm db:migrate --production
pnpm data-guard snapshot --out .data-guard/prod-after.json
pnpm data-guard diff .data-guard/prod-before.json .data-guard/prod-after.json \
  --expect scripts/data-guard/expectations/2026-11-phase3b-junior-activity.production.json
pnpm db:drift
node --import ./tests/register.mjs scripts/tenants/verify.mjs
# 2. Merge the pull request.
```

**Rollback:** in the rehearsal report.

## 2a. Step 2: the modules and the switch (no data step)

**Two new modules, both hidden platform-wide.** `forms-waivers` ("Forms & waivers") and `juniors` ("Juniors", which needs Forms & waivers). Hidden means: not listed on Admin → Settings → Modules, refused by the ordinary switch and by the platform's lock, not part of Three Wolves' list, and never counted as on when the club's switches can't be read. They have no rows in `tenant_modules`, and a missing row reads as off.

**Juniors fails closed.** Every other module counts as on when the switches can't be read, so a database problem never turns a club's features off. Juniors is the opposite: `juniorsOn()` (`apps/web/lib/juniors/module.ts`) answers yes only when the club's row says on, an owner's acknowledgement is stored beside it, and the deployment offers Juniors. Anything else, an error included, is off. Every junior endpoint and page asks there.

**Switching it on** (Admin → Juniors → Set up, `/admin/juniors/setup`) needs all three:

| Needed | How it is checked |
|---|---|
| An owner of the club | The person's role in this club is `owner`. An admin, a coach, an owner of another club and Luvallplay staff are refused: the acknowledgement is the club's own |
| A fresh sign-in code | The session was created in the last 5 minutes; otherwise the page sends the owner to enter a new code and brings them back. (Lane J's own check until the admin's per-action step-up, audit H8, is on `main`; then it calls that) |
| The safeguarding policy acknowledged | Six plain statements, version `2026-11` (`apps/web/lib/juniors/safeguarding-policy.ts`), with a tick box. The version, who ticked and when are stored with the switch, and the audit log records it. A new version asks the club again; Juniors stays on meanwhile |

Forms & waivers is switched on with it, in the same statement. Switching Juniors **off** needs an owner or Luvallplay staff and nothing else (off is the safe direction): it hides everything, keeps every child's data, and removes the acknowledgement, so switching on again always asks again.

**Why nobody can switch it on in production yet.** The page and the guard read whether the deployment offers Juniors. In production that is the manifest's word alone (`hidden`), so the page answers "not found" and the guard refuses, for owners too. On test databases and previews `JUNIORS_AVAILABILITY=available` opens it. Opening it in production is a one-line change to the manifest that will come to you as its own pull request, after the safeguarding review.

**Tests:** `apps/web/tests/juniors-module.test.ts` (who may switch, each refusal, fail closed, another club untouched, switching off keeps data), plus the registry, route and enforcement suites.

## 2b. Step 3, first part: a guardian's family (no data step)

`apps/web/lib/juniors/family.ts` is what every Family endpoint will call.

| Rule | How it is kept |
|---|---|
| A child is a name and a birth year in one club | A name that looks like an email address, a phone number or a link is refused. Birth year: under 16 by the club's calendar year |
| Only a guardian, only in the child's club | Every read and write names the guardian and the club and goes through `guardianships`; tested as another guardian, another club, and as the app's own database role |
| A child never exists without a guardian | The profile and the guardianship are written by one statement, after "I am this child's parent or legal guardian" is confirmed |
| Nothing about a child is shown unless a guardian says so | Three items, each off until switched on and dated when changed: the club's board (first name and initial), photos, match video. With two guardians both must agree |
| Limits | 8 children per guardian; the same child can't be added twice |

**The app's endpoints** (`family.list`, `family.add`, `family.update`, `family.consent`; contract files `packages/api/src/endpoints/family.ts` and `schemas/family.ts`). Additions only: the contract check reports the released endpoints unchanged. Each handler asks the fail-closed switch again (`juniorsClubId`) before touching a child's data, so a club with Juniors off answers 404 whatever the app believes.

**The Family screen** (`apps/app/src/screens/Family.tsx` and `screens/family/`, address `/family`). A row in My profile for each club that has Juniors on, and nothing for a club that hasn't: Three Wolves' members see no change. The guardian adds a child (name, year of birth, the confirmation, and the three optional items, all off), corrects the details, and switches each item on or off. Its words are a `juniors` namespace in `packages/i18n`, English and Vietnamese (the Vietnamese needs a native review).

**Journeys** (`apps/app/tests/e2e/app.mjs`): APP52, Juniors off as every club is today (no row, 404s, a hand-written switch without an acknowledgement is still off); APP53, a made-up guardian adds a made-up child, is refused an email address as a name, switches photos on, corrects the name, and another person can neither see nor change the child; no account is created for the child.

Outside lane J's directories, for lane N to see: one route line in `apps/app/src/router.tsx` and five lines in `screens/Profile.tsx` (the row), and one line in the journeys' set-up so the test server offers Juniors.

Not built yet: inviting a second guardian; the rest of journey J1 (waiver, paying, the roster, export and delete) arrives with steps 4 to 7.

## 2c. The audit's "Migration 0012 details": migration `0015_junior_details` (one production step, additive)

| Audit finding | Fix |
|---|---|
| `junior_attendance` has no link to its play day and no check on `source` | A foreign key to the club's play day; `source` is `roster`, `coach` or `admin` |
| Nothing ties `booked_by_user_id` to a guardianship | A foreign key: whoever booked is (or was) a guardian of that child, in that club |
| `guardianships` is platform-wide, so the app's database role could write one for any club | `tenant_id` (named by the app), tied to the child's club, row-level security enabled and forced, moved to the club-owned list in `packages/db/tenancy.ts` |
| `junior_profiles.guardian_user_id` duplicates `guardianships` | `guardianships` is the one source of truth. The column stops being required and is no longer written or read; dropping it is a later, separate step |
| A duplicate `(tenant_id, id)` index | Dropped (the unique key covers it) |
| The data guard counts a soft-deleted guardian as a guardian | A guardian counts only while their account is live and their guardianship hasn't ended |

**New: `guardianships.ended_at`.** A guardian who steps away keeps their row, so what they booked and agreed to keeps its history; only a row that hasn't ended gives access.

Every table touched is empty in production. Report: `docs/rehearsals/2026-11-phase3b-junior-details.md` (local Postgres 18 so far). **The rehearsal on a copy of production and the production run are not done:** they are booked through the coordinator, after `0012` and `0013`, and the production run waits for your go-ahead like every data step.

```bash
# After the rehearsal on a fresh copy of production has passed, and with your go-ahead:
# 1. Restore point: a Neon branch from main, now. Name: pre-phase-3b-junior-details
cd apps/web
export POSTGRES_URL='<production direct connection string>'
export PRODUCTION_DATABASE_HOSTS='ep-shiny-rain-a76n3kg6.ap-southeast-2.aws.neon.tech'
pnpm data-guard snapshot --out .data-guard/prod-before.json
pnpm db:migrate --production
pnpm data-guard snapshot --out .data-guard/prod-after.json
pnpm data-guard diff .data-guard/prod-before.json .data-guard/prod-after.json \
  --expect scripts/data-guard/expectations/2026-11-phase3b-junior-details.production.json
pnpm db:drift
node --import ./tests/register.mjs scripts/tenants/verify.mjs
# 2. Merge the pull request.
```

## 2d. Step 5, agreed shape (not built yet)

Agreed with the coordinating thread on 25 Nov; each shared change is its own `[lane J]` pull request and needs your OK before merging, because it touches booking and payments.

- **A child's booking takes a place through the same counter as an adult's.** `lib/db.ts` gets two small helpers taken out of today's code (`claimSessionSpot`, `releaseSessionSpot`), after lane H's replay fix (#167) is on `main`. Adults' behaviour must be provably unchanged (the golden master and booking tests pass untouched). Lane H reviews.
- **`lib/juniors/bookings.ts`** (lane J): the child's booking row first, then the place, in one transaction, so a full day or a repeated payment event can never count twice.
- **Paying:** a new payment type `junior` through the payments interface, and one thin branch in the Stripe webhook that calls into `lib/juniors`, after lane W's payments-interface work lands. Lane W reviews.
- **Rosters and headcount emails don't name children until step 6.** A booked child takes a place on the day, and the play-day page shows a count ("+2 juniors"), but the existing roster, headcount emails and stats read adults' bookings only and stay that way. Children are named only on the junior roster (step 6), which is limited to the people who need it.

**Built so far (26 Nov).** `apps/web/lib/db.ts` exports `claimSessionSpot` and `releaseSessionSpot` (#202; the adults' functions call them, same statement). `apps/web/lib/juniors/bookings.ts`: `bookChild` (the child's row first, then the place, one transaction; a repeat changes nothing; a full day writes nothing), `cancelChildBooking` (any current guardian; the place comes back in the same transaction), `listChildBookings`, and `juniorCounts` (a count per play day, never a name). Tests: `tests/session-spot.test.ts`, `tests/juniors-bookings.test.ts`. Nothing calls the library yet.

## 3. Decisions waiting for you

| # | Question | What I'll build unless you say otherwise |
|---|---|---|
| 1 | Who may read a child's medical notes? | Owners, and coaches assigned to juniors who have a valid recorded safety check. Admins see the roster and emergency contacts, not medical notes |
| 2 | What does a junior's session cost? | The club's casual price, with a junior price the club can set in the Juniors module |
| 3 | May Luvallplay staff switch Juniors on for a club? | No. Only an owner of that club can, because the safeguarding acknowledgement is the club's own promise. Staff can switch it off or lock it off |
| 4 | How fresh must the owner's sign-in code be to switch Juniors on? | 5 minutes |
| 5 | The safeguarding policy's wording (six statements, in §2a's file) | My draft, in English and Vietnamese. It needs the safeguarding review and counsel before any real child's profile exists; the Vietnamese needs a native review |
| 7 | What may a guardian allow for a child, and what is the default? | Three items, all off until the guardian switches one on: the club's board (first name and initial only), photos, match video. With two guardians both must agree |
| 8 | How many children can one guardian add? | 8 |
| 6 | Does Juniors need Forms & waivers? | Yes: switching Juniors on switches Forms & waivers on too, since a guardian signs the club's consent forms and waivers for each child (step 4) |

## 4. Check with counsel (not claimed as done)

- **Check:** NZ Children's Act 2014 safety-checking duties for people who work with children. The app records that a check exists and when it expires; it does not perform or verify one.
- **Check:** NZ Privacy Act 2020 for children's information.
- **Check:** app-store policies on apps used by or about children, before any store submission (Phase 5).
- Vietnam's rules on children's personal data apply before any Vietnamese club uses the module (not in scope now).
