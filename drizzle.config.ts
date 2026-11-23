// Drizzle Kit: the database schema in TypeScript (db/schema.ts) and the
// versioned migrations (db/migrations). See db/README.md.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.POSTGRES_URL ?? "" },
  migrations: { table: "__drizzle_migrations", schema: "drizzle" },
});
