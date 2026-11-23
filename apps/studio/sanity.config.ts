import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { schemaTypes } from "./schema";

// Three Wolves' content (home page text, schedule, gallery, reviews, plans
// that predate the database). Deployed on its own (Phase 2) to
// https://threewolves.sanity.studio; the site's /studio redirects there.
// The project id and dataset are public: the site reads them in the browser.
export const projectId = "c0v5j4dz";
export const dataset = "production";

export default defineConfig({
  name: "three-wolves",
  title: "Three Wolves Badminton",
  projectId,
  dataset,
  plugins: [structureTool(), visionTool()],
  schema: { types: schemaTypes },
});
