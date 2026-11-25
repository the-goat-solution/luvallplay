# Phase 3b runbook: junior accounts

Build plan §6.8, decision V. Test plan §3.17, journey J1, gate "3b Junior accounts".

**The rule for all of it: shipped dark.** The Juniors module is off, Three Wolves does not enable it, and no real child's profile is created in production. Everything is tested with made-up children on test databases and previews. Existing adults must see no change, and each step proves it with the characterisation check.

## Status

| # | Step | State |
|---|---|---|
| 1 | Data guard counts junior profiles as people; tables for a junior's bookings and attendance (migration `0012`) | Built and rehearsed (18 accounts, 0 problems). **Production step: waiting for your go-ahead** |
| 2 | `juniors` and `forms-waivers` modules; switching Juniors on needs an owner, a fresh sign-in check and the safeguarding policy acknowledged | **Built** (25 Nov, lane J): both modules are in the registry, hidden; the switch-on guard and its page are tested. Nothing can switch it on in production (§2a) |
| 3 | Guardian side: a "Family" section, adding a child, consent | Not started |
| 4 | Waivers, emergency contacts, encrypted medical notes | Not started |
| 5 | Booking and paying for a child | Not started |
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

**Production run: not done. It waits for your go-ahead** (Phase 3b asks before each production data step). Migrate first, then merge.

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

## 3. Decisions waiting for you

| # | Question | What I'll build unless you say otherwise |
|---|---|---|
| 1 | Who may read a child's medical notes? | Owners, and coaches assigned to juniors who have a valid recorded safety check. Admins see the roster and emergency contacts, not medical notes |
| 2 | What does a junior's session cost? | The club's casual price, with a junior price the club can set in the Juniors module |
| 3 | May Luvallplay staff switch Juniors on for a club? | No. Only an owner of that club can, because the safeguarding acknowledgement is the club's own promise. Staff can switch it off or lock it off |
| 4 | How fresh must the owner's sign-in code be to switch Juniors on? | 5 minutes |
| 5 | The safeguarding policy's wording (six statements, in §2a's file) | My draft, in English and Vietnamese. It needs the safeguarding review and counsel before any real child's profile exists; the Vietnamese needs a native review |
| 6 | Does Juniors need Forms & waivers? | Yes: switching Juniors on switches Forms & waivers on too, since a guardian signs the club's consent forms and waivers for each child (step 4) |

## 4. Check with counsel (not claimed as done)

- **Check:** NZ Children's Act 2014 safety-checking duties for people who work with children. The app records that a check exists and when it expires; it does not perform or verify one.
- **Check:** NZ Privacy Act 2020 for children's information.
- **Check:** app-store policies on apps used by or about children, before any store submission (Phase 5).
- Vietnam's rules on children's personal data apply before any Vietnamese club uses the module (not in scope now).
