// Sealing a device's push address (its FCM token) before it reaches the
// database.
//
// The same envelope as lib/integrations/token-vault.ts (AES-256-GCM: a fresh
// data key per sealing, wrapped by a key-encryption key; "v1.kek-id.wrapped
// key.data"), but bound to a PERSON and a device row instead of a club: a
// device belongs to an account, and that vault refuses anything without a
// club, on purpose. Text sealed for one person's device can't be opened as
// another's, even by copying the database row.
//
// PUSH_KEKS holds the keys ("id:base64key[,id:base64key…]", 32 bytes each,
// newest first: the format of INTEGRATIONS_KEKS). It is a secret of the
// deployment, with its own keys so that a leak of one purpose's key opens
// nothing else. With no key set nothing is stored: it fails closed.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { parseKeks } from "../integrations/token-vault.ts";

const VERSION = "v1";

export class PushSealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushSealError";
  }
}

export type DeviceBinding = { playerId: number; deviceId: number };
export type PushSeal = {
  seal(binding: DeviceBinding, address: string): string;
  open(binding: DeviceBinding, sealed: string): string;
};
type Env = Record<string, string | undefined>;

function aad({ playerId, deviceId }: DeviceBinding, part: "dek" | "data"): Buffer {
  if (!Number.isSafeInteger(playerId) || playerId <= 0 || !Number.isSafeInteger(deviceId) || deviceId <= 0) throw new PushSealError("Sealing needs the person and the device.");
  return Buffer.from(JSON.stringify([VERSION, part, "push", playerId, deviceId]));
}

function encrypt(key: Buffer, plaintext: Buffer, bound: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(bound);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function decrypt(key: Buffer, packed: string, bound: Buffer): Buffer {
  const raw = Buffer.from(packed, "base64url");
  if (raw.length < 28) throw new PushSealError("The sealed text is too short.");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(bound);
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

/** Whether a device can be registered here at all (a usable PUSH_KEKS). */
export function pushSealAvailable(env: Env = process.env): boolean {
  try {
    return parseKeks(env.PUSH_KEKS).length > 0;
  } catch {
    return false;
  }
}

/** The deployment's seal, from PUSH_KEKS. A malformed key throws: it must never silently become "no encryption". */
export function pushSeal(env: Env = process.env): PushSeal {
  const keks = () => parseKeks(env.PUSH_KEKS);
  return {
    seal(binding, address) {
      const current = keks()[0];
      if (!current) throw new PushSealError("No encryption key is set (PUSH_KEKS), so no device can be registered.");
      const dek = randomBytes(32);
      try {
        return [VERSION, current.id, encrypt(current.key, dek, aad(binding, "dek")), encrypt(dek, Buffer.from(address, "utf8"), aad(binding, "data"))].join(".");
      } finally {
        dek.fill(0);
      }
    },
    open(binding, sealed) {
      const [version, kekId, wrappedDek, data, ...rest] = sealed.split(".");
      if (version !== VERSION || !kekId || !wrappedDek || !data || rest.length) throw new PushSealError("The sealed text isn't in a known format.");
      const kek = keks().find((k) => k.id === kekId);
      if (!kek) throw new PushSealError("The key this was sealed with isn't available.");
      let dek: Buffer | null = null;
      try {
        dek = decrypt(kek.key, wrappedDek, aad(binding, "dek"));
        return decrypt(dek, data, aad(binding, "data")).toString("utf8");
      } catch (err) {
        if (err instanceof PushSealError) throw err;
        // Wrong person, wrong device or changed text all look the same, on purpose.
        throw new PushSealError("The sealed text can't be opened for this device.");
      } finally {
        dek?.fill(0);
      }
    },
  };
}
