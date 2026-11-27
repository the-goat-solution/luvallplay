// The one shape every Social, Marketplace and moderation library answers
// with: the value, or a short code the API maps to a status. A library never
// throws for something a person can cause (a missing id, text too long); it
// throws only when the system is broken (no database, a malformed key).

export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; code: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E extends string>(code: E): { ok: false; code: E } => ({ ok: false, code });
