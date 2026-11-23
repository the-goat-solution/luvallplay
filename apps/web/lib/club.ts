// The current club's settings, for server code (Phase 3 step 4).
// lib/club-config.ts holds the logic and takes its database as a parameter;
// this binds it to the app's client.
import { sql } from "./database";
import { getClubConfig, type ClubConfig } from "./club-config";

/** The settings to use for this request. Never throws (built-in values on any error). */
export function clubConfig(): Promise<ClubConfig> {
  return getClubConfig(sql);
}
