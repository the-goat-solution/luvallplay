import type { MetadataRoute } from "next";
import { getContent } from "@/lib/content";
import { indexingAllowed, siteOrigin } from "@/lib/site";

// Until go-live (Studio → Site settings → Search indexing) nothing may be crawled.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { settings } = await getContent();
  if (!indexingAllowed(settings)) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/en/thanks", "/vi/thanks"] }], sitemap: `${siteOrigin()}/sitemap.xml` };
}
