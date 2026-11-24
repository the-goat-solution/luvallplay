// The site's own small Postgres (Neon in production, any Postgres locally).
import { Pool } from "pg";

const KEY = Symbol.for("luvallplay.site.pool");
type G = typeof globalThis & { [KEY]?: Pool };

export function dbConfigured(): boolean {
  return !!process.env.SITE_DATABASE_URL;
}

export function db(): Pool {
  const g = globalThis as G;
  if (!g[KEY]) {
    if (!process.env.SITE_DATABASE_URL) throw new Error("SITE_DATABASE_URL is not set");
    g[KEY] = new Pool({ connectionString: process.env.SITE_DATABASE_URL, max: 3, idleTimeoutMillis: 5000 });
  }
  return g[KEY];
}
