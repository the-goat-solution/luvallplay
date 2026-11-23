// Drizzle Kit: the database schema in TypeScript (schema.ts) and the
// versioned migrations (migrations/). See README.md.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./schema.ts",
  out: "./migrations",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.POSTGRES_URL ?? "" },
  migrations: { table: "__drizzle_migrations", schema: "drizzle" },
});
