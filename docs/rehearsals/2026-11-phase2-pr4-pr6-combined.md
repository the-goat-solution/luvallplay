# Rehearsal: 2026-11-phase2-business-config

- **Database:** ep-dawn-rice-a7la2rql-pooler.ap-southeast-2.aws.neon.tech/neondb
- **Command:** node scripts/db/migrate.mjs --baseline && node scripts/db/migrate.mjs
- **Duration:** 61.1s
- **Expectations:** scripts/data-guard/expectations/2026-11-phase2-business-config.json

**Result:** ✔ passed

| Level | Check | Detail | Count |
|---|---|---|---|
| info | TABLE_ADDED | New table club_settings. |  |
| info | TABLE_ADDED | New table pricing_plans. |  |
| info | SUMMARY | 15 accounts checked, 0 problems. |  |
