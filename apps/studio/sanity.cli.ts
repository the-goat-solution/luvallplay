import { defineCliConfig } from "sanity/cli";

export default defineCliConfig({
  api: { projectId: "c0v5j4dz", dataset: "production" },
  // `pnpm --filter studio deploy` publishes to https://threewolves.sanity.studio
  studioHost: "threewolves",
  // The Studio runs exactly the version in pnpm-lock.yaml (no runtime auto-updates).
  autoUpdates: false,
});
