import type { MetadataRoute } from "next";
import { getContent } from "@/lib/content";
import { originFor, STATIC_PATHS } from "@/lib/site";
import { LANGS } from "@/lib/types";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const content = await getContent();
  const paths = [...STATIC_PATHS, ...content.help.map((h) => `/help/${h.slug}`)];
  return paths.flatMap((path) =>
    LANGS.map((lang) => ({
      url: `${originFor(lang)}/${lang}${path}`,
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.7,
      alternates: { languages: Object.fromEntries(LANGS.map((l) => [l, `${originFor(l)}/${l}${path}`])) },
    })),
  );
}
