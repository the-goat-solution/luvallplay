// A club's website, rendered (build plan §7.3): the club's content
// (content.ts) and its settings (SiteData) through one of the templates, in
// the club's theme. Pure: strings in, HTML and CSS out, so pages can be
// generated ahead of time and revalidated per club (§6.4), and every
// template can be tested with every scheme without a browser.
//
// Everything that reaches the page is escaped here; addresses were already
// held to https or a path on the club's own site by normalizeSiteContent().
// There is no script on the page.
import type { ResolvedClubTheme } from "@luvallplay/ui";
import { pick, safeUrl, type LocaleText, type SectionId, type SiteContent, type SiteImage, type SiteLang, type TemplateId } from "./content.ts";
import { BASE_CSS, TEMPLATE_CSS, themeStyles } from "./styles.ts";
import { WORDS } from "./words.ts";

/** How the club charges (build plan §6.2.1). */
export type Charging = "free" | "offline" | "online";

/** What the templates read from the club's settings and live data. Never edited in the Website editor. */
export type SiteData = {
  club: { name: string; logoUrl: string | null };
  lang: SiteLang;
  theme: ResolvedClubTheme;
  charging: Charging;
  /** The club's prices, already worded and formatted for `lang` and the club's currency. */
  prices: { name: string; price: string; period: string; description: string; features: string[]; featured: boolean }[];
  /** The next play days, already worded for `lang`. `spotsLeft` null: not shown. */
  playDays: { label: string; time: string; spotsLeft: number | null }[];
  /** Modules that are off take their part of the site with them (§6.2.3). */
  modules: { memberships: boolean; casualPlay: boolean; gallery: boolean };
  links: {
    /** Join as a member, in the app. */
    join: string;
    /** Book or sign up for one play day. */
    book: string;
    app: string;
    /** This page in each language, when the club has both. */
    languages?: Partial<Record<SiteLang, string>>;
  };
};

export type RenderedSite = { title: string; description: string; css: string; body: string; lang: SiteLang; template: TemplateId; sections: SectionId[] };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text for inside an element or a quoted attribute. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const href = (url: string): string => esc(safeUrl(url) ?? "#");

function img(i: SiteImage, lang: SiteLang, eager = false): string {
  return `<img src="${href(i.url)}" alt="${esc(pick(i.alt, lang))}"${eager ? "" : ' loading="lazy"'} decoding="async">`;
}

/** Which sections have something to show for this club, in the club's order. */
export function visibleSections(content: SiteContent, data: SiteData): SectionId[] {
  const t = (x: LocaleText) => pick(x, data.lang) !== "";
  const show: Record<SectionId, boolean> = {
    about: t(content.about.title) || content.about.paragraphs.length > 0 || content.about.facts.length > 0,
    schedule: t(content.schedule.venue) || t(content.schedule.time) || data.playDays.length > 0,
    // Free play always says so; otherwise only with prices to show.
    prices: data.charging === "free" || data.prices.length > 0,
    gallery: data.modules.gallery && content.gallery.length > 0,
    reviews: content.reviews.length > 0,
    faq: content.faq.length > 0,
    contact: Boolean(content.contact.email || content.contact.phone || content.contact.links.length > 0),
  };
  return content.sections.filter((s) => show[s]);
}

/** The calls to action: free-play clubs sign up for a play day; others join in the app or book a casual session. */
function actions(data: SiteData, onDark: boolean): string {
  const w = WORDS[data.lang];
  const main = onDark ? "btn-accent" : "btn-primary";
  const out: string[] = [];
  if (data.charging === "free") out.push(`<a class="btn ${main}" href="${href(data.links.book)}">${esc(w.signUp)}</a>`);
  else {
    if (data.modules.memberships) out.push(`<a class="btn ${main}" href="${href(data.links.join)}">${esc(w.join)}</a>`);
    if (data.modules.casualPlay) out.push(`<a class="btn ${out.length ? "btn-quiet" : main}" href="${href(data.links.book)}">${esc(w.book)}</a>`);
  }
  if (out.length === 0) out.push(`<a class="btn ${main}" href="${href(data.links.app)}">${esc(w.getApp)}</a>`);
  return `<div class="actions">${out.join("")}</div>`;
}

