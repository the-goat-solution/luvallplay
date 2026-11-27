// Where a club's provider tokens are encrypted (build plan §12.1: "Tokens are
// encrypted per club (envelope encryption, keys in a secret manager), never
// logged, and shown to nobody").
//
// Envelope encryption with AES-256-GCM:
//   - every sealing makes a fresh data key, encrypts the tokens with it, and
//     wraps the data key with the platform's key-encryption key (KEK);
//   - both steps are bound to the club, connector and connection, so text
//     sealed for one club's connection can't be opened as another's, even by
//     copying the database row (test plan §3.19 "Credential isolation");
//   - the sealed text names the KEK it used, so the KEK can be rotated: new
//     sealings use the first key listed, old ones still open.
//
// INTEGRATIONS_KEKS holds the keys: "id:base64key[,id:base64key…]", each key
// 32 bytes, newest first. It is a secret of the deployment (Vercel's
// encrypted environment variables today; a KMS can replace this file behind
// the same TokenVault interface). With no key set, nothing can be connected:
// it fails closed, and never stores a token unencrypted.
//
// The envelope itself is @luvallplay/crypto, shared with every other sealed
// value. This file binds it to a club's connection and keeps the vault's own
// errors and wording.
import { createSeal, parseKeks as parseKeyList, SealError, type Kek } from "@luvallplay/crypto";
import type { TokenVault, VaultContext } from "@luvallplay/integrations";

export { sealedWith } from "@luvallplay/crypto";

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

const NO_KEY = "No encryption key is set (INTEGRATIONS_KEKS), so nothing can be connected.";

/** The shared envelope's error as the vault's own, in the vault's words. Anything else is passed on as it is. */
function vaultError(err: unknown): unknown {
  if (!(err instanceof SealError)) return err;
  if (err.code === "unavailable") return new VaultError(NO_KEY);
  // Wrong club, wrong connection or changed text all look the same, on purpose.
  if (err.code === "unopenable") return new VaultError("The sealed text can't be opened for this connection.");
  return new VaultError(err.message);
}

/** Reads INTEGRATIONS_KEKS. Throws on anything malformed: a bad key must never silently become "no encryption". */
export function parseKeks(raw: string | undefined): Kek[] {
  try {
    return parseKeyList(raw, "INTEGRATIONS_KEKS");
  } catch (err) {
    throw vaultError(err);
  }
}

/** What a sealed text is bound to: the club, the connector and the connection. */
function bindingOf(context: VaultContext): [number, string, string] {
  if (!Number.isSafeInteger(context.tenantId) || context.tenantId <= 0) throw new VaultError("The vault needs the club.");
  if (!context.connector || !context.connectionId) throw new VaultError("The vault needs the connector and the connection.");
  return [context.tenantId, context.connector, context.connectionId];
}

export function tokenVault(keks: () => Kek[]): TokenVault {
  const envelope = createSeal({ purpose: "integrations", keks });
  return {
    async seal(context, plaintext) {
      // A missing key is said before anything about the context, as it always was.
      if (!keks().length) throw new VaultError(NO_KEY);
      const binding = bindingOf(context);
      try {
        return envelope.seal(binding, plaintext);
      } catch (err) {
        throw vaultError(err);
      }
    },
    async open(context, sealed) {
      let binding: [number, string, string];
      try {
        binding = bindingOf(context);
      } catch (refused) {
        // The text's format and its key are checked before the context, as they always were.
        const [version, kekId, wrappedDek, data, ...rest] = String(sealed).split(".");
        if (version !== "v1" || !kekId || !wrappedDek || !data || rest.length) throw new VaultError("The sealed text isn't in a known format.");
        if (!keks().some((k) => k.id === kekId)) throw new VaultError("The key this was sealed with isn't available.");
        throw refused;
      }
      try {
        return envelope.open(binding, sealed);
      } catch (err) {
        throw vaultError(err);
      }
    },
  };
}

let cached: { raw: string | undefined; keks: Kek[] } | null = null;

/** The deployment's vault, from INTEGRATIONS_KEKS. */
export function deploymentVault(): TokenVault {
  return tokenVault(() => {
    const raw = process.env.INTEGRATIONS_KEKS;
    if (!cached || cached.raw !== raw) cached = { raw, keks: parseKeks(raw) };
    return cached.keks;
  });
}

/** Whether connections can be made here at all. */
export function vaultConfigured(): boolean {
  try {
    return parseKeks(process.env.INTEGRATIONS_KEKS).length > 0;
  } catch {
    return false;
  }
}
