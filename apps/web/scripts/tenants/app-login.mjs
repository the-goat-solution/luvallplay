// Checks the app's own database login before it is given to the app
// (runbook §11.2). Read-only.
//
//   APP_DATABASE_URL=... node --import ./tests/register.mjs scripts/tenants/app-login.mjs
//   node --import ./tests/register.mjs scripts/tenants/app-login.mjs --sql    print the SQL that creates the login
//
// Exit 1 on any problem. Prints no connection string and no password.
// DB_DRIVER=neon-ws works as in the other operator scripts.
import { dbClient } from "../db-client.mjs";
import { appLoginSql, checkAppLogin } from "../../lib/app-login.ts";
import { defaultTenantSlug } from "../../lib/tenant-members.ts";

if (process.argv.includes("--sql")) {
  console.log(appLoginSql("luvallplay_web"));
  process.exit(0);
}
const url = process.env.APP_DATABASE_URL;
if (!url) {
  console.error("APP_DATABASE_URL is not set.");
  process.exit(2);
}
const client = await dbClient(url, "app-login-check");
await client.connect();
try {
  const problems = await checkAppLogin({ query: (text, params) => client.query(text, params) }, defaultTenantSlug());
  for (const p of problems) console.log(`  ✖ ${p}`);
  console.log(problems.length ? `\nRESULT: ${problems.length} problem(s). Don't give this login to the app.` : "RESULT: the login is safe to give to the app.");
  process.exitCode = problems.length ? 1 : 0;
} finally {
  await client.end();
}
