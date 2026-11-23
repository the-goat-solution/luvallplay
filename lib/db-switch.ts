// Database switch. When DATABASE_URL_VAR names another connection variable
// (for example SYD_POSTGRES_URL, from a database connected with the prefix
// "SYD"), the app uses it as POSTGRES_URL. The site runs on the Sydney
// database this way (DATABASE_URL_VAR=SYD_POSTGRES_URL); the old US database
// it replaced is gone.
export function applyDatabaseSwitch(): void {
  const name = process.env.DATABASE_URL_VAR;
  if (!name || name === "POSTGRES_URL") return;
  const url = process.env[name];
  if (!url || url === process.env.POSTGRES_URL) return;
  process.env.POSTGRES_URL = url;
  const direct = process.env[`${name}_NON_POOLING`];
  if (direct) process.env.POSTGRES_URL_NON_POOLING = direct;
}

// ---------------------------------------------------------------------------
// Preview database guard (test plan §0 rule 1: previews never touch
// production data).
//
// Until every preview runs on its own Neon branch, a preview deployment shares
// the production connection variables, and `ensureTables()` runs DDL at
// request time: opening a preview of a schema change would alter production.
//
// This guard runs before any request (instrumentation.ts) and at build
// (next.config.ts). On a PREVIEW it keeps the database only when it can prove
// the database isn't production:
//
//   PRODUCTION_DATABASE_HOSTS  comma-separated production database host(s),
//                              set on the Preview environment in Vercel.
//
// - Not set → the preview can't prove anything → database switched off.
// - Set, and the preview's host is one of them → database switched off.
// - Set, and the host is different (a Neon branch) → database kept.
//
// "Switched off" removes the connection variables, so lib/database.ts has
// nothing to connect to: no DDL, no writes, no reads of members' data. Pages
// already degrade without POSTGRES_URL (the `hasDb` checks). Production,
// local and CI are untouched.

const CONNECTION_VARS = [
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL_NO_SSL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
];

/** Neon endpoint id from a host: the pooled and direct hosts are the same database. */
export function databaseEndpoint(host: string): string {
  const first = host.trim().toLowerCase().split(".")[0] ?? "";
  return first.replace(/-pooler$/, "");
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export type PreviewGuardResult = { blocked: false } | { blocked: true; reason: string };

export function previewDatabaseVerdict(env: Record<string, string | undefined> = process.env): PreviewGuardResult {
  if (env.VERCEL_ENV !== "preview") return { blocked: false };
  const host = hostOf(env.POSTGRES_URL) ?? hostOf(env.POSTGRES_URL_NON_POOLING);
  if (!host) return { blocked: false };
  const production = (env.PRODUCTION_DATABASE_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean)
    .map(databaseEndpoint);
  if (production.length === 0) {
    return { blocked: true, reason: "PRODUCTION_DATABASE_HOSTS is not set, so this preview can't prove it has its own database" };
  }
  if (production.includes(databaseEndpoint(host))) {
    return { blocked: true, reason: "this preview is connected to the production database" };
  }
  return { blocked: false };
}

/** Switches the database off on a preview that can't prove it's isolated. */
export function guardPreviewDatabase(env: Record<string, string | undefined> = process.env): PreviewGuardResult {
  const verdict = previewDatabaseVerdict(env);
  if (!verdict.blocked) return verdict;
  for (const name of CONNECTION_VARS) delete env[name];
  const target = env.DATABASE_URL_VAR;
  if (target) {
    delete env[target];
    delete env[`${target}_NON_POOLING`];
  }
  env.PREVIEW_DATABASE_BLOCKED = verdict.reason;
  return verdict;
}
