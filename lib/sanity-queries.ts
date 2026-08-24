import {
  sanityConfigured,
  pickLocale,
  urlFor,
  sanityFetch,
  type LocaleString,
  type LocaleText,
} from "@/lib/sanity";
import type { Lang } from "@/lib/i18n";
import type { SanityImageSource } from "@sanity/image-url/lib/types/types";

export type CmsReview = {
  quote: string;
  name: string;
  initial: string;
  meta: string;
};

export type CmsSiteSettings = {
  googleReviewUrl?: string;
  stats?: { sessionsPerYear?: string; activeMembers?: string; established?: string };
};

export type CmsHero = {
  tagline?: LocaleText;
  backgroundImageUrl?: string;
};

export type CmsAbout = {
  title?: LocaleString;
  body1?: LocaleText;
  body2?: LocaleText;
  imageMainUrl?: string;
  imageSecondaryUrl?: string;
};

export type CmsGalleryImage = {
  src: string;
  alt?: LocaleString;
};

export type CmsScheduleSettings = {
  venueName?: LocaleString;
  address?: LocaleString;
  timeLabel?: LocaleString;
  maxCasualSpots?: number;
};

function imageUrl(image: SanityImageSource | null | undefined): string | undefined {
  if (!image) return undefined;
  return urlFor(image).width(1920).auto("format").url();
}

async function cmsFetch<T>(query: string): Promise<T | null> {
  if (!sanityConfigured) return null;
  try {
    return await sanityFetch<T>({ query });
  } catch (err) {
    console.error("[sanity] fetch failed:", err);
    return null;
  }
}

export async function fetchSiteSettings(): Promise<CmsSiteSettings | null> {
  return cmsFetch<CmsSiteSettings>(
    `*[_type == "siteSettings"][0]{
      googleReviewUrl,
      stats
    }`,
  );
}

export async function fetchHero(): Promise<CmsHero | null> {
  const row = await cmsFetch<{
    tagline?: LocaleText;
    backgroundImage?: SanityImageSource;
  }>(`*[_type == "hero"][0]{ tagline, backgroundImage }`);
  if (!row) return null;
  return {
    tagline: row.tagline,
    backgroundImageUrl: imageUrl(row.backgroundImage),
  };
}

export async function fetchAbout(): Promise<CmsAbout | null> {
  const row = await cmsFetch<{
    title?: LocaleString;
    body1?: LocaleText;
    body2?: LocaleText;
    imageMain?: SanityImageSource;
    imageSecondary?: SanityImageSource;
  }>(
    `*[_type == "aboutSection"][0]{
      title, body1, body2, imageMain, imageSecondary
    }`,
  );
  if (!row) return null;
  return {
    title: row.title,
    body1: row.body1,
    body2: row.body2,
    imageMainUrl: imageUrl(row.imageMain),
    imageSecondaryUrl: imageUrl(row.imageSecondary),
  };
}

export async function fetchGallery(): Promise<CmsGalleryImage[] | null> {
  const rows = await cmsFetch<
    { image?: SanityImageSource; alt?: LocaleString }[]
  >(
    `*[_type == "galleryImage"] | order(order asc) {
      image, alt
    }`,
  );
  if (!rows) return null;
  const images: CmsGalleryImage[] = [];
  for (const row of rows) {
    const src = imageUrl(row.image);
    if (src) images.push({ src, alt: row.alt });
  }
  return images.length > 0 ? images : null;
}

export async function fetchScheduleSettings(): Promise<CmsScheduleSettings | null> {
  return cmsFetch<CmsScheduleSettings>(
    `*[_type == "scheduleSettings"][0]{
      venueName, address, timeLabel, maxCasualSpots
    }`,
  );
}

export async function fetchReviews(lang: Lang): Promise<CmsReview[] | null> {
  const rows = await cmsFetch<
    {
      quote: { en?: string; vi?: string };
      authorName: string;
      authorInitial: string;
      membershipType: string;
    }[]
  >(
    `*[_type == "review"] | order(order asc) {
      quote, authorName, authorInitial, membershipType
    }`,
  );
  if (!rows) return null;
  return rows.map((r) => ({
    quote: pickLocale(r.quote, lang),
    name: r.authorName,
    initial: r.authorInitial,
    meta: `${r.membershipType} · Google Review`,
  }));
}

export async function fetchPricingPlans(): Promise<
  import("@/lib/pricing-plans").CmsPricingPlan[] | null
> {
  const rows = await cmsFetch<
    {
      planId?: string;
      name?: LocaleString;
      description?: LocaleText;
      priceNzd?: number;
      periodLabel?: LocaleString;
      featured?: boolean;
      features?: LocaleString[];
      stripePriceId?: string;
    }[]
  >(
    `*[_type == "pricingPlan"] | order(order asc) {
      planId, name, description, priceNzd, periodLabel, featured, features, stripePriceId
    }`,
  );
  if (!rows?.length) return null;
  const valid = new Set(["casual", "monthly", "quarterly"]);
  return rows
    .filter((r): r is typeof r & { planId: "casual" | "monthly" | "quarterly" } =>
      Boolean(r.planId && valid.has(r.planId)),
    )
    .map((r) => ({
      planId: r.planId,
      name: r.name,
      description: r.description,
      priceNzd: r.priceNzd,
      periodLabel: r.periodLabel,
      featured: r.featured,
      features: r.features,
      stripePriceId: r.stripePriceId,
    }));
}
