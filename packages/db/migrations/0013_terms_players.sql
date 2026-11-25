-- Phase 4: Three Wolves' words for a player and a pair become part of the
-- club's settings, for the shared match tracker (packages/vision): "Wolf 1",
-- "a registered wolf", "Pack A" (Vietnamese "Sói", "Bầy"). Without them the
-- tracker says "Player 1" and "Pair A", as it does for any other club.
--
-- One row; keys are added, nothing is removed or renamed, so the previous
-- app version (which doesn't read the keys) is unaffected.
UPDATE tenants
SET terms = jsonb_set(
      terms || '{"player_name": "Wolf", "players_name": "Wolves", "pair_name": "Pack"}'::jsonb,
      '{localized,vi}',
      COALESCE(terms #> '{localized,vi}', '{}'::jsonb) || '{"player_name": "Sói", "players_name": "Sói", "pair_name": "Bầy"}'::jsonb,
      true
    ),
    updated_at = now()
WHERE slug = 'three-wolves' AND NOT (terms ? 'player_name');
