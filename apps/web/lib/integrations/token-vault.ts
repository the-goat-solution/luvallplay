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
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { TokenVault, VaultContext } from "@luvallplay/integrations";

const VERSION = "v1";

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

type Kek = { id: string; key: Buffer };

/** Reads INTEGRATIONS_KEKS. Throws on anything malformed: a bad key must never silently become "no encryption". */
export function parseKeks(raw: string | undefined): Kek[] {
  const out: Kek[] = [];
  for (const part of (raw ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const colon = part.indexOf(":");
    const id = part.slice(0, colon);
    const key = Buffer.from(part.slice(colon + 1), "base64");
    if (colon < 1 || !/^[a-z0-9-]{1,32}$/.test(id)) throw new VaultError("INTEGRATIONS_KEKS: each key needs an id (lower-case letters, digits, hyphens).");
    if (key.length !== 32) throw new VaultError(`INTEGRATIONS_KEKS: key "${id}" must be 32 bytes, base64.`);
    if (out.some((k) => k.id === id)) throw new VaultError(`INTEGRATIONS_KEKS: key id "${id}" is listed twice.`);
    out.push({ id, key });
  }
  return out;
}

function aad(context: VaultContext, part: "dek" | "data"): Buffer {
  if (!Number.isSafeInteger(context.tenantId) || context.tenantId <= 0) throw new VaultError("The vault needs the club.");
  if (!context.connector || !context.connectionId) throw new VaultError("The vault needs the connector and the connection.");
  return Buffer.from(JSON.stringify([VERSION, part, context.tenantId, context.connector, context.connectionId]));
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
  if (raw.length < 28) throw new VaultError("The sealed text is too short.");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(bound);
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

export function tokenVault(keks: () => Kek[]): TokenVault {
  return {
    async seal(context, plaintext) {
      const current = keks()[0];
      if (!current) throw new VaultError("No encryption key is set (INTEGRATIONS_KEKS), so nothing can be connected.");
      const dek = randomBytes(32);
      try {
        return [VERSION, current.id, encrypt(current.key, dek, aad(context, "dek")), encrypt(dek, Buffer.from(plaintext, "utf8"), aad(context, "data"))].join(".");
      } finally {
        dek.fill(0);
      }
    },
    async open(context, sealed) {
      const [version, kekId, wrappedDek, data, ...rest] = sealed.split(".");
      if (version !== VERSION || !kekId || !wrappedDek || !data || rest.length) throw new VaultError("The sealed text isn't in a known format.");
      const kek = keks().find((k) => k.id === kekId);
      if (!kek) throw new VaultError("The key this was sealed with isn't available.");
      let dek: Buffer | null = null;
      try {
        dek = decrypt(kek.key, wrappedDek, aad(context, "dek"));
        return decrypt(dek, data, aad(context, "data")).toString("utf8");
      } catch (err) {
        if (err instanceof VaultError) throw err;
        // Wrong club, wrong connection or changed text all look the same, on purpose.
        throw new VaultError("The sealed text can't be opened for this connection.");
      } finally {
        dek?.fill(0);
      }
    },
  };
}

/** The KEK id a sealed text used: to find what still needs re-sealing after a key rotation. */
export function sealedWith(sealed: string): string | null {
  const parts = sealed.split(".");
  return parts.length === 4 && parts[0] === VERSION ? parts[1] : null;
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
