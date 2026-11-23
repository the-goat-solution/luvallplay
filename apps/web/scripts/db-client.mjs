// One Postgres client for the operator scripts (data guard, migrations,
// grant-role). Default: node-postgres over TCP, as before.
//
// DB_DRIVER=neon-ws: Neon's WebSocket protocol on port 443 through the
// HTTPS_PROXY, for machines that can only reach the internet through an
// HTTPS proxy (the cloud build sessions). Same client API (connect, query,
// end, transactions), so nothing else changes.
import pg from "pg";

export async function dbClient(url, applicationName) {
  if (process.env.DB_DRIVER !== "neon-ws") {
    return new pg.Client({ connectionString: url, application_name: applicationName });
  }
  const { Client, neonConfig } = await import("@neondatabase/serverless");
  const { default: WebSocket } = await import("ws");
  const { HttpsProxyAgent } = await import("https-proxy-agent");
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  neonConfig.webSocketConstructor = class ProxiedWebSocket extends WebSocket {
    constructor(address, protocols) {
      super(address, protocols, agent ? { agent } : {});
    }
  };
  // The data guard reads raw text values like node-postgres does by default.
  return new Client({ connectionString: url });
}

/**
 * For scripts that run the app's own database client (lib/database.ts):
 * with DB_DRIVER=neon-ws, its WebSocket pool goes through HTTPS_PROXY too.
 * Call before the first query. (Its HTTP queries need NODE_USE_ENV_PROXY=1.)
 */
export async function proxyAppDatabaseClient() {
  if (process.env.DB_DRIVER !== "neon-ws") return;
  const { neonConfig } = await import("@neondatabase/serverless");
  const { default: WebSocket } = await import("ws");
  const { HttpsProxyAgent } = await import("https-proxy-agent");
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  neonConfig.webSocketConstructor = class ProxiedWebSocket extends WebSocket {
    constructor(address, protocols) {
      super(address, protocols, agent ? { agent } : {});
    }
  };
  // HTTP queries go to the database's own host (it serves /sql too), not the
  // regional api.* host, so a network allowlist only needs the one host.
  neonConfig.fetchEndpoint = (host) => `https://${host}/sql`;
}
