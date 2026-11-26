// lib/app-api.ts: the pure parts of the players' app API wrapper. The routes
// themselves are exercised end to end (tests/e2e/journeys.mjs, "API").
import { test } from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_APP_ORIGIN, allowedOrigins, appReturnOrigin, corsHeaders, sessionTokenFrom } from "../lib/app-api.ts";

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

test("where Stripe sends people back: the store app's web view gets the app's public address; a browser's origin is unchanged; anything else goes to the website", () => {
  const prod = { NODE_ENV: "production" };
  assert.equal(PUBLIC_APP_ORIGIN, "https://app.luvallplay.com");
  // The store app's web view, and only its two origins.
  assert.equal(appReturnOrigin("https://localhost", prod), "https://app.luvallplay.com");
  assert.equal(appReturnOrigin("capacitor://localhost", prod), "https://app.luvallplay.com");
  // Browser callers: exactly as before.
  assert.equal(appReturnOrigin("https://app.luvallplay.com", prod), "https://app.luvallplay.com");
  assert.equal(appReturnOrigin("https://luvallplay-app.vercel.app", { ...prod, APP_ORIGINS: "https://luvallplay-app.vercel.app" }), "https://luvallplay-app.vercel.app");
  assert.equal(appReturnOrigin("http://localhost:5173", { NODE_ENV: "development" }), "http://localhost:5173");
  // Not allowed: null (the caller falls back to the website), never the origin and never the app's address.
  for (const origin of [null, "", "https://evil.example", "http://localhost", "https://localhost:8443", "https://localhost.evil.example", "capacitor://evil", "http://localhost:5173", "null"]) {
    assert.equal(appReturnOrigin(origin, prod), null, String(origin));
  }
});
