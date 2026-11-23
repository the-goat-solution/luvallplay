// The standard-Postgres client (lib/database-pg.ts) with lib/database.ts's
// surface, for the golden master tests: tests/golden/hook.mjs swaps it in for
// lib/database.ts in the "pg" copy of the app's modules, so that copy runs on
// node-postgres whatever DATABASE_DRIVER says.
import pg from "pg";
import * as schema from "@luvallplay/db/schema";
import { createPgDatabase } from "../../lib/database-pg.ts";

let bound: string | null = null;
const database = createPgDatabase(() => (bound ??= process.env.POSTGRES_URL ?? ""));

export const sql = database.sql;
export const db = sql;
export const types = pg.types;
export const orm = database.orm;
export { schema };
export type DatabaseDriver = "neon" | "postgres";
export const databaseDriver = (): DatabaseDriver => "postgres";
export async function closeDatabase(): Promise<void> {
  bound = null;
  await database.close();
}
