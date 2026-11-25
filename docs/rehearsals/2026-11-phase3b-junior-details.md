# Rehearsal: Phase 3b, the junior tables' details (`0014_junior_details`, number assigned at merge)

- **Change:** the audit's "Migration 0012 details". `guardianships` becomes club-owned (`tenant_id`, row-level security) and gains `ended_at`; `junior_attendance` is tied to its play day and its `source` is checked; whoever booked for a child must be a guardian of that child; `junior_profiles.guardian_user_id` stops being required; a duplicate index is dropped. Every table touched is empty in production. No row changes.
- **Command:** node scripts/db/migrate.mjs
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase3b-junior-details.json`

## Result so far: passed locally. **Not yet rehearsed on a copy of production.**

Local run, 25 Nov 2026, Postgres 18.7 (the version production and CI use), on a database built from the migrations and the synthetic golden seed:

| Check | Result |
|---|---|
| Migration `0014_junior_details` | Applied in 20 ms on an empty schema; applies after `0013` with rows present in a test database (the guardianship takes its child's club) |
| Schema drift suite | Passes: migrations, `packages/db/schema.ts` and `docs/schema/production.sql` describe the same schema. `production.sql` was regenerated from this run |
| Tenant isolation suite | Passes, with new cases: a guardianship can't be written under another club, a booking needs a guardian of that child, a child is marked only at a play day that exists and in a known way |
| Whole web test suite | 503 passed, 0 failed |

**Still to do before production, booked through the coordinator in lane T's queue (after `0012` and `0013` have run):** the same run on a fresh Neon copy of production with the data guard before and after (expected: 18 accounts, 0 problems, nothing but schema changed), the characterisation check, `db:migrate --drift`, and `scripts/tenants/verify.mjs`. This file is updated with that result.

## Rollback

```sql
ALTER TABLE junior_bookings DROP CONSTRAINT junior_bookings_booked_by_guardian_fkey;
DROP POLICY tenant_isolation ON guardianships;
ALTER TABLE guardianships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE guardianships DISABLE ROW LEVEL SECURITY;
ALTER TABLE guardianships DROP CONSTRAINT guardianships_tenant_guardian_junior_key,
  DROP CONSTRAINT guardianships_junior_in_club_fkey, DROP CONSTRAINT guardianships_tenant_id_fkey,
  DROP COLUMN ended_at, DROP COLUMN tenant_id;
ALTER TABLE junior_attendance DROP CONSTRAINT junior_attendance_source_check, DROP CONSTRAINT junior_attendance_session_date_fkey;
CREATE INDEX junior_profiles_tenant_id_idx ON junior_profiles (tenant_id, id);
-- Only while junior_profiles has no row without a creator:
ALTER TABLE junior_profiles ALTER COLUMN guardian_user_id SET NOT NULL;
```

and remove the migration's row. The app code that writes guardianships (lane J's `lib/juniors/family.ts`) names `tenant_id`, so it has to be rolled back with it; it is unreachable while Juniors is hidden.
