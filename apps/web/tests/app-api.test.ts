// lib/app-api.ts: the pure parts of the players' app API wrapper. The routes
// themselves are exercised end to end (tests/e2e/journeys.mjs, "API").
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOrigins, corsHeaders, sessionTokenFrom } from "../lib/app-api.ts";

const req = (headers: Record<string, string>) => new Request("https://club.example/api/v1/app/auth/session", { headers });

test("CORS: the app host and the Capacitor web views, never a wildcard", () => {
  const prod = allowedOrigins({ NODE_ENV: "production" });
  assert.deepEqual(prod, ["https://app.luvallplay.com", "capacitor://localhost", "https://localhost"]);
  assert.ok(!prod.includes("*"));
});

test("CORS: APP_ORIGINS adds exact origins and ignores anything that isn't one", () => {
  const list = allowedOrigins({ NODE_ENV: "production", APP_ORIGINS: "https://luvallplay-app.vercel.app/, *, https://x.example/path, javascript:alert(1), http://ok.example" });
  assert.ok(list.includes("https://luvallplay-app.vercel.app"));
  assert.ok(list.includes("http://ok.example"));
  assert.ok(!list.includes("*"));
  assert.ok(!list.some((o) => o.includes("/path") || o.startsWith("javascript")));
});

test("CORS: local dev servers are allowed outside production only", () => {
  assert.ok(allowedOrigins({ NODE_ENV: "development" }).includes("http://localhost:5173"));
  assert.ok(!allowedOrigins({ NODE_ENV: "production" }).includes("http://localhost:5173"));
});

test("CORS headers: an allowed origin is echoed with credentials; any other gets none", () => {
  const ok = corsHeaders(req({ origin: "capacitor://localhost" }));
  assert.equal(ok["Access-Control-Allow-Origin"], "capacitor://localhost");
  assert.equal(ok["Access-Control-Allow-Credentials"], "true");
  assert.match(ok["Access-Control-Allow-Headers"], /Authorization/);
  assert.equal(ok.Vary, "Origin");
  for (const origin of ["https://evil.example", "https://app.luvallplay.com.evil.example", "null", "https://APP.luvallplay.com"]) {
    const no = corsHeaders(req({ origin }));
    assert.equal(no["Access-Control-Allow-Origin"], undefined, origin);
    assert.equal(no["Access-Control-Allow-Credentials"], undefined, origin);
  }
  assert.equal(corsHeaders(req({}))["Cache-Control"], "no-store");
});

test("session token: the bearer header first, then the web's cookie", () => {
  assert.deepEqual(sessionTokenFrom(req({ authorization: "Bearer abc123" })), { token: "abc123", via: "bearer" });
  assert.deepEqual(sessionTokenFrom(req({ authorization: "bearer   abc123  " })), { token: "abc123", via: "bearer" });
  assert.deepEqual(sessionTokenFrom(req({ cookie: "x=1; tw_player=cookie-token; y=2" })), { token: "cookie-token", via: "cookie" });
  assert.deepEqual(sessionTokenFrom(req({ authorization: "Bearer abc", cookie: "tw_player=cookie-token" })), { token: "abc", via: "bearer" });
  assert.equal(sessionTokenFrom(req({})), null);
  assert.equal(sessionTokenFrom(req({ authorization: "Basic abc" })), null);
});

test("session token: a personal access key (tw_…) is not a session", () => {
  assert.equal(sessionTokenFrom(req({ authorization: "Bearer tw_abcdef" })), null);
  // …and doesn't hide a real cookie session on the same request.
  assert.deepEqual(sessionTokenFrom(req({ authorization: "Bearer tw_abcdef", cookie: "tw_player=c" })), { token: "c", via: "cookie" });
});

test("session token: a broken cookie value is ignored, not an error", () => {
  assert.equal(sessionTokenFrom(req({ cookie: "tw_player=%E0%A4%A" })), null);
});
