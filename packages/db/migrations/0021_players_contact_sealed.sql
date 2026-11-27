-- Lane H (encryption layers): players' phone numbers, sealed beside the
-- plain columns, with an index they can still be found by.
--
-- phone_sealed     the E.164 number, encrypted by the application for that
--                  one person (keys: CONTACT_KEKS; apps/web/lib/pii/contact.ts).
-- phone_index      a keyed fingerprint of the number (HMAC, keys:
--                  CONTACT_INDEX_KEYS), so "who has this number?" stays an
--                  equality lookup and "one verified account per number"
--                  stays a unique index once only the sealed copy is left.
-- phone_index_kid  which index key made it (for a key rotation).
--
-- Additive: three new columns, all NULL. No existing column, row or index
-- changes; phone and phone_e164 stay, and the app keeps reading them until
-- the owner switches (PII_READS). While they stay, sealing adds no secrecy:
-- this prepares their removal, which is not part of this change. Existing
-- numbers are sealed afterwards by scripts/pii/backfill-phone.mjs.
--
-- Order in production: this migration, then the two key settings, then the
-- backfill, then PII_READS. The app names these columns only once a key is
-- set (or reads are switched), so it runs unchanged before this migration
-- has reached a database; a key set before it has would break writes.
--
-- The table has under 1,000 rows, so the check and the index are built in
-- place. players is already granted to luvallplay_app (0007), which covers
-- new columns.
ALTER TABLE players
  ADD COLUMN phone_sealed text,
  ADD COLUMN phone_index text,
  ADD COLUMN phone_index_kid text,
  -- The sealed format (version.key-id.wrapped-key.data): a plain number can't be stored here by mistake.
  ADD CONSTRAINT players_phone_sealed_check CHECK (phone_sealed ~ '^v1\.[a-z0-9-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  -- The three are set together and cleared together: an index is never left
  -- behind without its sealed number (it would still be found by, and still
  -- hold the number for anyone with the index key), nor a sealed number
  -- without its index (nobody could find it).
  ADD CONSTRAINT players_phone_sealed_together_check CHECK ((phone_sealed IS NULL) = (phone_index IS NULL) AND (phone_index IS NULL) = (phone_index_kid IS NULL));
--> statement-breakpoint
-- One verified, live account per number: mirrors players_phone_verified_idx on the plain column.
CREATE UNIQUE INDEX players_phone_index_verified ON players (phone_index) WHERE phone_verified_at IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
-- The sealed copy follows the plain number. Whatever changes or clears
-- phone_e164 (account deletion, a merge, a profile edit, a script, a writer
-- nobody remembered) without writing a new sealed copy in the same statement
-- loses the old one: it would be the sealing of a number the row no longer
-- has. A writer that seals sets all three columns itself and is left alone.
--
-- And a row with no plain number holds nothing sealed, whatever the statement
-- wrote: all three are cleared whenever phone_e164 is NULL afterwards. So a
-- statement that clears the number and only one or two of the three
-- (SET phone_e164 = NULL, phone_sealed = NULL) can't leave the index behind.
-- (This rule goes with the plain column, when that is dropped.)
CREATE FUNCTION players_phone_sealed_follows_plain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phone_e164 IS NULL OR (NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164 AND NEW.phone_sealed IS NOT DISTINCT FROM OLD.phone_sealed) THEN
    NEW.phone_sealed := NULL;
    NEW.phone_index := NULL;
    NEW.phone_index_kid := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER players_phone_sealed_follows_plain BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION players_phone_sealed_follows_plain();
