// The inner pages. Each takes the language and the content and returns the
// page body (the Shell is added by app/[lang]/…/page.tsx through `render`).
import type { ReactNode } from "react";
import { Blocks } from "./Blocks";
import { Finder } from "./Finder";
import { AdminFigure, FeatureArt } from "./ClubArt";
import { finderProps, Pricing, Vision } from "./Home";
import { Shell } from "./Shell";
import { SiteForm } from "./SiteForm";
import type { Kind } from "@/lib/forms-shared";
import { jsonLd } from "@/lib/meta";
import { t } from "@/lib/messages";
import { availabilityOf, ctaTarget, href, originFor, safetyContact, type LegalSlug } from "@/lib/site";
import type { AvailabilityItem, Content, Lang, Page } from "@/lib/types";

type P = { lang: Lang; content: Content };

export function render(lang: Lang, path: string, content: Content, children: ReactNode) {
  return <Shell lang={lang} path={path} content={content}>{children}</Shell>;
}

// The For clubs page opens with its message on one side and the admin
// drawing on the other, with the two buttons a club needs.
function ClubsHead({ page, lang, content }: P & { page: Page }) {
  const m = t(lang);
  const c = content.home.clubs;
  const walk = ctaTarget("walkthrough", lang, content.settings);
  return (
    <div className="fc-hero">
      <div className="page-head">
        <span className="label accent">{c.eyebrow[lang]}</span>
        <h1 className="h-page">{page.title[lang]}</h1>
        <p className="lead">{page.lead[lang]}</p>
        <div className="cta-row">
          <a className="btn btn-primary btn-lg" href={ctaTarget("startClub", lang, content.settings).href}>{c.primaryCta[lang]}</a>
          <a className="btn btn-secondary btn-lg" href={walk.href} rel={walk.external ? "noopener" : undefined}>{c.secondaryCta[lang]}</a>
        </div>
      </div>
      <AdminFigure caption={m.admin.caption} />
    </div>
  );
}

function Head({ page, lang, as = "h1" }: { page: Page; lang: Lang; as?: "h1" | "h2" }) {
  const H = as;
  return (
    <div className="page-head">
      <H className="h-page">{page.title[lang]}</H>
      <p className="lead">{page.lead[lang]}</p>
    </div>
  );
}

function Sections({ page, lang }: { page: Page; lang: Lang }) {
  if (!page.sections?.length) return null;
  return (
    <div className={page.sections.some((s) => s.art) ? "page-grid art-grid" : "page-grid"}>
      {page.sections.map((s) => (
        <section key={s._key} className="card psec">
          {s.art ? <FeatureArt name={s.art} className="fart-card" /> : null}
          <h2>{s.heading[lang]}</h2>
          <p>{s.body[lang]}</p>
          {s.bullets?.length ? <ul className="ticks">{s.bullets.map((b, i) => <li key={i}>{b[lang]}</li>)}</ul> : null}
        </section>
      ))}
    </div>
  );
}

export function ClubBand({ lang, content }: P) {
  const c = content.home.clubs;
  const walk = ctaTarget("walkthrough", lang, content.settings);
  return (
    <div className="band green court-lines on-green">
      <h2>{c.title[lang]}</h2>
      <div className="cta-row">
        <a className="btn btn-secondary btn-lg" style={{ border: 0 }} href={ctaTarget("startClub", lang, content.settings).href}>{c.primaryCta[lang]}</a>
        <a className="btn btn-ghost btn-lg" href={walk.href} rel={walk.external ? "noopener" : undefined}>{c.secondaryCta[lang]}</a>
      </div>
    </div>
  );
}

export function Faq({ lang, content, topics }: P & { topics?: string[] }) {
  const items = content.faq.filter((f) => !topics || topics.includes(f.topic));
  return (
    <div className="faq">
      {items.map((f) => (
        <details key={f._id} className="card">
          <summary>{f.q[lang]}</summary>
          <p>{f.a[lang]}</p>
        </details>
      ))}
    </div>
  );
}

function StatusChip({ item, lang }: { item: AvailabilityItem; lang: Lang }) {
  const m = t(lang).badge;
  if (item.status === "live") return <span className="chip lime">{m.live}</span>;
  if (item.status === "limited") return <span className="chip chip-outline">{m.limited}</span>;
  return <span className="chip chip-soft">{m.soon}</span>;
}

