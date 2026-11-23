-- Phase 3 step 4: Three Wolves' titles for the top seats on its points board
-- become part of the club's settings (build plan §6.3).
--
-- "Alpha Wolf" and "Silver Wolf" (and the Vietnamese "Sói Đầu Đàn" and "Sói
-- Bạc") are Three Wolves' own terms, like "Wolf Points". They leave the
-- shared dictionaries; this stores them beside the names already in
-- tenants.terms.
--
-- One row; keys are added, nothing is removed or renamed, so the previous
-- app version (which doesn't read the keys) is unaffected.
UPDATE tenants
SET terms = jsonb_set(
      terms || '{"alpha_name": "Alpha Wolf", "silver_name": "Silver Wolf"}'::jsonb,
      '{localized,vi}',
      COALESCE(terms #> '{localized,vi}', '{}'::jsonb) || '{"alpha_name": "Sói Đầu Đàn", "silver_name": "Sói Bạc"}'::jsonb,
      true
    ),
    updated_at = now()
WHERE slug = 'three-wolves' AND NOT (terms ? 'alpha_name');
