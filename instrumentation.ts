import { applyDatabaseSwitch, guardPreviewDatabase } from "./lib/db-switch";

// Runs once when a server instance starts, before any request.
export function register(): void {
  applyDatabaseSwitch();
  // Previews never touch the production database (lib/db-switch.ts).
  guardPreviewDatabase();
}
