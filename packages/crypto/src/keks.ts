// Key lists: the key-encryption keys (KEKs) of one purpose.
//
// A list is "id:base64key[,id:base64key…]": each key 32 bytes, ids
// lower-case letters, digits and hyphens (1 to 32), newest first. New
// sealings use the first key; every key listed can still open what it sealed,
// which is how a key is rotated.
//
// Each purpose has its own list (INTEGRATIONS_KEKS, PUSH_KEKS, JUNIORS_KEKS,
// …), so a leak of one purpose's key opens nothing else. A list is a secret
// of the deployment.

/** Why sealing or opening was refused. The message never holds a key, the plain text or the sealed text. */
export type SealErrorCode =
  /** The key list is malformed. */
  | "keys"
  /** No key is set for this purpose: nothing can be sealed. */
  | "unavailable"
  /** The binding is empty or holds something other than non-empty text and positive whole numbers. */
  | "binding"
  /** What was given to seal isn't text. */
  | "plaintext"
  /** The sealed text isn't "v1.<kek-id>.<wrapped-key>.<data>". */
  | "format"
  /** The key the text was sealed with isn't in the list. */
  | "unknown_key"
  /** Wrong binding, wrong key bytes or changed text: one answer for all three, on purpose. */
  | "unopenable";

export class SealError extends Error {
  readonly code: SealErrorCode;
  constructor(message: string, code: SealErrorCode) {
    super(message);
    this.name = "SealError";
    this.code = code;
  }
}

export type Kek = { id: string; key: Buffer };

const KEK_ID = /^[a-z0-9-]{1,32}$/;
/** 32 bytes in base64 or base64url: 43 characters, with or without the "=" that pads them. */
const KEY_TEXT = /^[A-Za-z0-9+/_-]{43}=?$/;

/**
 * Reads a key list. `name` is the environment variable it came from, for the
 * error message.
 *
 * Spaces and line breaks around a part, and empty parts (a trailing comma),
 * are ignored: a list pasted into an environment variable often has them.
 * Anything else malformed throws: a bad key must never silently become "no
 * encryption". That includes key text with anything in it that isn't base64
 * (a list split by line breaks instead of commas, quotes, a space): decoding
 * would stop there and quietly drop the keys after it. No list, or an empty one, gives no keys, which means "this
 * purpose is unavailable", never "store it unsealed".
 */
export function parseKeks(raw: string | undefined, name = "INTEGRATIONS_KEKS"): Kek[] {
  const out: Kek[] = [];
  for (const part of (raw ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const colon = part.indexOf(":");
    const id = part.slice(0, Math.max(colon, 0)).trim();
    if (colon < 1 || !KEK_ID.test(id)) throw new SealError(`${name}: each key needs an id (lower-case letters, digits, hyphens).`, "keys");
    const text = part.slice(colon + 1).trim();
    const key = KEY_TEXT.test(text) ? Buffer.from(text, "base64") : null;
    if (key?.length !== 32) {
      key?.fill(0);
      throw new SealError(`${name}: key "${id}" must be 32 bytes, base64.`, "keys");
    }
    if (out.some((k) => k.id === id)) throw new SealError(`${name}: key id "${id}" is listed twice.`, "keys");
    out.push({ id, key });
  }
  return out;
}
