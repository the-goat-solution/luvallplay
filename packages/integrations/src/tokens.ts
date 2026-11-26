// A club's connection to a provider, and the rules for its tokens (build
// plan §12.1 "Connections"; test plan §3.19 "Contract tests").
//
// Tokens are only ever held sealed: encrypted for one club's one connection
// (the vault is passed in; apps/web/lib/integrations/token-vault.ts). This
// file never logs or returns a token to a screen.
import { IntegrationError, redact, toIntegrationError } from "./errors.ts";

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  /** ms since epoch. */
  accessExpiresAt: number;
  /** ms since epoch; null when the provider doesn't say (or it never expires). */
  refreshExpiresAt: number | null;
  scopes: readonly string[];
};

/** What sealing is bound to: a sealed token opens only for the same club, connector and connection. */
export type VaultContext = { tenantId: number; connector: string; connectionId: string };

export interface TokenVault {
  seal(context: VaultContext, plaintext: string): Promise<string>;
  /** Throws if the text was sealed for anything else, or was changed. */
  open(context: VaultContext, sealed: string): Promise<string>;
}

export type ConnectionStatus =
  | "connected"
  /** The provider refused the token: the club must reconnect. */
  | "revoked"
  /** Something else keeps failing; shown with the last error. */
  | "error"
  /** The club disconnected. Tokens are deleted; mappings and history stay. */
  | "disconnected";

export type Connection = {
  id: string;
  tenantId: number;
  connector: string;
  status: ConnectionStatus;
  /** The provider's id and name for what's connected (a Xero organisation), shown on the health screen. */
  externalAccountId: string | null;
  externalAccountName: string | null;
  /** The sealed TokenSet (JSON); null once disconnected. */
  sealedTokens: string | null;
  /** Goes up by one each time the tokens are replaced. */
  tokenVersion: number;
  accessExpiresAt: number | null;
  refreshExpiresAt: number | null;
  scopes: readonly string[];
  /** The provider's rate limit told us to stay away until then. */
  pausedUntil: number | null;
  /** Already redacted. */
  lastError: string | null;
  connectedBy: string;
  connectedAt: number;
  updatedAt: number;
};

export type Health = "connected" | "expiring" | "revoked" | "error" | "disconnected";

const DAY = 86_400_000;

/**
 * What the health screen shows (§12.1): "expiring" when the club will have
 * to sign in at the provider again within `warnDays` unless a sync refreshes
 * the token first.
 */
export function connectionHealth(c: Pick<Connection, "status" | "refreshExpiresAt">, now: number, warnDays = 14): Health {
  if (c.status !== "connected") return c.status;
  if (c.refreshExpiresAt !== null && c.refreshExpiresAt <= now) return "revoked";
  if (c.refreshExpiresAt !== null && c.refreshExpiresAt - now <= warnDays * DAY) return "expiring";
  return "connected";
}

/** Refresh a little before the access token runs out, so a job never starts with one about to expire. */
export function needsRefresh(c: Pick<Connection, "accessExpiresAt">, now: number, skewMs = 120_000): boolean {
  return c.accessExpiresAt === null || c.accessExpiresAt - now <= skewMs;
}

export async function sealTokens(vault: TokenVault, context: VaultContext, tokens: TokenSet): Promise<string> {
  return vault.seal(context, JSON.stringify(tokens));
}

export async function openTokens(vault: TokenVault, c: Connection): Promise<TokenSet> {
  if (!c.sealedTokens) throw new IntegrationError("auth", "This connection has no tokens: it was disconnected.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await vault.open({ tenantId: c.tenantId, connector: c.connector, connectionId: c.id }, c.sealedTokens));
  } catch {
    // Never say why: the reason could describe the key or the stored text.
    throw new IntegrationError("auth", "This connection's tokens can't be read. Reconnect to continue.");
  }
  return parsed as TokenSet;
}

