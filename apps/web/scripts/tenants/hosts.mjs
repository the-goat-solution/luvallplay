// The host table for the edge lookup (lib/tenant-routing.ts): every host a
// club answers on → { tenant, region }, read from the tenants table.
//
//   node --import ./tests/register.mjs scripts/tenants/hosts.mjs            # print the items
//   node --import ./tests/register.mjs scripts/tenants/hosts.mjs --check    # compare with Edge Config
//
// Read-only. It prints the items to put in Edge Config (keys as
// hostKey() makes them); with --check and EDGE_CONFIG set it reads each key
// back and exits 1 if the copy differs from the database. The copy is only a
// cache: a host missing from it is still found in the database.
import { hostKey, hostsForTenant } from "@luvallplay/core/host-routing";
import { dbClient } from "../db-client.mjs";
import { edgeConfigLookup, routingOptions } from "../../lib/tenant-routing.ts";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}
const client = await dbClient(url, "tenant-hosts");
await client.connect();
let items;
try {
  const { rows } = await client.query(`SELECT slug, region, custom_domain FROM tenants ORDER BY id`);
  const domain = routingOptions().platformDomains[0];
  items = rows.flatMap((t) => hostsForTenant({ slug: t.slug, customDomain: t.custom_domain }, domain).map((host) => ({ host, key: hostKey(host), value: { tenant: t.slug, region: t.region } })));
} finally {
  await client.end();
}

if (!process.argv.includes("--check")) {
  console.log(JSON.stringify(Object.fromEntries(items.map((i) => [i.key, i.value])), null, 2));
  process.exit(0);
}
const connection = process.env.EDGE_CONFIG;
if (!connection) {
  console.error("EDGE_CONFIG is not set: nothing to compare with.");
  process.exit(2);
}
let bad = 0;
for (const item of items) {
  const got = await edgeConfigLookup(connection, item.host);
  const ok = got && got.tenant === item.value.tenant && got.region === item.value.region;
  if (!ok) bad++;
  console.log(`${ok ? "ok    " : "DIFFER"} ${item.host} → ${got === undefined ? "(no answer)" : got === null ? "(missing)" : `${got.tenant} @ ${got.region}`}`);
}
console.log(bad ? `\n${bad} host(s) differ from the database.` : "\nEdge Config matches the database.");
process.exitCode = bad ? 1 : 0;
