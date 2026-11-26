// Where a webhook may be sent (audit: the SSRF filter was hostname-only).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type dns from "node:dns";
import { isAllowedWebhookUrl, isPrivateAddress, postToPublicHost } from "../lib/webhook-target.ts";

describe("the address a player may save", () => {
  test("public https names are fine", () => {
    for (const url of ["https://hooks.example.com/tw", "https://example.org", "https://a.b-c.example.co.nz:8443/path?x=1", "https://xn--bcher-kva.example.com/"]) assert.equal(isAllowedWebhookUrl(url), true, url);
  });
  test("anything that isn't a public https name is refused", () => {
    const refused = [
      "http://hooks.example.com/", // not https
      "ftp://hooks.example.com/",
      "https://localhost/", "https://localhost./", "https://LOCALHOST/", "https://app.localhost/",
      "https://hooks.example.com./", // a trailing dot is never needed
      "https://printer.local/", "https://db.internal/", "https://router.lan/", "https://intranet/", "https://nas.home/",
      "https://127.0.0.1/", "https://10.0.0.8/", "https://169.254.169.254/latest/meta-data/",
      "https://2130706433/", "https://0x7f.0.0.1/", "https://0177.0.0.1/", "https://127.1/", // other spellings of 127.0.0.1
      "https://[::1]/", "https://[fd00::1]/", "https://[::ffff:10.0.0.1]/",
      "https://user:pass@hooks.example.com/", "https://user@hooks.example.com/",
      "https://hooks.example.123/", // a numeric top-level domain is an address in disguise
      "https://-bad-.example.com/", "https://under_score.example.com/",
      "not a url", "", "https://",
    ];
    for (const url of refused) assert.equal(isAllowedWebhookUrl(url), false, url);
  });
});

describe("addresses that aren't public", () => {
  test("private, loopback, link-local, metadata, shared, reserved and wrapped addresses", () => {
    const privateOnes = [
      "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "192.0.2.1", "198.18.0.1", "198.51.100.7", "203.0.113.9",
      "224.0.0.1", "240.0.0.1", "255.255.255.255",
      "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "64:ff9b::a00:1", "2002:a00:1::1",
      "::ffff:10.0.0.1", "::ffff:127.0.0.1", "::ffff:a00:1",
      "not-an-address", "",
    ];
    for (const a of privateOnes) assert.equal(isPrivateAddress(a), true, a);
  });
  test("public addresses pass", () => {
    for (const a of ["1.1.1.1", "8.8.8.8", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.253.0.1", "193.0.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) assert.equal(isPrivateAddress(a), false, a);
  });
});

describe("delivery only ever connects to a public address", () => {
  type Cb = (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void;
  const resolvesTo = (...addresses: string[]) => (_host: string, _options: unknown, cb: Cb) => cb(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  const headers = { "Content-Type": "application/json" };

  test("a public name that points inside is refused before anything is sent", async () => {
    // Something is really listening on this machine: if the guard let the connection through, it would be hit.
    let hits = 0;
    const server = http.createServer((_req, res) => { hits++; res.end("secret"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      for (const inside of [["127.0.0.1"], ["10.1.2.3"], ["169.254.169.254"], ["::1"], ["fd00::5"], ["::ffff:192.168.0.9"]]) {
        assert.deepEqual(await postToPublicHost("https://rebind.example.com/hook", headers, "{}", { lookup: resolvesTo(...inside) }), { ok: false, error: "blocked" }, inside[0]);
      }
      // One public address among private ones doesn't make the name public.
      assert.deepEqual(await postToPublicHost("https://mixed.example.com/hook", headers, "{}", { lookup: resolvesTo("93.184.216.34", "10.0.0.1") }), { ok: false, error: "blocked" });
      assert.deepEqual(await postToPublicHost("https://empty.example.com/hook", headers, "{}", { lookup: resolvesTo() }), { ok: false, error: "blocked" });
    } finally {
      server.close();
    }
    assert.equal(hits, 0);
  });

  test("an address that was saved before the rules tightened is still refused at delivery, without a lookup", async () => {
    let looked = 0;
    const lookup = (_h: string, _o: unknown, cb: Cb) => { looked++; cb(null, [{ address: "93.184.216.34", family: 4 }]); };
    for (const url of ["https://localhost./x", "https://127.0.0.1/x", "http://hooks.example.com/x", "https://db.internal/x"]) {
      assert.deepEqual(await postToPublicHost(url, headers, "{}", { lookup }), { ok: false, error: "blocked" }, url);
    }
    assert.equal(looked, 0);
  });

  test("what is reported about a failure is a fixed word, never the network's own message", async () => {
    const notFound = (_h: string, _o: unknown, cb: Cb) => cb(Object.assign(new Error("getaddrinfo ENOTFOUND secret-host.corp 10.9.8.7"), { code: "ENOTFOUND" }), []);
    assert.deepEqual(await postToPublicHost("https://nowhere.example.com/x", headers, "{}", { lookup: notFound }), { ok: false, error: "unreachable" });
    const never = () => {};
    assert.deepEqual(await postToPublicHost("https://slow.example.com/x", headers, "{}", { lookup: never, timeoutMs: 150 }), { ok: false, error: "timeout" });
  });
});
