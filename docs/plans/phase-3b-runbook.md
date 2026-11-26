# Phase 3b runbook: junior accounts

Build plan §6.8, decision V. Test plan §3.17, journey J1, gate "3b Junior accounts".

**The rule for all of it: shipped dark.** The Juniors module is off, Three Wolves does not enable it, and no real child's profile is created in production. Everything is tested with made-up children on test databases and previews. Existing adults must see no change, and each step proves it with the characterisation check.

## Status

| # | Step | State |
|---|---|---|
| 1 | Data guard counts junior profiles as people; tables for a junior's bookings and attendance (migration `0012`) | **Done.** #119 merged 25 Nov; `0012` ran on production 26 Nov 2026, 00:44 UTC (19 accounts, 0 problems) |
| 2 | `juniors` and `forms-waivers` modules; switching Juniors on needs an owner, a fresh sign-in check and the safeguarding policy acknowledged | Not started |
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

## 3. Decisions waiting for you

| # | Question | What I'll build unless you say otherwise |
|---|---|---|
| 1 | Who may read a child's medical notes? | Owners, and coaches assigned to juniors who have a valid recorded safety check. Admins see the roster and emergency contacts, not medical notes |
| 2 | What does a junior's session cost? | The club's casual price, with a junior price the club can set in the Juniors module |

## 4. Check with counsel (not claimed as done)

- **Check:** NZ Children's Act 2014 safety-checking duties for people who work with children. The app records that a check exists and when it expires; it does not perform or verify one.
- **Check:** NZ Privacy Act 2020 for children's information.
- **Check:** app-store policies on apps used by or about children, before any store submission (Phase 5).
- Vietnam's rules on children's personal data apply before any Vietnamese club uses the module (not in scope now).
