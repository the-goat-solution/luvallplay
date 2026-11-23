// Preview builds only: brings the preview's own database (a Neon branch of
// production, made by the Vercel–Neon integration) up to this build's
// migrations, so the preview runs the schema its code expects. Runs from
// `prebuild`; does nothing anywhere else.
//
// - Not a preview (production, local, CI) → nothing. Production migrations
//   are a deliberate, rehearsed step (test plan §4.4), never a build step.
// - The preview guard decides first (lib/db-switch.ts): a preview that can't
//   prove its database isn't production gets no database → nothing to do.
// - A branch copied from production before production had a migration
//   history is marked as at the baseline, but only after its schema matches
//   the frozen production dump exactly; then pending migrations run.
import { applyDatabaseSwitch, guardPreviewDatabase } from "../../lib/db-switch.ts";
import { dbClient } from "../db-client.mjs";
import { markBaseline, migrate } from "./migrate.mjs";

const env = process.env;
if (env.VERCEL_ENV !== "preview") process.exit(0);

applyDatabaseSwitch(env);
const verdict = guardPreviewDatabase(env);
if (verdict.blocked) {
  console.log(`[preview-migrate] skipped: ${verdict.reason}`);
  process.exit(0);
}
const url = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL;
if (!url) {
  console.log("[preview-migrate] skipped: this preview has no database");
  process.exit(0);
}

const c = await dbClient(url, "preview-migrate");
await c.connect();
try {
  const log = (m) => console.log(`[preview-migrate] ${m}`);
  const history = (await c.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS r`)).rows[0].r;
  if (!history) await markBaseline(c, { log });
  await migrate(c, { log });
} catch (err) {
  console.error(`[preview-migrate] failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
