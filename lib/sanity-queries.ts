import { sanityClient, sanityConfigured, pickLocale } from "@/lib/sanity";
import type { Lang } from "@/lib/i18n";

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

export async function fetchSiteSettings(): Promise<CmsSiteSettings | null> {
  if (!sanityConfigured) return null;
  try {
    return await sanityClient.fetch(
      `*[_type == "siteSettings"][0]{
        googleReviewUrl,
        stats
      }`,
    );
  } catch {
    return null;
  }
}

export async function fetchReviews(lang: Lang): Promise<CmsReview[] | null> {
  if (!sanityConfigured) return null;
  try {
    const rows = await sanityClient.fetch<
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
    return rows.map((r) => ({
      quote: pickLocale(r.quote, lang),
      name: r.authorName,
      initial: r.authorInitial,
      meta: `${r.membershipType} · Google Review`,
    }));
  } catch {
    return null;
  }
}

export async function fetchPricingPlans(lang: Lang) {
  if (!sanityConfigured) return null;
  try {
    return await sanityClient.fetch(
      `*[_type == "pricingPlan"] | order(order asc) {
        planId, name, description, priceNzd, periodLabel, featured, stripePriceId, features
      }`,
    );
  } catch {
    return null;
  }
}
