// Local and CI only: lets @vercel/postgres (Neon's WebSocket driver) talk to
// a plain local Postgres through scripts/e2e/ws-proxy.mjs, so end-to-end
// tests run against a real database without touching Neon.
//
// Off unless NEON_LOCAL_WS_PROXY is set (e.g. "localhost:5480"), and never on
// the production deployment.
export async function configureLocalNeon(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const proxy = env.NEON_LOCAL_WS_PROXY;
  if (!proxy || env.VERCEL_ENV === "production") return false;
  const { neonConfig } = await import("@neondatabase/serverless");
  neonConfig.wsProxy = () => `${proxy}/v1`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
  // SQL over HTTP (what the `sql` tag uses) goes to the same local stand-in.
  neonConfig.fetchEndpoint = () => `http://${proxy}/sql`;
  return true;
}