/** The current status of the features a page is about, straight from the availability list. */
export function StatusNote({ lang, content, keys }: P & { keys: string[] }) {
  const items = keys.map((k) => availabilityOf(content, k)).filter((i): i is AvailabilityItem => !!i);
  if (!items.length) return null;
  const m = t(lang).availability;
  return (
    <aside className="card status-note" aria-label={m.today}>
      <p className="label muted">{m.today}</p>
      <ul>
        {items.map((i) => (
          <li key={i.key}><StatusChip item={i} lang={lang} /><span><b>{i.name[lang]}.</b> {i.note[lang]}</span></li>
        ))}
      </ul>
      <a href={href(lang, "/availability")}>{m.all}</a>
    </aside>
  );
}

function AvailabilityList({ lang, content }: P) {
  const m = t(lang).availability;
  const groups: [AvailabilityItem["group"], string][] = [["players", m.players], ["clubs", m.clubs], ["platform", m.platform]];
  return (
    <>
      <p className="meta-line">{m.updated}: <time dateTime={content.availability.updated}>{fmtDate(content.availability.updated, lang)}</time></p>
      {groups.map(([g, label]) => (
        <section key={g} className="help-group">
          <h2>{label}</h2>
          <ul className="avail">
            {content.availability.items.filter((i) => i.group === g).map((i) => (
              <li key={i.key} className="card">
                <StatusChip item={i} lang={lang} />
                <div><h3 className="h-small">{i.name[lang]}</h3><p>{i.note[lang]}</p></div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function InfoPage({ lang, content, pageKey }: P & { pageKey: string }) {
  const page = content.pages[pageKey];
  const m = t(lang);
  if (pageKey === "vision") {
    return (
      <>
        <Vision lang={lang} content={content} page />
        <div className="wrap page" style={{ paddingTop: 0 }}>
          <p className="lead">{page.lead[lang]}</p>
          <StatusNote lang={lang} content={content} keys={["vision"]} />
          <Sections page={page} lang={lang} />
        </div>
      </>
    );
  }
  return (
    <div className="wrap page">
      {pageKey === "for-clubs" ? <ClubsHead page={page} lang={lang} content={content} /> : <Head page={page} lang={lang} />}
      {pageKey === "availability" ? <AvailabilityList lang={lang} content={content} /> : null}
      {pageKey === "find-a-club" ? <Finder {...finderProps(lang, content)} heading="h2" /> : null}
      {pageKey === "pricing" ? <div style={{ margin: "0 -24px -64px" }}><Pricing lang={lang} content={content} heading="h2" /></div> : null}
      <Sections page={page} lang={lang} />
      {pageKey === "pricing" || pageKey === "for-clubs" ? (
        <section className="help-group">
          <h2>{m.help.faq}</h2>
          <Faq lang={lang} content={content} topics={pageKey === "pricing" ? undefined : ["clubs", "general"]} />
        </section>
      ) : null}
      {pageKey === "find-a-club" ? (
        <div><a className="btn btn-secondary" href={href(lang, "/invite-a-club")}>{m.finder.invite}</a></div>
      ) : (
        <ClubBand lang={lang} content={content} />
      )}
    </div>
  );
}

const FORM_ASIDE: Record<Kind, string[]> = {
  waitlist: ["start-your-club-waitlist", "choose-how-your-club-charges", "what-is-luvallplay"],
  walkthrough: ["what-is-luvallplay", "modules-pick-what-you-need"],
  invite: ["find-a-club-and-try-a-session"],
  app: ["signing-in-with-an-email-code", "vision-film-your-game"],
  contact: ["your-data-and-privacy"],
};

export function FormPage({ lang, content, pageKey, kind }: P & { pageKey: string; kind: Kind }) {
  const page = content.pages[pageKey];
  const m = t(lang);
  const related = FORM_ASIDE[kind].map((slug) => content.help.find((h) => h.slug === slug)).filter((h) => !!h);
  const booking = kind === "walkthrough" ? content.settings.bookingUrl : "";
  return (
    <div className="wrap page">
      <div className="form-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <Head page={page} lang={lang} />
          {booking ? <p>{m.form.schedulingNote} <a className="btn btn-secondary btn-sm" href={booking} rel="noopener">{m.form.scheduling}</a></p> : null}
          <SiteForm kind={kind} lang={lang} content={content} />
        </div>
        <aside className="aside" aria-label={m.help.more}>
          {kind === "contact" && content.settings.contactEmail ? (
            <div className="card psec"><h2>{m.form.email}</h2><p><a href={`mailto:${content.settings.contactEmail}`}>{content.settings.contactEmail}</a></p></div>
          ) : null}
          {related.map((h) => (
            <a key={h._id} className="card help-card" href={href(lang, `/help/${h.slug}`)}>
              <span className="h-small">{h.title[lang]}</span>
              <p>{h.summary[lang]}</p>
            </a>
          ))}
        </aside>
      </div>
    </div>
  );
}

export function HelpIndex({ lang, content }: P) {
  const m = t(lang);
  const page = content.pages.help;
  const groups: ["organisers" | "players" | "everyone", string][] = [["organisers", m.help.organisers], ["players", m.help.players], ["everyone", m.help.everyone]];
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: lang,
    mainEntity: content.faq.map((f) => ({ "@type": "Question", name: f.q[lang], acceptedAnswer: { "@type": "Answer", text: f.a[lang] } })),
  };
  return (
    <div className="wrap page">
      <Head page={page} lang={lang} />
      {groups.map(([aud, label]) => {
        const items = content.help.filter((h) => h.audience === aud);
        return items.length ? (
          <section key={aud} className="help-group">
            <h2>{label}</h2>
            <div className="help-grid">
              {items.map((h) => (
                <a key={h._id} className="card help-card" href={href(lang, `/help/${h.slug}`)}>
                  <h3 className="h-small">{h.title[lang]}</h3>
                  <p>{h.summary[lang]}</p>
                </a>
              ))}
            </div>
          </section>
        ) : null;
      })}
      <section className="help-group">
        <h2>{m.help.faq}</h2>
        <Faq lang={lang} content={content} />
      </section>
      <p className="lead-sm">{m.help.stillStuck} <a href={href(lang, "/contact")}>{m.help.contactUs}</a></p>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(faqLd)} />
    </div>
  );
}

function fmtDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-NZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

export function docVars(content: Content, lang: Lang): Record<string, string> {
  const s = content.settings;
  // With no address set, the notices name the contact page.
  const contactPage = `${originFor(lang).replace(/^https?:\/\//, "")}/${lang}/contact`;
  return {
    company: s.companyName,
    address: s.companyAddress || (lang === "vi" ? "(địa chỉ sẽ được bổ sung trước khi trang chính thức ra mắt)" : "(address to be added before this site goes live)"),
    contactEmail: s.contactEmail || contactPage,
    safetyEmail: safetyContact(s) || contactPage,
  };
}

export function HelpArticlePage({ lang, content, slug }: P & { slug: string }) {
  const m = t(lang);
  const a = content.help.find((h) => h.slug === slug)!;
  const more = content.help.filter((h) => h.audience === a.audience && h.slug !== slug).slice(0, 3);
  return (
    <div className="wrap page">
      <p className="crumbs"><a href={href(lang, "/help")}>← {m.help.back}</a></p>
      <article style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="page-head">
          <h1 className="h-page">{a.title[lang]}</h1>
          <p className="lead">{a.summary[lang]}</p>
          <p className="meta-line"><span className="chip chip-soft">{m.help[a.audience]}</span><span>{m.help.updated}: <time dateTime={a.updated}>{fmtDate(a.updated, lang)}</time></span></p>
        </div>
        {a.features?.length ? <StatusNote lang={lang} content={content} keys={a.features} /> : null}
        <Blocks blocks={a.body[lang]} lang={lang} vars={docVars(content, lang)} />
      </article>
      {more.length ? (
        <section className="help-group">
          <h2>{m.help.more}</h2>
          <div className="help-grid">
            {more.map((h) => (
              <a key={h._id} className="card help-card" href={href(lang, `/help/${h.slug}`)}><h3 className="h-small">{h.title[lang]}</h3><p>{h.summary[lang]}</p></a>
            ))}
          </div>
        </section>
      ) : null}
      <p className="lead-sm">{m.help.stillStuck} <a href={href(lang, "/contact")}>{m.help.contactUs}</a></p>
    </div>
  );
}

export function LegalPageView({ lang, content, slug }: P & { slug: LegalSlug }) {
  const m = t(lang);
  const doc = content.legal[slug];
  return (
    <div className="wrap page">
      <article style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="page-head">
          <h1 className="h-page">{doc.title[lang]}</h1>
          <p className="lead">{doc.summary[lang]}</p>
          <p className="meta-line">{m.legal.updated}: <time dateTime={doc.updated}>{fmtDate(doc.updated, lang)}</time></p>
        </div>
        <Blocks blocks={doc.body[lang]} lang={lang} vars={docVars(content, lang)} />
      </article>
    </div>
  );
}
