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
-- rewrite and the two checks are validated in place. The Gallery and the
-- review list read by status (player_photos_status_idx), a person's daily
-- count by player and time (player_photos_player_idx).
--
-- Three more rules, none of which can touch a row there is:
--
-- - A photo's purpose never changes (a trigger). Otherwise one UPDATE would
--   put a post's photo in the Gallery, or take a Gallery photo out of the
--   player's own "My photos" and into a post.
-- - One stored file is one photo, for posts and listings: a unique index on
--   display_url over the rows that are not Gallery photos (so it covers no
--   existing row, and the Gallery is as before). Registering the same file
--   twice would let deleting one photo remove the other's file.
-- - One photo is in at most one post: social_posts_photo_id_idx (0022)
--   becomes a unique index, social_posts_photo_id_key. social_posts is
--   empty everywhere: nothing has written a post yet.
--
-- The club's row-level security (tenant_isolation, 0007) is unchanged: a
-- photo belongs to one club whatever it is for. player_photos is already
-- granted to luvallplay_app (0007), which covers the new column.
ALTER TABLE player_photos
  ADD COLUMN purpose text NOT NULL DEFAULT 'gallery',
  ADD CONSTRAINT player_photos_purpose_check CHECK (purpose IN ('gallery', 'social', 'market')),
  ALTER COLUMN consent_at DROP NOT NULL,
  ADD CONSTRAINT player_photos_gallery_consent_check CHECK (purpose <> 'gallery' OR consent_at IS NOT NULL);
--> statement-breakpoint
CREATE FUNCTION player_photos_purpose_is_fixed() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.purpose IS DISTINCT FROM OLD.purpose THEN
    RAISE EXCEPTION 'player_photos.purpose cannot be changed (photo %)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;
--> statement-breakpoint
CREATE TRIGGER player_photos_purpose_is_fixed BEFORE UPDATE OF purpose ON player_photos FOR EACH ROW EXECUTE FUNCTION player_photos_purpose_is_fixed();
--> statement-breakpoint
CREATE UNIQUE INDEX player_photos_file_key ON player_photos (display_url) WHERE purpose <> 'gallery';
--> statement-breakpoint
DROP INDEX social_posts_photo_id_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX social_posts_photo_id_key ON social_posts (photo_id) WHERE photo_id IS NOT NULL;
