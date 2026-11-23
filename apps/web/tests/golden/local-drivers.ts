// Points BOTH drivers at the local Postgres through scripts/e2e/ws-proxy.mjs:
// the new client's @neondatabase/serverless (1.x) and the copy (0.9.x) that
// @vercel/postgres carries inside its own node_modules.
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

type NeonConfig = {
  wsProxy: unknown;
  useSecureWebSocket: boolean;
  pipelineTLS: boolean;
  pipelineConnect: unknown;
  fetchEndpoint: unknown;
};

function point(cfg: NeonConfig, proxy: string) {
  cfg.wsProxy = () => `${proxy}/v1`;
  cfg.useSecureWebSocket = false;
  cfg.pipelineTLS = false;
  cfg.pipelineConnect = false;
  cfg.fetchEndpoint = () => `http://${proxy}/sql`;
}

export async function pointDriversAt(proxy: string): Promise<void> {
  const fresh = await import("@neondatabase/serverless");
  point(fresh.neonConfig as unknown as NeonConfig, proxy);
  const require = createRequire(import.meta.url);
  // The package's entry is dist/index-node.cjs; its own copy of the driver
  // sits next to dist/ in node_modules.
  const vercelDir = path.resolve(path.dirname(require.resolve("@vercel/postgres")), "..");
  const nested = path.join(vercelDir, "node_modules/@neondatabase/serverless/index.mjs");
  const old = await import(pathToFileURL(nested).href);
  point(old.neonConfig as NeonConfig, proxy);
}
