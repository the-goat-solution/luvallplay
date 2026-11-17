// Database switch. When DATABASE_URL_VAR names another connection variable
// (for example SYD_POSTGRES_URL, from a database connected with the prefix
// "SYD"), the app uses it as POSTGRES_URL. The original is kept in
// POSTGRES_URL_PREVIOUS for the move's catch-up step. Unset it to switch back.
export function applyDatabaseSwitch(): void {
  const name = process.env.DATABASE_URL_VAR;
  if (!name || name === "POSTGRES_URL") return;
  const url = process.env[name];
  if (!url || url === process.env.POSTGRES_URL) return;
  if (!process.env.POSTGRES_URL_PREVIOUS && process.env.POSTGRES_URL) process.env.POSTGRES_URL_PREVIOUS = process.env.POSTGRES_URL;
  process.env.POSTGRES_URL = url;
  const direct = process.env[`${name}_NON_POOLING`];
  if (direct) process.env.POSTGRES_URL_NON_POOLING = direct;
}
