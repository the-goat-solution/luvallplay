// The blind index: how a sealed value can still be looked up.
//
// Every sealing of the same text is different, so a sealed column can't be
// searched or made unique. Beside it goes a keyed fingerprint of the value:
//
//   mac = base64url(HMAC-SHA256(key, purpose + "\0" + value))
//
// The same value under the same key and purpose always gives the same mac,
// so "who has this phone number?" is an equality lookup on the mac. Without
// the key the mac says nothing about the value.
//
// WITH the key it says everything when the values are few: phone numbers are
// about 10^8 per country, so whoever holds the index key and a copy of the
// database can try them all. The index key is as secret as the values, and
// it is its own key list (CONTACT_INDEX_KEYS), never a sealing key.
//
// The index does not normalise. "021 123 4567" and "+64211234567" are two
// values here; the caller brings them to one form first.
//
// Rotation works as for sealing: new rows use the first key listed; a lookup
// asks for the mac under every listed key until the old rows are re-indexed.
// The key id is returned beside the mac, not inside it, so the mac column can
// carry a unique index.
import { createHmac } from "node:crypto";
import { SealError, type Kek } from "./keks.ts";

export type BlindIndexEntry = { kid: string; mac: string };

export type BlindIndex = {
  /** The index under the first key listed: what a new or re-indexed row stores. Throws SealError with no key. */
  current(value: string): BlindIndexEntry;
  /**
   * The index under every key listed, newest first: what a lookup matches
   * against during a rotation. With no key it is empty: the lookup finds
   * nothing, and nothing is ever indexed without a key.
   */
  all(value: string): BlindIndexEntry[];
};

/**
 * The blind index of one purpose. `purpose` is part of what is hashed (a
 * constant such as "player.phone"), so the same value indexed for two
 * purposes gives two unrelated macs even if they were given the same key. It
 * can't be empty or hold a NUL, which is what separates it from the value.
 * `keys` is asked on every call; if it throws (a malformed list), so do
 * `current` and `all`.
 */
export function blindIndex(opts: { purpose: string; keys: () => Kek[] }): BlindIndex {
  const { purpose, keys } = opts;
  if (typeof purpose !== "string" || purpose.length === 0 || purpose.includes("\0")) {
    throw new SealError("A blind index needs a purpose: non-empty text without a NUL.", "binding");
  }
  const prefix = Buffer.from(`${purpose}\0`, "utf8");

  // Said without the value: an error message is logged, the value must not be.
  const check = (value: string): void => {
    if (typeof value !== "string" || value.length === 0) throw new SealError("Only non-empty text can be indexed.", "plaintext");
  };
  const entry = (kek: Kek, value: string): BlindIndexEntry => ({
    kid: kek.id,
    mac: createHmac("sha256", kek.key).update(prefix).update(value, "utf8").digest("base64url"),
  });

  return {
    current(value) {
      check(value);
      const first = keys()[0];
      if (!first) throw new SealError(`No index key is set (${purpose}), so nothing can be indexed.`, "unavailable");
      return entry(first, value);
    },
    all(value) {
      check(value);
      return keys().map((kek) => entry(kek, value));
    },
  };
}
