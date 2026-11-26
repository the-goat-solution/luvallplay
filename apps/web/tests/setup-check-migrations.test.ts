// Admin → Setup check, "Database schema" (lib/setup-check.ts): the migration
// history lives in the `drizzle` schema, which the app's database role has no
// rights on. A read that is refused must not be reported as "no history".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { newestMigrationApplied } from "../lib/setup-check.ts";

const answering = (rows: Record<string, unknown>[]) => ({ query: async () => ({ rows }) });
const failing = (code: string) => ({
  query: async () => {
    throw Object.assign(new Error("refused"), { code });
  },
});

describe("newestMigrationApplied", () => {
  test("the newest migration's time, as a number", async () => {
    assert.equal(await newestMigrationApplied(answering([{ at: "1764000000000" }])), 1764000000000);
  });

  test("an empty history, a missing table and a missing schema are all 'no history'", async () => {
    assert.equal(await newestMigrationApplied(answering([{ at: null }])), null);
    assert.equal(await newestMigrationApplied(failing("42P01")), null);
    assert.equal(await newestMigrationApplied(failing("3F000")), null);
  });

  test("a refused read is 'unreadable', not 'no history'", async () => {
    assert.equal(await newestMigrationApplied(failing("42501")), "unreadable");
  });

  test("asks for the history table by its schema", async () => {
    let asked = "";
    await newestMigrationApplied({ query: async (text: string) => ((asked = text), { rows: [] }) });
    assert.match(asked, /FROM drizzle\.__drizzle_migrations/);
  });
});
