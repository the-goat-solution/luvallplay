-- Lane H (photos), for lane S (Social plan Task 4): what a player's photo is
-- for.
--
-- purpose   'gallery'  shared to the club's Gallery from the profile (every
--                      photo so far).
--           'social'   uploaded for a Social post.
--           'market'   uploaded for a Marketplace listing.
--
-- Every photo still goes through the same image check and the same admin
-- review (status). The purpose keeps a photo that was uploaded for a post or
-- a listing out of the public Gallery, and out of the Gallery's daily count.
--
-- consent_at is the player's "share this in the club's Gallery" tick. A
-- photo for a post or a listing is not shared to the Gallery and that
-- question isn't asked, so the column may now be empty, for those photos
-- only: a Gallery photo still can't be stored without it.
--
-- Additive: one new column with a default, so every existing row becomes
-- 'gallery' and the app runs unchanged (it doesn't name the column when it
-- stores a Gallery photo). No existing row changes otherwise. Nothing writes
-- 'social' or 'market' until Social is switched on for a pilot club.
--
-- The table is small (hundreds of rows): the default is stored without a
-- rewrite and the two checks are validated in place. No new index: the
-- Gallery and the review list read by status (player_photos_status_idx), a
-- person's daily count by player and time (player_photos_player_idx).
--
-- The club's row-level security (tenant_isolation, 0007) is unchanged: a
-- photo belongs to one club whatever it is for. player_photos is already
-- granted to luvallplay_app (0007), which covers the new column.
ALTER TABLE player_photos
  ADD COLUMN purpose text NOT NULL DEFAULT 'gallery',
  ADD CONSTRAINT player_photos_purpose_check CHECK (purpose IN ('gallery', 'social', 'market')),
  ALTER COLUMN consent_at DROP NOT NULL,
  ADD CONSTRAINT player_photos_gallery_consent_check CHECK (purpose <> 'gallery' OR consent_at IS NOT NULL);
