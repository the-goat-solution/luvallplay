// The migration journal's timestamps. The migrator treats every migration
// dated at or before the newest applied one as already applied
// (scripts/db/migrate.mjs, plan()). So a migration dated in the future hides
// every migration written before that time: the migrator calls each one
// "changed after it was applied" instead of running it. This happened when a
// migration was stamped hours ahead and CI's schema-drift rollback test failed
// until the clock caught up. No database needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMigrations } from "../scripts/db/migrate.mjs";

test("migration timestamps strictly increase, in journal order", () => {
  const migrations = loadMigrations();
  for (let i = 1; i < migrations.length; i++) {
    assert.ok(migrations[i].when > migrations[i - 1].when, `${migrations[i].tag} must be dated after ${migrations[i - 1].tag}`);
  }
});

test("no migration is dated in the future", () => {
  const now = Date.now();
  for (const m of loadMigrations()) {
    assert.ok(m.when <= now, `${m.tag} is dated ${new Date(m.when).toISOString()}, after now (${new Date(now).toISOString()}): date it now, not ahead`);
  }
});
