# Rehearsal: Phase 4, a club's words for a player and a pair (`0013_terms_players`)

- **Change:** Three Wolves' row in `tenants` gains `terms.player_name`, `terms.players_name`, `terms.pair_name` (Wolf, Wolves, Pack) and the Vietnamese ones under `terms.localized.vi` (Sói, Sói, Bầy). One row of one platform table; keys are added, nothing is removed or renamed.
- **Command:** node scripts/db/migrate.mjs --to 0013
- **Expectations:** `apps/web/scripts/data-guard/expectations/2026-11-phase4-terms-players.json` (production run: `…terms-players.production.json`)

## Result: passed

Branch `rehearsal-phase-3` of production (`three-wolves-sydney`, Postgres 18), 25 Nov 2026, reset to a fresh copy of production at 20:15 UTC. `0012_junior_activity` was rehearsed on it first, alone (`--to 0012`), then this one, alone, as the production runs will go.

| Check | Result |
|---|---|
| Data guard, before and after | **19 accounts checked, 0 problems.** The only changes are `tenants.terms` and `tenants.updated_at` on the club's row |
| Migration `0013_terms_players` | Applied in 1.4 s |
| Characterisation | 19 live accounts (12 views each) and 6 club views: **identical** |
| `db:migrate --drift` | No schema drift (the migration changes no structure) |
| `scripts/tenants/verify.mjs` | Consistent; row-level security on 61 club-owned tables, 0 problems |
| The row afterwards | `player_name` Wolf, `players_name` Wolves, `pair_name` Pack; `localized.vi` Sói, Sói, Bầy. The seat titles and points name from `0008` and `0009` are unchanged |

**What it fixes (audit C0):** the app's built-in settings already hold these three words, so the daily settings comparison writes `differ` until the stored row has them too.

## Rollback

```sql
UPDATE tenants
SET terms = (terms - 'player_name' - 'players_name' - 'pair_name')
            #- '{localized,vi,player_name}' #- '{localized,vi,players_name}' #- '{localized,vi,pair_name}'
WHERE slug = 'three-wolves';
```

and remove the migration's row. The app version before these words reads none of the keys.
