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
//
// The envelope itself is @luvallplay/crypto; this file binds it to a person's
// device and keeps this module's own errors and wording.
import { createSeal, SealError } from "@luvallplay/crypto";
import { parseKeks } from "../integrations/token-vault.ts";

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

const NO_KEY = "No encryption key is set (PUSH_KEKS), so no device can be registered.";

/** The shared envelope's error as this module's own, in its words. Anything else (a malformed key list) is passed on as it is. */
function pushSealError(err: unknown): unknown {
  if (!(err instanceof SealError)) return err;
  if (err.code === "unavailable") return new PushSealError(NO_KEY);
  // Wrong person, wrong device or changed text all look the same, on purpose.
  if (err.code === "unopenable") return new PushSealError("The sealed text can't be opened for this device.");
  return new PushSealError(err.message);
}

/** What a sealed address is bound to: "push", the person and the device row. */
function bindingOf({ playerId, deviceId }: DeviceBinding): ["push", number, number] {
  if (!Number.isSafeInteger(playerId) || playerId <= 0 || !Number.isSafeInteger(deviceId) || deviceId <= 0) throw new PushSealError("Sealing needs the person and the device.");
  return ["push", playerId, deviceId];
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
  const envelope = createSeal({ purpose: "push", keks });
  return {
    seal(binding, address) {
      // A missing key is said before anything about the device, as it always was.
      if (!keks().length) throw new PushSealError(NO_KEY);
      const bound = bindingOf(binding);
      try {
        return envelope.seal(bound, address);
      } catch (err) {
        throw pushSealError(err);
      }
    },
    open(binding, sealed) {
      let bound: ["push", number, number];
      try {
        bound = bindingOf(binding);
      } catch (refused) {
        // The text's format and its key are checked before the device, as they always were.
        const [version, kekId, wrappedDek, data, ...rest] = String(sealed).split(".");
        if (version !== "v1" || !kekId || !wrappedDek || !data || rest.length) throw new PushSealError("The sealed text isn't in a known format.");
        if (!keks().some((k) => k.id === kekId)) throw new PushSealError("The key this was sealed with isn't available.");
        throw refused;
      }
      try {
        return envelope.open(bound, sealed);
      } catch (err) {
        throw pushSealError(err);
      }
    },
  };
}
