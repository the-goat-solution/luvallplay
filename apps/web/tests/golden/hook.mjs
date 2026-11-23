// Golden master loader hook: a module imported with "?golden=legacy" — and
// everything it imports from the app — is a separate copy that uses the old
// client (tests/golden/legacy-database.ts) instead of lib/database.ts. The
// unmarked copy uses the new client. Both run side by side in one process.
const LEGACY_CLIENT = new URL("./legacy-database.ts", import.meta.url).href;
const NEXT_SERVER = new URL("./next-server.ts", import.meta.url).href;
const PG_CLIENT = new URL("./pg-database.ts", import.meta.url).href;
// "golden=legacy": the old client. "golden=pg": the standard-Postgres driver.
// "golden=rls": the new client again, as its own copy, run as the app's role
// through row-level security (TENANT_SCOPE=enforce).
const MARKS = ["golden=legacy", "golden=pg", "golden=rls"];

export async function resolve(specifier, context, next) {
  // The app's modules get after() that the test can wait for (both copies).
  if (specifier === "next/server" && context.parentURL?.includes("/lib/")) return { url: NEXT_SERVER, shortCircuit: true };
  const mark = MARKS.find((m) => context.parentURL?.includes(m) || specifier.includes(m));
  const result = await next(mark ? specifier.replace(`?${mark}`, "") : specifier, context);
  if (!mark || !result.url.startsWith("file:") || result.url.includes("/node_modules/")) return result;
  let url = result.url.split("?")[0];
  if (url.endsWith("/lib/database.ts") && mark !== "golden=rls") url = mark === "golden=pg" ? PG_CLIENT : LEGACY_CLIENT;
  return { ...result, url: `${url}?${mark}` };
}
