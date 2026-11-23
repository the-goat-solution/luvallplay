-- Phase 3 step 4: Three Wolves' Vietnamese name for its points becomes part
-- of the club's settings (build plan §6.3).
--
-- The Vietnamese text says "Điểm Sói" where the English says "Wolf Points".
-- Both are Three Wolves' own terms, so both leave the shared dictionaries.
-- The English name is already in tenants.terms (step 1); this adds the
-- Vietnamese one beside it.
--
-- One row, one key added. Nothing is removed or renamed, so the previous app
-- version (which doesn't read the key) is unaffected.
UPDATE tenants
SET terms = terms || '{"localized": {"vi": {"points_name": "Điểm Sói"}}}'::jsonb, updated_at = now()
WHERE slug = 'three-wolves' AND NOT (terms ? 'localized');
