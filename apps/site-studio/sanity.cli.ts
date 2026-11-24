import { defineCliConfig } from "sanity/cli";
import { dataset, projectId } from "./project";

export default defineCliConfig({
  api: { projectId, dataset },
  // `pnpm --filter site-studio deploy` publishes to https://luvallplay.sanity.studio
  studioHost: "luvallplay",
  autoUpdates: false,
});
