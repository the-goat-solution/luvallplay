# Phase 7 runbook: Find a club and global ratings (lane G)

*Started 25 Nov 2026. Build plan §8 items 1 and 2. Social and the marketplace are gated (decision Z): nothing here is for them.*

**Rules this runbook follows:** everything ships behind module switches that are **off**; Three Wolves sees no change until the owner says so; migrations are additive, rehearsed, and go through lane T's migration queue; production data steps only with the owner's OK; only synthetic clubs on test databases until lane W's wizard (W2) creates a second real club.

## 1. Steps

| Step | What | Needs | State |
|---|---|---|---|
| G1 | Glicko-2 and per-sport scoring rules as pure code | nothing | PR #158 |
| G3a | Find a club: the search rules as pure code (`apps/web/lib/directory/search.ts`) | nothing | this PR |
| G2 | The Arena checks scores through the scoring rules | **owner's OK** (shared Arena code) | not started |
| G3b | Migration: `club_listings` (§2), the search in SQL tested against G3a | the geo decision (§3); migration queue | drafted below |
| G3c | Module entries `directory` and `ratings` (hidden, off), the API endpoints | lane H's contract split; lane A told (registry) | not started |
| G4 | Ratings: `rating_matches` and `player_ratings` (§4), the weekly job, the opt-in | migration queue; lane T (crons loop over clubs) | not started |
| G5 | The app's Discover tab: map (MapLibre), club cards, rating boards. Hidden until a module is on | G3c, G4; the tile provider decision (§5) | not started |
| G6 | Real clubs listed | lane W2, then the owner's OK per region | waits |

## 2. Find a club: the data model

One new **platform table** (like `tenants` and `tenant_modules`: one row per club, no row-level security, written only by server code that has already checked the admin belongs to that club). The directory has to read across clubs, which club-owned tables behind row-level security can't do.

```sql
CREATE TABLE club_listings (
  tenant_id        integer PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  listed           boolean NOT NULL DEFAULT false,          -- the club's opt-in
  venue            text,
  city             text,
  city_key         text NOT NULL DEFAULT '',                -- accent-free, lower case (placeKey)
  postcode         text,
  postcode_key     text NOT NULL DEFAULT '',
  latitude         double precision,                        -- the venue's pin; null until placed
  longitude        double precision,
  days             text[]  NOT NULL DEFAULT '{}',           -- mon … sun
  levels           text[]  NOT NULL DEFAULT '{}',           -- beginner, intermediate, advanced
  casual_friendly  boolean NOT NULL DEFAULT false,
  price_from_minor integer,                                 -- cheapest single session; 0 free; null not given
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       integer REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT club_listings_pin_check CHECK ((latitude IS NULL) = (longitude IS NULL)
    AND (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))),
  CONSTRAINT club_listings_days_check CHECK (days <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']),
  CONSTRAINT club_listings_levels_check CHECK (levels <@ ARRAY['beginner','intermediate','advanced']),
  CONSTRAINT club_listings_price_check CHECK (price_from_minor IS NULL OR price_from_minor >= 0),
  -- A club can't be listed without saying where it is.
  CONSTRAINT club_listings_listed_check CHECK (NOT listed OR city_key <> '')
);
CREATE INDEX club_listings_pin_idx ON club_listings (latitude, longitude) WHERE listed AND latitude IS NOT NULL;
CREATE INDEX club_listings_city_idx ON club_listings (city_key) WHERE listed;
CREATE INDEX club_listings_postcode_idx ON club_listings (postcode_key) WHERE listed AND postcode_key <> '';
```

- Sport, country, currency, region, name and status come from `tenants`; whether the module is on comes from `tenant_modules`. Nothing is copied.
- **No rows are created by the migration.** Three Wolves gets no listing until an admin makes one, so the table is empty on production after it runs. Class: additive (test plan §4.1). Rollback: `DROP TABLE club_listings`.
- A club appears only when: `listed`, the module is on for the club, `tenants.status = 'active'`, and the club's region is the deployment's. These four are in the pure code (`isVisible`) and will be in the SQL's `WHERE`; the SQL is tested against the pure code on 2,000 synthetic clubs.
- What's public is only what the club typed into its listing. No member data is in the directory.

