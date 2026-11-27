// Builds the players' app (apps/app) into apps/native/www for the shell.
//
// The store app talks to the public API host, never to "this page's own
// origin" (inside the shell that is https://localhost), so the host is
// required: NATIVE_API_BASE, e.g. https://www.threewolvesbadminton.org today,
// https://api.luvallplay.com once that is the home host.
//
//   NATIVE_API_BASE=https://… pnpm --filter native web && pnpm --filter native sync
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const apiBase = (process.env.NATIVE_API_BASE ?? "").replace(/\/+$/, "");
if (!/^https:\/\/[^\s/]+$/.test(apiBase)) {
  console.error("Set NATIVE_API_BASE to the public API host (https://…, no path): the store app can't use its own origin.");
  process.exit(1);
}
const appDir = path.resolve(import.meta.dirname, "..", "..", "app");
const out = path.resolve(import.meta.dirname, "..", "www");
// Push notifications are in the build only when the Firebase project's file is
// there (android/app/google-services.json, not in the repository): without
// it, asking Android for a device address would stop the app.
const push = ["android/app/google-services.json", "ios/App/App/GoogleService-Info.plist"].some((f) => existsSync(path.resolve(import.meta.dirname, "..", f)));
console.log(push ? "Push notifications: on (Firebase file found)." : "Push notifications: off (no android/app/google-services.json or ios/App/App/GoogleService-Info.plist).");
const build = spawnSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir"], {
  cwd: appDir,
  stdio: "inherit",
  env: { ...process.env, VITE_API_BASE: apiBase, VITE_PUSH: push ? "1" : "" },
});
process.exit(build.status ?? 1);
