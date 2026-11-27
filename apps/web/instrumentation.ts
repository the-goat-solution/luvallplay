import { applyDatabaseSwitch, guardPreviewDatabase } from "./lib/db-switch";

// Runs once when a server instance starts, before any request.
export async function register(): Promise<void> {
  applyDatabaseSwitch();
  // Previews never touch the production database (lib/db-switch.ts).
  guardPreviewDatabase();
  // Production does not start with a malformed key list, a key used for two
  // purposes, or sealed phone lookups without their keys (lib/crypto-health.ts).
  // The production build checks the same thing first (next.config.ts) and
  // fails, so this is the backstop for a variable changed without a build.
  // Environment only, no database. Loaded here, on the Node runtime only: it
  // needs node:crypto, which the edge runtime doesn't have.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.VERCEL_ENV === "production") {
    const { guardProductionKeys } = await import("./lib/crypto-health");
    guardProductionKeys();
  }
  // Local end-to-end tests only (lib/local-neon.ts); a no-op everywhere else.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEON_LOCAL_WS_PROXY) {
    const { configureLocalNeon } = await import("./lib/local-neon");
    await configureLocalNeon();
  }
}
