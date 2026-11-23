import { sql } from "drizzle-orm";
import { orm } from "../database.ts";

/** One round trip to the database (health check). */
export async function ping(): Promise<void> {
  await orm().execute(sql`SELECT 1`);
}
