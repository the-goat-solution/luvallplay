// The Luvallplay website's own Sanity project (decision D): separate from the
// Three Wolves project. The id is public (it appears in image URLs).
// Set once the project exists: see docs/plans/phase-6-runbook.md.
export const projectId = process.env.SANITY_STUDIO_PROJECT_ID || "REPLACE_WITH_PROJECT_ID";
export const dataset = process.env.SANITY_STUDIO_DATASET || "production";