export interface ConnectionStore {
  get(tenantId: number, connector: string): Promise<Connection | null>;
  /**
   * Runs `fn` while holding this connection's lock, with the connection as it
   * is now. Only one refresh runs at a time, across all workers: providers
   * whose refresh tokens rotate (Xero) refuse the second use of an old one.
   */
  withLock<T>(connection: Pick<Connection, "id" | "tenantId">, fn: (fresh: Connection | null) => Promise<T>): Promise<T>;
  /**
   * Replaces the tokens in one write, if `expectedVersion` is still current.
   * The old tokens are gone only when the new ones are stored (§12.1).
   */
  replaceTokens(connection: Pick<Connection, "id" | "tenantId">, expectedVersion: number, next: { sealedTokens: string; accessExpiresAt: number; refreshExpiresAt: number | null; scopes: readonly string[]; now: number }): Promise<boolean>;
  setStatus(connection: Pick<Connection, "id" | "tenantId">, status: ConnectionStatus, lastError: string | null, now: number): Promise<void>;
  pauseUntil(connection: Pick<Connection, "id" | "tenantId">, until: number, now: number): Promise<void>;
  /** Deletes the tokens and marks the connection disconnected. Mappings and history stay. */
  clearTokens(connection: Pick<Connection, "id" | "tenantId">, now: number): Promise<void>;
}

/** Asks the provider for new tokens. Throws IntegrationError("auth") when the refresh token is refused for good. */
export type RefreshTokens = (current: TokenSet) => Promise<TokenSet>;

/**
 * Tokens that are good to use now, refreshing them first when they're about
 * to expire.
 *
 * Safe with many workers and with rotating refresh tokens:
 *   - the refresh happens under the connection's lock, and re-reads the
 *     connection first, so a worker that lost the race uses the winner's
 *     tokens instead of spending the old refresh token again;
 *   - the new tokens replace the old in one write;
 *   - a refused refresh marks the connection "revoked" (the club reconnects);
 *     a network failure changes nothing and is retried by the job.
 */
export async function usableTokens(deps: { store: ConnectionStore; vault: TokenVault; refresh: RefreshTokens; now: () => number }, connection: Connection): Promise<TokenSet> {
  const { store, vault, refresh, now } = deps;
  if (connection.status !== "connected") throw new IntegrationError("auth", `The ${connection.connector} connection is ${connection.status}.`);
  if (!needsRefresh(connection, now())) return openTokens(vault, connection);

  return store.withLock(connection, async (fresh) => {
    if (!fresh || fresh.status !== "connected") throw new IntegrationError("auth", `The ${connection.connector} connection is ${fresh?.status ?? "gone"}.`);
    const current = await openTokens(vault, fresh);
    // Another worker refreshed while we waited for the lock.
    if (!needsRefresh(fresh, now())) return current;
    if (!current.refreshToken) {
      await store.setStatus(fresh, "revoked", "The provider's sign-in has expired.", now());
      throw new IntegrationError("auth", "The provider's sign-in has expired. Reconnect to continue.");
    }
    let next: TokenSet;
    try {
      next = await refresh(current);
    } catch (err) {
      const e = toIntegrationError(err);
      if (e.code === "auth") await store.setStatus(fresh, "revoked", redact(e.message, [current.accessToken, current.refreshToken]), now());
      throw e;
    }
    // A provider that doesn't rotate may leave the refresh token out: keep ours.
    const merged: TokenSet = { ...next, refreshToken: next.refreshToken ?? current.refreshToken, refreshExpiresAt: next.refreshToken ? next.refreshExpiresAt : current.refreshExpiresAt };
    const sealedTokens = await sealTokens(vault, { tenantId: fresh.tenantId, connector: fresh.connector, connectionId: fresh.id }, merged);
    const stored = await store.replaceTokens(fresh, fresh.tokenVersion, { sealedTokens, accessExpiresAt: merged.accessExpiresAt, refreshExpiresAt: merged.refreshExpiresAt, scopes: merged.scopes, now: now() });
    // Can't happen under the lock; if it does, don't use tokens that weren't stored.
    if (!stored) throw new IntegrationError("transient", "The connection changed while its tokens were being refreshed.");
    return merged;
  });
}

/**
 * Disconnect (§12.1): revoke at the provider, delete our copy, and let the
 * caller write the audit log. Our tokens are deleted even when the provider
 * can't be reached; `revokedAtProvider` says which happened, for the audit row.
 */
export async function disconnect(deps: { store: ConnectionStore; vault: TokenVault; revoke: (tokens: TokenSet) => Promise<void>; now: () => number }, connection: Connection): Promise<{ revokedAtProvider: boolean }> {
  let revokedAtProvider = false;
  if (connection.sealedTokens) {
    try {
      await deps.revoke(await openTokens(deps.vault, connection));
      revokedAtProvider = true;
    } catch {
      // Still delete ours below.
    }
  }
  await deps.store.clearTokens(connection, deps.now());
  return { revokedAtProvider };
}
