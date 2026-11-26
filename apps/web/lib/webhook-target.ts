// Where a webhook may be sent (audit: "Webhook SSRF filter is hostname-only").
//
// A player gives us an address and we POST their data to it from inside our
// network. The address must therefore be a public one. Checking the NAME is
// not enough: "localhost." passes a name check, and any public name can be
// pointed at 10.x, 169.254.169.254 (cloud metadata) or 127.0.0.1. So:
//
// 1. isAllowedWebhookUrl(): the shape, when the address is saved (https, a
//    real host name, no credentials, nothing that is plainly internal).
// 2. postToPublicHost(): at delivery, every address the name resolves to is
//    checked, and the connection is made to exactly the address that was
//    checked (the check is the connection's own DNS lookup, so the name
//    can't answer differently a moment later). Redirects aren't followed.
//
// What is stored and shown about a failure is one of a few fixed words, never
// the network's own message, so a webhook can't be used to map what is
// reachable from inside.
import dns from "node:dns";
import https from "node:https";
import net from "node:net";

const blocked = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 3], // multicast and reserved (224/4, 240/4, broadcast)
] as const) blocked.addSubnet(prefix, bits, "ipv4");
for (const [prefix, bits] of [
  ["::", 127], // unspecified and loopback
  ["64:ff9b::", 96], // IPv4 through NAT64
  ["64:ff9b:1::", 48], // local NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (wraps an IPv4 address)
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) blocked.addSubnet(prefix, bits, "ipv6");

/** True unless `address` is a public, routable IP address. */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    // ::ffff:a.b.c.d is that IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    if (/^::ffff:/i.test(address)) return true;
    return blocked.check(address, "ipv6");
  }
  return true; // not an address at all
}

/** Only public https URLs (no internal hosts) may receive player data. The shape only: delivery checks where the name really leads. */
export function isAllowedWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    // A name, not an address: IPv4 (the parser has already turned 0x7f.1 and 2130706433 into dotted form) or [IPv6].
    if (net.isIP(host) || host.startsWith("[")) return false;
    // "localhost." is localhost; a trailing dot is never needed.
    if (host.endsWith(".")) return false;
    // A public name has a dot and a top-level domain that isn't a number.
    const labels = host.split(".");
    if (labels.length < 2 || labels.some((l) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l)) || /^\d+$/.test(labels[labels.length - 1])) return false;
    const tld = labels[labels.length - 1];
    if (host === "localhost" || ["localhost", "local", "internal", "lan", "home", "corp", "intranet", "test", "invalid", "example"].includes(tld)) return false;
    return true;
  } catch {
    return false;
  }
}

export type DeliveryOutcome =
  | { ok: true; status: number }
  /** A fixed word, safe to store and show: "HTTP 500", "blocked", "unreachable", "timeout". */
  | { ok: false; error: string };

type Lookup = (hostname: string, options: dns.LookupAllOptions, callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void;

class BlockedAddress extends Error {}

/**
 * POSTs `body` to an https URL, refusing any address that isn't public.
 * `lookup` is the name resolver (tests pass their own).
 */
export function postToPublicHost(
  url: string,
  headers: Record<string, string>,
  body: string,
  { timeoutMs = 5000, lookup = dns.lookup as unknown as Lookup }: { timeoutMs?: number; lookup?: Lookup } = {},
): Promise<DeliveryOutcome> {
  return new Promise((resolve) => {
    if (!isAllowedWebhookUrl(url)) return resolve({ ok: false, error: "blocked" });
    let settled = false;
    const done = (outcome: DeliveryOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    // The connection's own lookup: whatever it returns is what gets connected to.
    const guarded = ((hostname: string, options: unknown, callback: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void) => {
      lookup(hostname, { all: true }, (err, addresses) => {
        if (err) return callback(err);
        if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) return callback(new BlockedAddress("not a public address"));
        if ((options as { all?: boolean } | null)?.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
      });
    }) as unknown as net.LookupFunction;
    const req = https.request(url, { method: "POST", headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) }, lookup: guarded, agent: false }, (res) => {
      res.resume(); // the answer's body isn't read or kept
      const status = res.statusCode ?? 0;
      done(status >= 200 && status < 300 ? { ok: true, status } : { ok: false, error: `HTTP ${status}` });
    });
    const timer = setTimeout(() => {
      done({ ok: false, error: "timeout" });
      req.destroy();
    }, timeoutMs);
    req.on("error", (err) => done({ ok: false, error: err instanceof BlockedAddress ? "blocked" : "unreachable" }));
    req.end(body);
  });
}
