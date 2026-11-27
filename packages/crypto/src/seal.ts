// The envelope: how every sealed value is encrypted.
//
// AES-256-GCM, twice:
//   - every sealing makes a fresh data key, encrypts the text with it, and
//     wraps the data key with the purpose's key-encryption key (KEK);
//   - both steps are bound to a context (the "binding": which club and
//     connection, which person and device, …) as additional authenticated
//     data, so text sealed for one row can't be opened as another's, even by
//     copying the database row;
//   - the sealed text names the KEK it used, so the KEK can be rotated: new
//     sealings use the first key listed, old ones still open.
//
// Wire format: "v1.<kek-id>.<wrapped-key>.<data>". The last two parts are
// base64url of a 12-byte IV, the 16-byte tag, then the ciphertext. This is
// the format lib/integrations/token-vault.ts and lib/push/seal.ts have
// written since they began; it must not change, or rows sealed before stop
// opening (tests/crypto-seal.test.ts holds old ciphertext to prove it).
//
// With no key nothing is sealed: it fails closed and never hands back the
// plain text.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SealError, type Kek } from "./keks.ts";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * What a sealed text is tied to. Not empty; text parts not empty; numbers
 * positive whole numbers. A new purpose puts a constant naming itself first
 * (`["player.phone", playerId]`), so text sealed for one purpose can't be
 * opened as another's even if the two were given the same key.
 */
export type Binding = readonly (string | number)[];

export type Seal = {
  /** Seals with the first key listed. Throws SealError with no key: never returns the plain text. */
  seal(binding: Binding, plaintext: string): string;
  /** Opens with whichever listed key sealed it. A wrong binding and changed text give the same error. */
  open(binding: Binding, sealed: string): string;
  /** Whether anything can be sealed here: a usable key list with at least one key. */
  available(): boolean;
};

/** The additional authenticated data of one part. Its bytes are part of the wire format. */
function aad(binding: Binding, part: "dek" | "data"): Buffer {
  if (!Array.isArray(binding) || binding.length === 0) throw new SealError("Sealing needs to know what the text belongs to.", "binding");
  for (const b of binding) {
    const ok = typeof b === "string" ? b.length > 0 : typeof b === "number" && Number.isSafeInteger(b) && b > 0;
    if (!ok) throw new SealError("Sealing is bound to names and positive whole numbers only.", "binding");
  }
  return Buffer.from(JSON.stringify([VERSION, part, ...binding]));
}

function encrypt(key: Buffer, plaintext: Buffer, bound: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(bound);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/**
 * Whether a part is the base64url this library writes: its alphabet only (no
 * padding, no "+" or "/", no spaces), and exactly the text its bytes encode
 * to. Node's decoder skips what it doesn't know, so without this one sealed
 * value could be written many ways.
 */
function canonical(part: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(part) && Buffer.from(part, "base64url").toString("base64url") === part;
}

function decrypt(key: Buffer, packed: string, bound: Buffer): Buffer {
  const raw = Buffer.from(packed, "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new SealError("The sealed text is too short.", "format");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
  decipher.setAAD(bound);
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  // GCM hands back the bytes before it has checked them: `head` holds the
  // data key (or the text) even when final() then refuses it. The caller gets
  // a copy to zero; these are zeroed here, whichever way it ends.
  let head: Buffer | null = null;
  let tail: Buffer | null = null;
  try {
    head = decipher.update(raw.subarray(IV_BYTES + TAG_BYTES));
    tail = decipher.final();
    return Buffer.concat([head, tail]);
  } finally {
    head?.fill(0);
    tail?.fill(0);
  }
}

/**
 * The seal of one purpose. `purpose` names its key list in error messages
 * (the environment variable: "PUSH_KEKS"); it is not part of what is sealed.
 * `keks` is asked on every call, so a changed list takes effect at once; if
 * it throws (a malformed list), sealing and opening throw the same error.
 */
export function createSeal(opts: { purpose: string; keks: () => Kek[] }): Seal {
  const { purpose, keks } = opts;
  return {
    seal(binding, plaintext) {
      const boundDek = aad(binding, "dek");
      const boundData = aad(binding, "data");
      // Said without the value: an error message is logged, the text must not be.
      if (typeof plaintext !== "string") throw new SealError("Only text can be sealed.", "plaintext");
      const current = keks()[0];
      if (!current) throw new SealError(`No encryption key is set (${purpose}), so nothing can be sealed.`, "unavailable");
      const dek = randomBytes(32);
      try {
        return [VERSION, current.id, encrypt(current.key, dek, boundDek), encrypt(dek, Buffer.from(plaintext, "utf8"), boundData)].join(".");
      } finally {
        dek.fill(0);
      }
    },
    open(binding, sealed) {
      const boundDek = aad(binding, "dek");
      const boundData = aad(binding, "data");
      const [version, kekId, wrappedDek, data, ...rest] = String(sealed).split(".");
      if (version !== VERSION || !kekId || !wrappedDek || !data || rest.length) throw new SealError("The sealed text isn't in a known format.", "format");
      const kek = keks().find((k) => k.id === kekId);
      if (!kek) throw new SealError("The key this was sealed with isn't available.", "unknown_key");
      // After the key, as the length check always was: a malformed key list or an unlisted key is still said first.
      if (!canonical(wrappedDek) || !canonical(data)) throw new SealError("The sealed text isn't in a known format.", "format");
      let dek: Buffer | null = null;
      let plain: Buffer | null = null;
      try {
        dek = decrypt(kek.key, wrappedDek, boundDek);
        plain = decrypt(dek, data, boundData);
        return plain.toString("utf8");
      } catch (err) {
        if (err instanceof SealError) throw err;
        // A wrong binding, wrong key bytes or changed text all look the same, on purpose.
        throw new SealError("The sealed text can't be opened.", "unopenable");
      } finally {
        dek?.fill(0);
        plain?.fill(0);
      }
    },
    available() {
      try {
        return keks().length > 0;
      } catch {
        return false;
      }
    },
  };
}

/** The KEK id a sealed text used: to find what still needs re-sealing after a key rotation. */
export function sealedWith(sealed: string): string | null {
  if (typeof sealed !== "string") return null;
  const parts = sealed.split(".");
  return parts.length === 4 && parts[0] === VERSION ? parts[1] : null;
}
