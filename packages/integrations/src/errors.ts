// What can go wrong when talking to a provider, and what the queue does about
// each (build plan §12.1 "Sync engine", §12.3 "Mapping and controls").
//
// A connector turns the provider's own errors into one of these codes. The
// code alone decides what happens next, so every connector behaves the same:
//
//   retry      try again later, with backoff; after too many, the error queue
//   wait       the provider's rate limit: wait as long as it says, and don't
//              count it as a failure
//   attention  a person has to fix something first (a lock date, an archived
//              account, a missing mapping). Straight to the error queue with a
//              plain-language fix; retrying by itself would never work
//   reconnect  the club's authorisation is gone. The connection is marked
//              revoked and its jobs wait until the club reconnects

export const ERROR_CODES = [
  "transient", // network, timeout, 5xx
  "rate_limited",
  "dependency", // something this job needs hasn't synced yet (a payment before its invoice)
  "auth", // token revoked or expired for good
  "lock_date", // the posting is before the accounting system's lock date
  "archived_account", // the mapped account was archived or deleted at the provider
  "mapping_missing", // the club hasn't mapped this income type yet
  "validation", // the provider refused the item as it is
  "edited_externally", // the item was changed at the provider after it synced
  "not_entitled", // the club's plan no longer includes the connector
  "unknown",
] as const;
export type IntegrationErrorCode = (typeof ERROR_CODES)[number];

export type Disposition = "retry" | "wait" | "attention" | "reconnect";

const DISPOSITION: Record<IntegrationErrorCode, Disposition> = {
  transient: "retry",
  rate_limited: "wait",
  dependency: "retry",
  auth: "reconnect",
  lock_date: "attention",
  archived_account: "attention",
  mapping_missing: "attention",
  validation: "attention",
  edited_externally: "attention",
  not_entitled: "attention",
  // An error nobody recognised might pass by itself; if not, it ends in the error queue after the retries.
  unknown: "retry",
};

export function dispositionOf(code: IntegrationErrorCode): Disposition {
  return DISPOSITION[code];
}

export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  /** For rate limits: how long the provider asked us to wait. */
  readonly retryAfterMs?: number;
  /** Extra facts for the fix message, e.g. { account: "200 Sales", lockDate: "2026-09-30" }. Never secrets. */
  readonly detail: Readonly<Record<string, string>>;
  constructor(code: IntegrationErrorCode, message: string, options: { retryAfterMs?: number; detail?: Record<string, string> } = {}) {
    super(message);
    this.name = "IntegrationError";
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.detail = options.detail ?? {};
  }
}

/** Any thrown value as an IntegrationError: connectors' own errors pass through, everything else is "unknown". */
export function toIntegrationError(err: unknown): IntegrationError {
  if (err instanceof IntegrationError) return err;
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  // fetch() failures and timeouts are worth another try.
  if (name === "AbortError" || name === "TimeoutError" || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new IntegrationError("transient", message);
  }
  return new IntegrationError("unknown", message);
}

// ── Secrets never reach a log, an error or an export (test plan §3.19) ─────

const TOKEN_SHAPES = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWTs (Xero's access tokens)
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(sk|rk|pk|whsec)_(live|test)_[A-Za-z0-9]{8,}\b/g, // Stripe keys
  /\b((?:access|refresh|id)_token|client_secret|code|password|api_key)("?\s*[=:]\s*"?)[^\s"&,}]{4,}/gi,
];

/**
 * Text that's safe to store or show: the given secrets and anything shaped
 * like a token are replaced. Every message the framework stores (job errors,
 * the sync log, a connection's last error) goes through this.
 */
export function redact(text: string, secrets: readonly (string | null | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  out = out.replace(TOKEN_SHAPES[0], "[redacted]");
  out = out.replace(TOKEN_SHAPES[1], (_m, scheme: string) => `${scheme} [redacted]`);
  out = out.replace(TOKEN_SHAPES[2], "[redacted]");
  out = out.replace(TOKEN_SHAPES[3], (_m, key: string, sep: string) => `${key}${sep}[redacted]`);
  return out.slice(0, 500);
}
