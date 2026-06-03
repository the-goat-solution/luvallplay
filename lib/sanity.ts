import { createClient, type QueryParams } from "next-sanity";
import imageUrlBuilder from "@sanity/image-url";
import type { SanityImageSource } from "@sanity/image-url/lib/types/types";
import { apiVersion, dataset, projectId, useCdn } from "@/sanity/env";

export const sanityConfigured = Boolean(projectId);

export const SANITY_CACHE_TAG = "sanity";

export const sanityClient = createClient({
  projectId: projectId || "placeholder",
  dataset,
  apiVersion,
  useCdn,
  token: process.env.SANITY_API_READ_TOKEN,
});

const builder = imageUrlBuilder(sanityClient);

export function urlFor(source: SanityImageSource) {
  return builder.image(source);
}

/** Fetch with Next.js cache tags so webhooks can purge via revalidateTag. */
export async function sanityFetch<QueryResult>({
  query,
  params = {},
}: {
  query: string;
  params?: QueryParams;
}): Promise<QueryResult> {
  return sanityClient.fetch<QueryResult>(query, params, {
    cache: "force-cache",
    next: {
      revalidate: false,
      tags: [SANITY_CACHE_TAG],
    },
  });
}

export type LocaleString = { en?: string; vi?: string };
export type LocaleText = { en?: string; vi?: string };

export function pickLocale<T extends LocaleString | LocaleText | undefined>(
  value: T,
  lang: "en" | "vi",
): string {
  if (!value) return "";
  return (lang === "vi" ? value.vi : value.en) || value.en || value.vi || "";
}
