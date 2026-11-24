// Which hosts the app sends a session token to. A club's API base comes from
// the server's answer; the app still only follows it to a host it was built
// to trust (the same list the page's CSP allows).

/** "https://host/api/v1/app" → "https://host". Null when it isn't an app API base. */
export function hostOfApiBase(apiBase: string, prefix: string): string | null {
  if (!apiBase.endsWith(prefix)) return null;
  const host = apiBase.slice(0, -prefix.length);
  return /^https?:\/\/[^\s/]+$/.test(host) ? host : null;
}

/**
 * The host to use for a club: its own when trusted, else the home host.
 * `home` is "" when the API is on the app's own origin (`origin`).
 */
export function trustedHost(apiBase: string | undefined, prefix: string, home: string, origin: string, trusted: readonly string[]): string {
  const host = apiBase ? hostOfApiBase(apiBase, prefix) : null;
  if (!host) return home;
  if (host === home || host === origin) return host === origin && home === "" ? "" : host;
  return trusted.includes(host) ? host : home;
}
