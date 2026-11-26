// A club's website content (build plan §7.3, decision D): what the built-in
// Website editor in Admin edits, one document per club. It replaces the one
// Sanity dataset per deployment, which had no club in its queries.
//
// Pure: types, and normalizeSiteContent(), which turns anything stored (or
// typed into the editor) into content that is safe to render: every text is
// a plain string within its limit, every address is https or a path on the
// club's own site, every list is capped. It never throws, so a damaged
// document can't take a club's website down.
//
// What is NOT content, and so never stored here: the club's name, logo and
// theme, its prices, its play days and its modules. Those are the club's
// settings, and the templates read them at render time (SiteData, render.ts).

/** Text in the club's languages. English is the fallback for any language left empty. */
export type LocaleText = { en: string; vi?: string };
export type SiteLang = "en" | "vi";

export const TEMPLATES = ["classic", "bold", "minimal"] as const;
export type TemplateId = (typeof TEMPLATES)[number];

/** The sections a club can show, hide and reorder. */
export const SECTIONS = ["about", "schedule", "prices", "gallery", "reviews", "faq", "contact"] as const;
export type SectionId = (typeof SECTIONS)[number];

export type SiteImage = { url: string; alt: LocaleText };

export type SiteContent = {
  /** The model's version, for migrations of stored documents. */
  version: 1;
  template: TemplateId;
  /** Sections in the order shown; one left out is hidden. The hero is always first. */
  sections: SectionId[];
  hero: { tagline: LocaleText; image: string | null };
  about: { title: LocaleText; paragraphs: LocaleText[]; images: SiteImage[]; facts: { value: string; label: LocaleText }[] };
  /** Where and when, in the club's own words; the play days themselves come from the club's calendar. */
  schedule: { venue: LocaleText; address: LocaleText; time: LocaleText; mapUrl: string | null };
  gallery: SiteImage[];
  reviews: { quote: LocaleText; author: string; role: string }[];
  faq: { question: LocaleText; answer: LocaleText }[];
  contact: { email: string | null; phone: string | null; links: { label: string; url: string }[] };
};

export const LIMITS = { line: 160, paragraph: 1200, paragraphs: 6, images: 2, facts: 4, gallery: 24, reviews: 12, faq: 20, links: 6 } as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/** A plain string: control characters out, runs of spaces collapsed (line breaks kept when `multiline`), cut at `max`. */
export function cleanText(v: unknown, max: number, multiline = false): string {
  if (typeof v !== "string") return "";
  const noControl = [...v].filter((ch) => ch === "\n" || ch === "\t" || ch.charCodeAt(0) >= 32).join("");
  const s = multiline
    ? noControl.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
    : noControl.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

function locale(v: unknown, max: number, multiline = false): LocaleText {
  // A bare string is English.
  if (typeof v === "string") return { en: cleanText(v, max, multiline) };
  if (!isObj(v)) return { en: "" };
  const vi = cleanText(v.vi, max, multiline);
  return { en: cleanText(v.en, max, multiline), ...(vi ? { vi } : {}) };
}

const has = (t: LocaleText) => Boolean(t.en || t.vi);

/** An address safe to put in href or src: https, or a path on the club's own site. Anything else is dropped. */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length === 0 || s.length > 600 || /[\s"'<>`\\]/.test(s)) return null;
  if (/^https:\/\/[^/]+\.[^/]+/i.test(s)) return s;
  if (/^\/(?!\/)/.test(s)) return s;
  return null;
}

function image(v: unknown): SiteImage | null {
  if (typeof v === "string") v = { url: v };
  if (!isObj(v)) return null;
  const url = safeUrl(v.url);
  return url ? { url, alt: locale(v.alt, LIMITS.line) } : null;
}

const email = (v: unknown): string | null => {
  const s = cleanText(v, 200);
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s) ? s : null;
};
const phone = (v: unknown): string | null => {
  const s = cleanText(v, 30);
  return /^\+?[\d ()-]{6,30}$/.test(s) ? s : null;
};

export function emptySiteContent(template: TemplateId = "classic"): SiteContent {
  return {
    version: 1,
    template,
    sections: [...SECTIONS],
    hero: { tagline: { en: "" }, image: null },
    about: { title: { en: "" }, paragraphs: [], images: [], facts: [] },
    schedule: { venue: { en: "" }, address: { en: "" }, time: { en: "" }, mapUrl: null },
    gallery: [],
    reviews: [],
    faq: [],
    contact: { email: null, phone: null, links: [] },
  };
}

/** Anything stored or submitted → content that is safe to render. Never throws. */
export function normalizeSiteContent(input: unknown): SiteContent {
  const v = isObj(input) ? input : {};
  const out = emptySiteContent();
  if (TEMPLATES.includes(v.template as TemplateId)) out.template = v.template as TemplateId;
  if (Array.isArray(v.sections)) {
    out.sections = [...new Set(v.sections.filter((s): s is SectionId => SECTIONS.includes(s as SectionId)))];
  }

  const hero = isObj(v.hero) ? v.hero : {};
  out.hero = { tagline: locale(hero.tagline, LIMITS.line * 2), image: safeUrl(hero.image) };

  const about = isObj(v.about) ? v.about : {};
  out.about = {
    title: locale(about.title, LIMITS.line),
    paragraphs: list(about.paragraphs, LIMITS.paragraphs).map((p) => locale(p, LIMITS.paragraph, true)).filter(has),
    images: list(about.images, LIMITS.images).map(image).filter((i): i is SiteImage => i !== null),
    facts: list(about.facts, LIMITS.facts)
      .map((f) => (isObj(f) ? { value: cleanText(f.value, 20), label: locale(f.label, 60) } : null))
      .filter((f): f is { value: string; label: LocaleText } => f !== null && f.value !== "" && has(f.label)),
  };

  const schedule = isObj(v.schedule) ? v.schedule : {};
  out.schedule = { venue: locale(schedule.venue, LIMITS.line), address: locale(schedule.address, LIMITS.line * 2), time: locale(schedule.time, LIMITS.line), mapUrl: safeUrl(schedule.mapUrl) };

  out.gallery = list(v.gallery, LIMITS.gallery).map(image).filter((i): i is SiteImage => i !== null);

  out.reviews = list(v.reviews, LIMITS.reviews)
    .map((r) => (isObj(r) ? { quote: locale(r.quote, 600, true), author: cleanText(r.author, 80), role: cleanText(r.role, 80) } : null))
    .filter((r): r is SiteContent["reviews"][number] => r !== null && has(r.quote) && r.author !== "");

  out.faq = list(v.faq, LIMITS.faq)
    .map((f) => (isObj(f) ? { question: locale(f.question, LIMITS.line * 2), answer: locale(f.answer, LIMITS.paragraph, true) } : null))
    .filter((f): f is SiteContent["faq"][number] => f !== null && has(f.question) && has(f.answer));

  const contact = isObj(v.contact) ? v.contact : {};
  out.contact = {
    email: email(contact.email),
    phone: phone(contact.phone),
    links: list(contact.links, LIMITS.links)
      .map((l) => (isObj(l) ? { label: cleanText(l.label, 40), url: safeUrl(l.url) } : null))
      .filter((l): l is { label: string; url: string } => l !== null && l.label !== "" && l.url !== null && l.url.startsWith("https://")),
  };
  return out;
}

/** The text for a language: that language's, else English, else whichever exists. */
export function pick(t: LocaleText, lang: SiteLang): string {
  return (lang === "vi" ? t.vi : t.en) || t.en || t.vi || "";
}
