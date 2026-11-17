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