function section(id: SectionId, content: SiteContent, data: SiteData): string {
  const w = WORDS[data.lang];
  const lang = data.lang;
  const p = (x: LocaleText) => esc(pick(x, lang));
  const open = (title: string) => `<section id="${id}" aria-labelledby="${id}-h"><div class="wrap"><h2 id="${id}-h">${esc(title)}</h2>`;
  const close = `</div></section>`;
  switch (id) {
    case "about": {
      const a = content.about;
      const facts = a.facts.length ? `<dl class="facts">${a.facts.map((f) => `<div><dt>${esc(f.value)}</dt><dd>${p(f.label)}</dd></div>`).join("")}</dl>` : "";
      const photos = a.images.length ? `<div class="photos">${a.images.map((i) => img(i, lang)).join("")}</div>` : "";
      return `${open(pick(a.title, lang) || w.about)}<div class="split"><div class="prose">${a.paragraphs.map((x) => `<p>${p(x)}</p>`).join("")}${facts}</div>${photos}</div>${close}`;
    }
    case "schedule": {
      const s = content.schedule;
      const where = [pick(s.venue, lang), pick(s.address, lang)].filter(Boolean);
      const map = s.mapUrl ? `<p><a href="${href(s.mapUrl)}" rel="noopener">${esc(w.map)}</a></p>` : "";
      const days = data.playDays.length
        ? `<div><h3>${esc(w.nextDays)}</h3><ul class="days">${data.playDays
            .map((d) => `<li><span><strong>${esc(d.label)}</strong> <span class="muted">${esc(d.time)}</span></span>${d.spotsLeft === null ? "" : `<span class="pill">${esc(d.spotsLeft > 0 ? w.spotsLeft(d.spotsLeft) : w.full)}</span>`}</li>`)
            .join("")}</ul></div>`
        : "";
      return `${open(w.schedule)}<div class="split"><div class="prose">${pick(s.time, lang) ? `<p><strong>${p(s.time)}</strong></p>` : ""}${where.map((x) => `<p>${esc(x)}</p>`).join("")}${map}</div>${days}</div>${close}`;
    }
    case "prices": {
      if (data.charging === "free") return `${open(w.prices)}<div class="free"><h3>${esc(w.freeTitle)}</h3><p>${esc(w.freeBody)}</p>${actions(data, false)}</div>${close}`;
      const cards = data.prices
        .map(
          (x) =>
            `<li class="card${x.featured ? " featured" : ""}">${x.featured ? `<span class="pill">${esc(w.popular)}</span>` : ""}<h3>${esc(x.name)}</h3><p class="price">${esc(x.price)} <small>${esc(x.period)}</small></p>${x.description ? `<p class="muted">${esc(x.description)}</p>` : ""}${x.features.length ? `<ul>${x.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}</li>`,
        )
        .join("");
      return `${open(w.prices)}<ul class="cards">${cards}</ul>${data.charging === "offline" ? `<p class="muted" style="margin-top:1rem">${esc(w.offlineNote)}</p>` : ""}${actions(data, false)}${close}`;
    }
    case "gallery":
      return `${open(w.gallery)}<div class="grid">${content.gallery.map((i) => img(i, lang)).join("")}</div>${close}`;
    case "reviews":
      return `${open(w.reviews)}<ul class="cards">${content.reviews.map((r) => `<li class="card"><blockquote><p class="quote">${p(r.quote)}</p></blockquote><p class="who">${esc(r.author)}${r.role ? ` <span class="muted">· ${esc(r.role)}</span>` : ""}</p></li>`).join("")}</ul>${close}`;
    case "faq":
      return `${open(w.faq)}${content.faq.map((f) => `<details><summary>${p(f.question)}</summary><p>${p(f.answer)}</p></details>`).join("")}${close}`;
    case "contact": {
      const c = content.contact;
      const items = [
        c.email ? `<li><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>` : "",
        c.phone ? `<li><a href="tel:${esc(c.phone.replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a></li>` : "",
        ...c.links.map((l) => `<li><a href="${href(l.url)}" rel="noopener">${esc(l.label)}</a></li>`),
      ].join("");
      return `${open(w.contact)}<ul class="contact">${items}</ul>${close}`;
    }
  }
}

/** The page for one club in one language. `template` overrides the club's choice (the editor's preview). */
export function renderSite(contentIn: SiteContent, data: SiteData, options: { template?: TemplateId } = {}): RenderedSite {
  const content = contentIn;
  const template = options.template ?? content.template;
  const w = WORDS[data.lang];
  const lang = data.lang;
  const sections = visibleSections(content, data);
  const tagline = pick(content.hero.tagline, lang);
  const logo = data.club.logoUrl && safeUrl(data.club.logoUrl) ? `<img src="${href(data.club.logoUrl)}" alt="">` : "";
  const langs = data.links.languages;
  const switcher =
    langs && langs.en && langs.vi
      ? `<nav aria-label="${esc(w.language)}"><ul class="langs">${(["en", "vi"] as const).map((l) => `<li><a href="${href(langs[l]!)}" lang="${l}" hreflang="${l}"${l === lang ? ' aria-current="true"' : ""}>${l.toUpperCase()}</a></li>`).join("")}</ul></nav>`
      : "";
  const heroImg = content.hero.image ? `<img class="hero-img" src="${href(content.hero.image)}" alt="" decoding="async" fetchpriority="high">` : "";
  // Bold and Classic set the hero on the club's colour; Minimal on the page.
  const heroOnDark = template !== "minimal";

  const body = [
    `<a class="skip" href="#main">${esc(w.skip)}</a>`,
    `<header class="top"><a class="brand" href="#main">${logo}<span>${esc(data.club.name)}</span></a>${switcher}</header>`,
    `<main id="main">`,
    `<div class="hero">${heroImg}<div class="hero-inner"><h1>${esc(data.club.name)}</h1>${tagline ? `<p class="tagline">${esc(tagline)}</p>` : ""}${actions(data, heroOnDark)}</div></div>`,
    ...sections.map((s) => section(s, content, data)),
    `</main>`,
    `<footer><div class="wrap"><span>${esc(data.club.name)}</span><a class="mark" href="https://luvallplay.com" rel="noopener">${esc(w.onLuvallplay)}</a></div></footer>`,
  ].join("");

  return {
    title: data.club.name,
    description: tagline || pick(content.about.paragraphs[0] ?? { en: "" }, lang).slice(0, 160),
    css: `${themeStyles(data.theme)}${BASE_CSS}${TEMPLATE_CSS[template]}`,
    body,
    lang,
    template,
    sections,
  };
}

/** The whole document, for a route that answers with HTML. */
export function renderDocument(site: RenderedSite, options: { noindex?: boolean } = {}): string {
  return `<!doctype html><html lang="${site.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(site.title)}</title>${site.description ? `<meta name="description" content="${esc(site.description)}">` : ""}${options.noindex ? '<meta name="robots" content="noindex">' : ""}<style>${site.css}</style></head><body data-template="${site.template}">${site.body}</body></html>`;
}
