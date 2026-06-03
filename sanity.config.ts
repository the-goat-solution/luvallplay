import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { schemaTypes } from "./sanity/schema";
import { dataset, projectId } from "./sanity/env";

export default defineConfig({
  name: "three-wolves",
  title: "Three Wolves Badminton",
  projectId: projectId || "placeholder",
  dataset,
  basePath: "/studio",
  plugins: [structureTool(), visionTool()],
  schema: { types: schemaTypes },
});
