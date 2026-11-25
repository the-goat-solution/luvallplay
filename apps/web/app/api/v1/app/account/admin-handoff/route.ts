import { appRoute, fail } from "@/lib/app-api";
import { adminHandoff } from "@/lib/app-account";

// The app's "Club admin" button: a single-use link (about a minute) that
// opens the club's admin already signed in, so the app's own token never
// leaves the app. The web's /api/admin/handoff rules, answered with 403
// step_up (not 401) when a fresh code is needed.
const route = appRoute("account.adminHandoff", async ({ session, request }) => {
  const result = await adminHandoff(session!, request.url);
  return result.ok ? { url: result.url, expiresInSeconds: result.expiresInSeconds } : fail(result.status, result.code);
});

export const POST = route.handle;
export const OPTIONS = route.preflight;
