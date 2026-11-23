// Golden master loader hook: a module imported with "?golden=legacy" — and
// everything it imports from the app — is a separate copy that uses the old
// client (tests/golden/legacy-database.ts) instead of lib/database.ts. The
// unmarked copy uses the new client. Both run side by side in one process.
const LEGACY_CLIENT = new URL("./legacy-database.ts", import.meta.url).href;
const NEXT_SERVER = new URL("./next-server.ts", import.meta.url).href;
const MARK = "golden=legacy";

export async function resolve(specifier, context, next) {
  // The app's modules get after() that the test can wait for (both copies).
  if (specifier === "next/server" && context.parentURL?.includes("/lib/")) return { url: NEXT_SERVER, shortCircuit: true };
  const legacy = Boolean(context.parentURL?.includes(MARK)) || specifier.includes(MARK);
  const result = await next(specifier.replace(`?${MARK}`, ""), context);
  if (!legacy || !result.url.startsWith("file:") || result.url.includes("/node_modules/")) return result;
  let url = result.url.split("?")[0];
  if (url.endsWith("/lib/database.ts")) url = LEGACY_CLIENT;
  return { ...result, url: `${url}?${MARK}` };
}
