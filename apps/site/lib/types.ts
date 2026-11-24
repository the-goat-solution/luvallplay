// Shapes of the site's content. The same documents live in Sanity
// (apps/site-studio/schema.ts) and in the repo's seed (content/), which the
// site falls back to when Sanity isn't configured or a document is missing.

export const LANGS = ["en", "vi"] as const;
export type Lang = (typeof LANGS)[number];
export function isLang(v: string | undefined): v is Lang {
  return v === "en" || v === "vi";
}

/** A string in both languages. */
export type L = { en: string; vi: string };

/** A Sanity image slot. Empty until a real, consented photo is uploaded. */
export type ImageSlot = { url?: string; alt?: L } | undefined;

export type Cta = { label: L };

// --- Portable Text (the small subset the site writes and renders) ----------
export type PtSpan = { _type: "span"; _key: string; text: string; marks: string[] };
export type PtLink = { _type: "link"; _key: string; href: string };
export type PtBlock = {
  _type: "block";
  _key: string;
  style: "normal" | "h2" | "h3";
  listItem?: "bullet" | "number";
  level?: number;
  children: PtSpan[];
  markDefs: PtLink[];
};
export type LBlocks = { en: PtBlock[]; vi: PtBlock[] };

// --- Documents ---------------------------------------------------------------
export type SiteSettings = {
  _id: "siteSettings";
  _type: "siteSettings";
  /** `coming-soon`: CTAs lead to the waitlist. `live`: to the wizard and stores. */
  launchMode: "coming-soon" | "live";
  /** Off until go-live: the site sends noindex and robots.txt disallows all. */
  searchIndexing: boolean;
  wizardUrl?: string;
  appStoreUrl?: string;
  playStoreUrl?: string;
  /** A scheduling link for "Book a walkthrough". Empty: the request form. */
  bookingUrl?: string;
  contactEmail?: string;
  companyName: string;
  companyAddress?: string;
};

export type Feature = { key: string; title: L; body: L; status: "live" | "soon" };
export type TitledText = { _key: string; title: L; body: L };

export type HomePage = {
  _id: "homePage";
  _type: "homePage";
  seoTitle: L;
  seoDescription: L;
  ticker: { label: L; items: { _key: string; strong: L; rest: L }[]; linkLabel: L };
  hero: {
    badge: L;
    title: L;
    titleAccent: L;
    lead: L;
    primaryCta: L;
    secondaryCta: L;
    /** The quieter line under the buttons, for players. */
    playerLine: L;
    playerCta: L;
    photos: { _key: string; image?: ImageSlot; fallbackAlt: L }[];
    scoreLabel: L;
    scoreCaption: L;
    nextLabel: L;
    nextTitle: L;
    nextMeta: L;
    paidChip: L;
  };
  sports: { intro: L };
  features: { title: L; lead: L; items: Feature[]; sessionRows: { _key: string; name: L; meta: L; action: L }[]; feeModes: L[]; schemesCaption: L };
  vision: { eyebrow: L; title: L; lead: L; primaryCta: L; secondaryCta: L; note: L; figureCaption: L; benefits: TitledText[] };
  how: { eyebrow: L; title: L; lead: L; steps: TitledText[]; storeNote: L };
  rankings: { eyebrow: L; title: L; lead: L; note: L; cta: L };
  finder: { title: L; lead: L };
  story: { title: L; body: L; caption: L };
  clubs: { eyebrow: L; title: L; lead: L; primaryCta: L; secondaryCta: L; steps: TitledText[] };
  pricing: {
    players: { eyebrow: L; price: L; body: L; cta: L };
    clubs: { eyebrow: L; badge: L; price: L; body: L; note: L; cta: L };
  };
};

export type PageSection = { _key: string; heading: L; body: L; bullets?: L[] };
export type Page = {
  _id: string;
  _type: "page";
  key: string;
  title: L;
  lead: L;
  seoTitle: L;
  seoDescription: L;
  sections: PageSection[];
};

export type Sport = { _id: string; _type: "sport"; key: string; name: L; status: "live" | "soon"; order: number };

export type Club = {
  _id: string;
  _type: "club";
  slug: string;
  name: string;
  sportKey: string;
  city: string;
  suburb?: string;
  country: string;
  schedule: L;
  audience: L;
  description: L;
  /** The club's own page, where a casual session is booked. */
  url: string;
  logo?: ImageSlot;
};

export type FaqItem = { _id: string; _type: "faqItem"; topic: "clubs" | "players" | "general"; order: number; q: L; a: L };

export type HelpArticle = {
  _id: string;
  _type: "helpArticle";
  slug: string;
  title: L;
  summary: L;
  audience: "organisers" | "players" | "everyone";
  order: number;
  updated: string;
  body: LBlocks;
};

export type LegalPage = {
  _id: string;
  _type: "legalPage";
  slug: "privacy" | "terms";
  title: L;
  summary: L;
  updated: string;
  body: LBlocks;
};

/** Empty until a founding club gives a quote, with consent. */
export type Testimonial = {
  _id: string;
  _type: "testimonial";
  quote: L;
  name: string;
  role: L;
  club: string;
  consent: boolean;
};

export type Doc = SiteSettings | HomePage | Page | Sport | Club | FaqItem | HelpArticle | LegalPage | Testimonial;

export type Content = {
  settings: SiteSettings;
  home: HomePage;
  pages: Record<string, Page>;
  sports: Sport[];
  clubs: Club[];
  faq: FaqItem[];
  help: HelpArticle[];
  legal: Record<string, LegalPage>;
  testimonials: Testimonial[];
};