## 3. Decision needed: PostGIS, or plain latitude and longitude first

The build plan says "PostGIS radius search". Three facts found while planning it:

1. **CI's database has no PostGIS.** CI runs the stock `postgres:18` image; `CREATE EXTENSION postgis` fails there, and so would the schema drift check, the data guard tests and every other lane's database tests. CI would have to move to a PostGIS image first (lane H's workflow file), and every developer's local database too.
2. **The Hanoi region's managed Postgres isn't chosen yet** (§6.9), so nobody can say PostGIS will be there. Neon (Sydney) does offer it.
3. **At our size PostGIS buys nothing measurable.** A region will have hundreds of clubs, perhaps a few thousand. A latitude/longitude box on an ordinary index, then the exact great-circle distance on what's left, answers in well under a millisecond at that size and gives the same clubs in the same order. PostGIS starts to matter around hundreds of thousands of points, or for shapes (suburb boundaries, travel-time areas).

**Recommendation: start without PostGIS** (the table in §2, the search in `search.ts`), and keep PostGIS as a later, separate migration if a need appears. It can be added without changing the API or the app: only the SQL behind `searchListings` changes, and the same tests keep it honest.

If the owner prefers PostGIS from the start, the plan is:

| # | Step | Who |
|---|---|---|
| 1 | CI's Postgres image moves to `postgis/postgis:18-3.6` (small PR to `.github/workflows/ci.yml`) | lane H |
| 2 | Migration A: `CREATE EXTENSION IF NOT EXISTS postgis;` alone, so it can be rehearsed and rolled back alone. On Neon it needs the database owner | lane G writes, queue |
| 3 | Migration B: `club_listings` with `location geography(Point, 4326)` generated from latitude and longitude, and a GiST index; the search uses `ST_DWithin` and `ST_Distance` | lane G writes, queue |
| 4 | Rehearse both on a Neon branch of production: extension version noted, drift check clean, data guard clean, `DROP EXTENSION` tried as the rollback | lane G, with lane T's branch budget |
| 5 | `docs/schema/production.sql` and the schema dump learn to print extensions (they don't today) | lane G |
| 6 | Production, one migration at a time, booked in the Phase 3 runbook's calendar | **owner's OK** |
| 7 | Hanoi: confirm PostGIS with the chosen provider before any VN club is listed | lane V |

## 4. Ratings: the data model (for G4)

Two platform tables, because an account is global and plays at several clubs:

- **`rating_matches`**: one row per verified match (the id from `packages/core/src/rating/matches.ts`, e.g. `arena:1:42`, as the primary key, so a match can never count twice), with sport, club, date, the two sides and the winner. Filled by a weekly job that loops over the region's clubs **inside each club's own scope** and copies only matches that pass `verifyArenaChallenge` / `verifyRoundRobinGame`. A match that is later disputed or voided is removed, and the ratings are recomputed from the ledger (they're deterministic).
- **`player_ratings`**: one row per account and sport: rating, RD, volatility, games, last played, last period.
- **Opt-in:** a per-account, per-sport switch, **off by default**. Without it a player has a rating row (the maths needs everyone's games) but is never shown on any board or returned by any API to anyone else. Deleting an account removes its rows and its side of the ledger is anonymised.
- City, birth year and gender category for the board views are new optional profile fields the player fills in when opting in. None exist today.

## 5. Open questions for the owner

1. **PostGIS or plain latitude/longitude first** (§3). Recommended: plain first.
2. **The Arena switching to the scoring rules (G2):** a small change to shared Arena code. Badminton behaves identically (tested on every score). OK to open that PR?
3. **Timer-confirmed results** don't count towards the global rating (they still count for club points). OK?
4. **Juniors never appear** on global boards, and age bands are adult ten-year bands. OK?
5. **Map tiles (G5):** MapLibre needs a tile provider. Free candidates are OpenFreeMap (no key, no limits stated, community run) and Protomaps (one file we host ourselves). A hosted paid option is MapTiler. This sends map requests from players' phones to that provider, so it also belongs in the regional services matrix. To be compared before G5.

## 6. Test data

Synthetic clubs only (`apps/web/tests/directory-search.test.ts` builds them in memory). No listing rows, rating rows or second club are created in the shared database by this lane before step 11 and W2, as §9.2 requires.
