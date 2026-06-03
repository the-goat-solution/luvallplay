import { createClient } from "next-sanity";
import { apiVersion, dataset, projectId, useCdn } from "@/sanity/env";

export const sanityConfigured = Boolean(projectId);

export const sanityClient = createClient({
  projectId: projectId || "placeholder",
  dataset,
  apiVersion,
  useCdn,
  token: process.env.SANITY_API_READ_TOKEN,
});

export type LocaleString = { en?: string; vi?: string };
export type LocaleText = { en?: string; vi?: string };

export function pickLocale<T extends LocaleString | LocaleText | undefined>(
  value: T,
  lang: "en" | "vi",
): string {
  if (!value) return "";
  return (lang === "vi" ? value.vi : value.en) || value.en || value.vi || "";
}
