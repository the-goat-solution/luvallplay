import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDatabaseSwitch } from "../lib/db-switch.ts";

test("database switch: uses the named connection and keeps the original", () => {
  const keep = { ...process.env };
  try {
    process.env.POSTGRES_URL = "postgres://u:p@old-pooler.us-east-1/db";
    process.env.SYD_POSTGRES_URL = "postgres://u:p@new-pooler.ap-southeast-2/db";
    process.env.SYD_POSTGRES_URL_NON_POOLING = "postgres://u:p@new.ap-southeast-2/db";
    delete process.env.POSTGRES_URL_PREVIOUS;
    delete process.env.DATABASE_URL_VAR;
    applyDatabaseSwitch();
    assert.equal(process.env.POSTGRES_URL, "postgres://u:p@old-pooler.us-east-1/db", "no switch without DATABASE_URL_VAR");
    process.env.DATABASE_URL_VAR = "SYD_POSTGRES_URL";
    applyDatabaseSwitch();
    applyDatabaseSwitch(); // idempotent
    assert.equal(process.env.POSTGRES_URL, "postgres://u:p@new-pooler.ap-southeast-2/db");
    assert.equal(process.env.POSTGRES_URL_NON_POOLING, "postgres://u:p@new.ap-southeast-2/db");
    assert.equal(process.env.POSTGRES_URL_PREVIOUS, "postgres://u:p@old-pooler.us-east-1/db");
    process.env.DATABASE_URL_VAR = "MISSING_URL";
    process.env.POSTGRES_URL = "postgres://u:p@old-pooler.us-east-1/db";
    applyDatabaseSwitch();
    assert.equal(process.env.POSTGRES_URL, "postgres://u:p@old-pooler.us-east-1/db", "a missing target leaves the site where it is");
  } finally {
    process.env = keep;
  }
});
