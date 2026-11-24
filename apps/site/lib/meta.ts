// Page metadata: canonical, hreflang, Open Graph and the noindex rule.
import type { Metadata } from "next";
import { indexingAllowed, originFor } from "./site";
import { LANGS, type Content, type Lang } from "./types";

export function pageMeta(lang: Lang, path: string, title: string, description: string, content: Content): Metadata {
  const url = (l: Lang) => `${originFor(l)}/${l}${path}`;
  const index = indexingAllowed(content.settings);
  return {
    title,
    description,
    alternates: {
      canonical: url(lang),
      languages: { ...Object.fromEntries(LANGS.map((l) => [l, url(l)])), "x-default": url("en") },
    },
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title,
      description,
      url: url(lang),
      siteName: "Luvallplay",
      locale: lang === "vi" ? "vi_VN" : "en_NZ",
      alternateLocale: lang === "vi" ? "en_NZ" : "vi_VN",
      type: "website",
      images: [{ url: `${originFor(lang)}/${lang}/opengraph-image`, width: 1200, height: 630, alt: lang === "vi" ? "Luvallplay. Love all, play." : "Luvallplay. Love all, play." }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export function jsonLd(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") };
}
