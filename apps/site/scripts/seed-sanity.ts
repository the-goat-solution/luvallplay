// Pushes the seeded content (content/generated/seed.json) to the site's
// Sanity project. By default it only creates documents that don't exist yet,
// so an editor's changes are never overwritten; `--overwrite` replaces them.
//
//   SANITY_PROJECT_ID=… SANITY_API_WRITE_TOKEN=… pnpm sanity:seed [--overwrite] [--dry-run]
import { readFileSync } from "node:fs";

const projectId = process.env.SANITY_PROJECT_ID;
const dataset = process.env.SANITY_DATASET || "production";
const token = process.env.SANITY_API_WRITE_TOKEN;
const overwrite = process.argv.includes("--overwrite");
const dryRun = process.argv.includes("--dry-run");

const docs = JSON.parse(readFileSync(new URL("../content/generated/seed.json", import.meta.url), "utf8")) as { _id: string; _type: string }[];
// Array members need a _key in Sanity.
const keyed = (node: unknown, path: string): unknown => {
  if (Array.isArray(node)) return node.map((n, i) => (n && typeof n === "object" && !Array.isArray(n) ? { _key: `k${i}`, ...(keyed(n, `${path}${i}`) as object) } : typeof n === "string" ? n : keyed(n, `${path}${i}`)));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, keyed(v, `${path}.${k}`)]));
  return node;
};
const mutations = docs.map((d) => ({ [overwrite ? "createOrReplace" : "createIfNotExists"]: keyed(d, d._id) }));

if (dryRun || !projectId || !token) {
  console.log(`${docs.length} documents ready (${[...new Set(docs.map((d) => d._type))].join(", ")}).`);
  if (!dryRun) console.error("Set SANITY_PROJECT_ID and SANITY_API_WRITE_TOKEN to push them.");
  process.exit(dryRun ? 0 : 1);
}
const res = await fetch(`https://${projectId}.api.sanity.io/v2025-02-19/data/mutate/${dataset}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ mutations }),
});
if (!res.ok) {
  console.error(`Sanity refused (${res.status}): ${await res.text()}`);
  process.exit(1);
}
console.log(`Seeded ${docs.length} documents into ${projectId}/${dataset}${overwrite ? " (overwriting)" : " (new ones only)"}.`);
