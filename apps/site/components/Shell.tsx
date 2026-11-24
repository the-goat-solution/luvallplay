// The frame around every page: skip link, header with the ticker, footer.
import type { ReactNode } from "react";
import { Icon } from "./icons";
import { ThemeSwitch } from "./ThemeSwitch";
import { t } from "@/lib/messages";
import { ctaTarget, href, notYetLive } from "@/lib/site";
import type { Content, Lang } from "@/lib/types";

type Props = { lang: Lang; path: string; content: Content; children: ReactNode; mainId?: string };

export function Logo({ dark = false, height = 30 }: { dark?: boolean; height?: number }) {
  // The files are the brand's own (public/brand). On dark grounds: lime petals, white wordmark.
  if (dark) return <img src="/brand/luvallplay-lockup-dark.svg" alt="Luvallplay" width={Math.round(height * 5.205)} height={height} style={{ height, width: "auto" }} />;
  return (
    <>
      <img className="hdr-logo logo-light" src="/brand/luvallplay-lockup.svg" alt="Luvallplay" width={156} height={30} />
      <img className="hdr-logo logo-dark" src="/brand/luvallplay-lockup-dark.svg" alt="Luvallplay" width={156} height={30} />
    </>
  );
}

export function Shell({ lang, path, content, children, mainId = "main" }: Props) {
  const m = t(lang);
  const other: Lang = lang === "en" ? "vi" : "en";
  const { ticker } = content.home;
  const startClub = ctaTarget("startClub", lang, content.settings);
  const links: [string, string, boolean?][] = [
    ["/for-clubs", m.nav.forClubs],
    ["/#features", m.nav.inside],
    ["/pricing", m.nav.pricing],
    ["/vision", m.nav.vision, true],
    ["/find-a-club", m.nav.findClub],
    ["/help", m.nav.help],
  ];
  const nav = (id: string) => (
    <nav aria-label={id === "d" ? m.nav.main : m.nav.menu} className="nav">
      {links.map(([p, label, isNew]) => (
        <a key={p} href={href(lang, p)} aria-current={path === p ? "page" : undefined}>
          {label}
          {isNew ? <span className="chip lime">{m.badge.new}</span> : null}
        </a>
      ))}
      <a className="nav-lang" href={href(other, path)} hrefLang={other} lang={other}>{m.switchTo}</a>
    </nav>
  );
  const items = (hidden: boolean) =>
    ticker.items.map((it) => (
      <li key={it._key + (hidden ? "h" : "")} aria-hidden={hidden || undefined}>
        <b>{it.strong[lang]}</b>
        <span>· {it.rest[lang]}</span>
      </li>
    ));
  return (
    <>
      <header className="hdr-wrap">
        <a className="skip" href={`#${mainId}`}>{m.skip}</a>
        <div className="hdr glass">
          <div className="hdr-row">
            <a href={href(lang, "/")} aria-label={m.home}><Logo /></a>
            <div className="nav-desktop">{nav("d")}</div>
            <div className="hdr-cta">
              <a className="btn btn-primary btn-getapp" href={startClub.href}>{m.nav.startClub}</a>
              <details className="menu">
                <summary><Icon name="menu" size={20} />{m.nav.menu}</summary>
                <div className="menu-panel">
                  {nav("m")}
                  <a className="btn btn-primary" style={{ width: "100%", marginTop: 8 }} href={startClub.href}>{m.nav.startClub}</a>
                </div>
              </details>
            </div>
          </div>
          <div className="ticker">
            <span className="ticker-label label lime"><span className="dot" aria-hidden="true" />{ticker.label[lang]}</span>
            <div className="marquee">
              <ul className="track">{items(false)}{items(true)}</ul>
            </div>
            <a className="ticker-link" href={href(lang, "/find-a-club")}>{ticker.linkLabel[lang]}<Icon name="arrow" size={14} strokeWidth={2.2} /></a>
          </div>
        </div>
      </header>
      <main id={mainId} lang={lang}>{children}</main>
      <footer className="ftr navy on-dark">
        <div className="wrap ftr-in">
          <p className="ftr-tag">Love all, <span>play.</span></p>
          <div className="ftr-row">
            <a href={href(lang, "/")} aria-label={m.home}><Logo dark height={32} /></a>
            <nav aria-label={m.nav.footer}>
              {([["/about", m.nav.about], ["/availability", m.availability.nav], ["/help", m.nav.help], ["/contact", m.nav.contact], ["/privacy", m.nav.privacy], ["/terms", m.nav.terms]] as const).map(([p, label]) => (
                <a key={p} href={href(lang, p)}>{label}</a>
              ))}
              <a href={href(other, path)} hrefLang={other} lang={other}>{m.switchTo}</a>
            </nav>
          </div>
          <div className="ftr-meta">
            <span>{m.footer.productOf} {content.settings.companyName}. {m.footer.rights}</span>
            {notYetLive(content, "storeApps") ? <span>{m.footer.stores}</span> : null}
            <ThemeSwitch label={m.theme.label} names={[m.theme.auto, m.theme.light, m.theme.dark]} />
          </div>
        </div>
      </footer>
    </>
  );
}
