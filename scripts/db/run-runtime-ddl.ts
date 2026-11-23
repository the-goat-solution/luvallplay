// Transitional (removed with ensureTables() in Phase 2 PR 3): runs every
// module's request-time DDL once against POSTGRES_URL, the way a cold start
// would. The schema drift check uses it to prove the runtime DDL changes
// nothing on a database at the baseline migration.
//
//   NEON_LOCAL_WS_PROXY=localhost:5480 POSTGRES_URL=... node --import ./tests/register.mjs scripts/db/run-runtime-ddl.ts
import { configureLocalNeon } from "../../lib/local-neon.ts";

await configureLocalNeon();
const mods = await Promise.all([
  import("../../lib/db.ts"),
  import("../../lib/player-db.ts"),
  import("../../lib/arena-db.ts"),
  import("../../lib/finance-db.ts"),
  import("../../lib/messages-db.ts"),
  import("../../lib/casual-play-db.ts"),
  import("../../lib/stats-db.ts"),
  import("../../lib/jersey-db.ts"),
  import("../../lib/mini-game-db.ts"),
  import("../../lib/wolf-vision-db.ts"),
  import("../../lib/shop-db.ts"),
  import("../../lib/photos-db.ts"),
  import("../../lib/webhooks.ts"),
]);
const [core, player, arena, finance, messages, casual, stats, jersey, mini, wv, shop, photos, hooks] = mods;
const steps: [string, () => Promise<unknown>][] = [
  ["core", core.ensureTables],
  ["players", player.ensurePlayerTables],
  ["arena", arena.ensureArenaTables],
  ["finance", finance.ensureFinanceTables],
  ["messages", messages.ensureMessageTables],
  ["casual_play", casual.ensureCasualPlayTables],
  ["stats", stats.ensureStatsTables],
  ["jersey", jersey.ensureJerseyTables],
  ["mini_game", mini.ensureMiniGameTables],
  ["wolf_vision", wv.ensureWolfVisionTables],
  ["shop", shop.ensureShopTables],
  ["photos", photos.ensurePhotoTables],
  ["integrations", hooks.ensureIntegrationTables],
];
for (const [name, fn] of steps) {
  await fn();
  console.log(`ran ${name}`);
}
