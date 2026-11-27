import { applyDatabaseSwitch, guardPreviewDatabase } from "./lib/db-switch";
import { assertDeploymentSettings } from "./lib/tenant-settings";

// Runs once when a server instance starts, before any request.
export async function register(): Promise<void> {
  applyDatabaseSwitch();
  // Previews never touch the production database (lib/db-switch.ts).
  guardPreviewDatabase();
  // Which club, how scoped, whose settings: production must say (audit H1, C7; lib/tenant-settings.ts).
  assertDeploymentSettings();
  // Local end-to-end tests only (lib/local-neon.ts); a no-op everywhere else.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEON_LOCAL_WS_PROXY) {
    const { configureLocalNeon } = await import("./lib/local-neon");
    await configureLocalNeon();
  }
}
