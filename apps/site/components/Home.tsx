// The home page, design D ("Rally"), section by section. Anything that isn't
// a real fact is drawn as an illustration and labelled as one.
import { Finder, type FinderClub } from "./Finder";
import { Icon } from "./icons";
import { ScoreDemo } from "./ScoreDemo";
import { t } from "@/lib/messages";
import { availabilityOf, ctaTarget, href, logoSrc } from "@/lib/site";
import type { Content, Lang } from "@/lib/types";

type P = { lang: Lang; content: Content };

const PETAL_ICONS = ["shuttle", "paddle", "net", "court"];

export function Hero({ lang, content }: P) {
  const m = t(lang);
  const h = content.home.hero;
  const s = content.settings;
  const walk = ctaTarget("walkthrough", lang, s);
  return (
    <section id="top" className="wrap hero">
      <div className="hero-copy">
        <a href={href(lang, "/for-clubs")} className="card hero-badge">
          <span className="chip lime"><Icon name="star" size={14} strokeWidth={2.4} /></span>
          {h.badge[lang]}
          <Icon name="arrow" size={16} />
        </a>
        <h1 className="h-hero">
          {h.title[lang]} <span className="accent">{h.titleAccent[lang]}</span>
        </h1>
        <p className="lead">{h.lead[lang]}</p>
        <div className="cta-row">
          <a className="btn btn-primary btn-lg" href={ctaTarget("startClub", lang, s).href}>{h.primaryCta[lang]}</a>
          <a className="btn btn-secondary btn-lg" href={walk.href} rel={walk.external ? "noopener" : undefined}>{h.secondaryCta[lang]}</a>
        </div>
        {h.playerLine ? (
          <p className="hero-player">
            {h.playerLine[lang]}{" "}
            <a href={href(lang, "/find-a-club")}><Icon name="pin" size={16} />{h.playerCta[lang]}</a>
          </p>
        ) : null}
      </div>
      <div className="stage green court-lines">
        <div className="stage-mid" aria-hidden="true" />
        <div className="petals">
          {h.photos.slice(0, 4).map((p, i) =>
            p.image?.url ? (
              <div key={p._key} className="petal"><img src={`${p.image.url}?w=600&h=600&fit=crop&auto=format`} alt={p.image.alt?.[lang] ?? ""} width={300} height={300} loading="lazy" /></div>
            ) : (
              <div key={p._key} className="petal" role="img" aria-label={p.fallbackAlt[lang]}><Icon name={PETAL_ICONS[i]} strokeWidth={1.4} /></div>
            ),
          )}
          <div className="petal-heart"><img src="/brand/luvallplay-mark.svg" alt="" width={52} height={51} /></div>
        </div>
        <ScoreDemo words={m.score} caption={h.scoreCaption[lang]} label={h.scoreLabel[lang]} demo={m.badge.demo} />
        <div className="glass nextday hide-sm" aria-hidden="true">
          <span className="label accent">{h.nextLabel[lang]}</span>
          <span className="h-card">{h.nextTitle[lang]}</span>
          <span className="score-note">{h.nextMeta[lang]}</span>
        </div>
        {h.paidChip ? (
          <div className="navy kudos hide-sm" aria-hidden="true">
            <span className="kudos-ic kudos-ok"><Icon name="check" size={16} strokeWidth={2.6} /></span>
            {h.paidChip[lang]}
          </div>
        ) : null}
      </div>
    </section>
  );
}

const FEATURE_ICON: Record<string, string> = { memberships: "card", admin: "bell", modules: "flag" };

// The light primary and accent of each of the 12 club colour schemes
// (packages/ui/src/color-schemes.json), shown as swatches.
const SCHEMES: [string, string, string][] = [
  ["Court Green", "#0e6b4f", "#d4f23c"], ["Midnight Rally", "#1e3a8a", "#fbbf24"], ["Shuttle Mono", "#18181b", "#facc15"],
  ["Sunset Smash", "#c2410c", "#fde047"], ["Ocean Drive", "#0f766e", "#f9a8d4"], ["Royal Drop", "#6d28d9", "#6ee7b7"],
  ["Cherry Net", "#be123c", "#fcd34d"], ["Electric Serve", "#1d4ed8", "#fb923c"], ["Jungle Rally", "#166534", "#fda4af"],
  ["Aurora", "#0e7490", "#fef08a"], ["Plum Clear", "#86198f", "#5eead4"], ["Arctic Smash", "#075985", "#f0abfc"],
];

export function Features({ lang, content }: P) {
  const m = t(lang);
  const f = content.home.features;
  const by = Object.fromEntries(f.items.map((i) => [i.key, i]));
  // "Coming soon" comes from the availability list (content/availability.ts); the tile's own status is only a fallback.
  const soon = (key: string) => ((availabilityOf(content, key)?.status ?? by[key]?.status) === "soon" ? <span className="chip chip-soft">{m.badge.soon}</span> : null);
  const small = (k: string) =>
    by[k] ? (
      <div key={k} className="tile card lift rise">
        <span className="ic-box"><Icon name={FEATURE_ICON[k] ?? "check"} size={26} /></span>
        <h3 className="h-card">{by[k].title[lang]}</h3>
        <p className="card-p">{by[k].body[lang]}</p>
        {soon(k)}
      </div>
    ) : null;
  return (
    <section id="features" className="wrap sec">
      <div className="sec-head-center">
        <h2 className="h-sec">{f.title[lang]}</h2>
        <p className="lead-sm">{f.lead[lang]}</p>
      </div>
      <div className="bento">
        {by.sessions ? (
          <div className="tile tile-green green span2 on-green rise">
            <div className="tile-head">
              <div>
                <h3 className="h-card" style={{ fontSize: 36 }}>{by.sessions.title[lang]}</h3>
                <p>{by.sessions.body[lang]}</p>
              </div>
              <span className="ic-box ic-box-green"><Icon name="calendar" size={26} /></span>
            </div>
            <div className="rows" role="img" aria-label={`${m.badge.illustration}: ${f.sessionRows.map((r) => `${r.name[lang]}, ${r.meta[lang]}`).join("; ")}`}>
              {f.sessionRows.map((r, i) => (
                <div key={r._key} className="row" aria-hidden="true">
                  <span><b>{r.name[lang]}</b><span className="meta">{r.meta[lang]}</span></span>
                  <span className={`pill-mock ${i === 0 ? "btn-primary" : "btn-secondary"}`}>{r.action[lang]}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {by.fees ? (
          <div className="tile tile-navy navy on-dark rise">
            <h3 className="h-card">{by.fees.title[lang]}</h3>
            <p className="muted">{by.fees.body[lang]}</p>
            {f.feeModes?.length ? (
              <ul className="fee-modes">
                {f.feeModes.map((mode, i) => (
                  <li key={i}><Icon name="check" size={16} strokeWidth={2.6} />{mode[lang]}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {small("memberships")}

        {by.brand ? (
          <div className="tile tile-brand card span2 rise">
            <div>
              <h3 className="h-card" style={{ fontSize: 36 }}>{by.brand.title[lang]}</h3>
              <p className="card-p">{by.brand.body[lang]}</p>
            </div>
            <figure className="swatches">
              <ul aria-hidden="true">
                {SCHEMES.map(([name, primary, accent]) => (
                  <li key={name} title={name} style={{ background: primary }}><i style={{ background: accent }} /></li>
                ))}
              </ul>
              {f.schemesCaption ? <figcaption className="label muted">{f.schemesCaption[lang]}</figcaption> : null}
            </figure>
          </div>
        ) : null}

        {small("admin")}
        {small("modules")}
      </div>
    </section>
  );
}

export function VisionFigure({ lang, content }: P) {
  const m = t(lang).mock;
  const v = content.home.vision;
  const shots: [string, number, number][] = [[m.clear, 82, 41], [m.drop, 56, 28], [m.smash, 38, 19], [m.net, 30, 15]];
  const heat = [0.18, 0.5, 0.85, 0.3, 0.3, 0.65, 0.45, 0.12];
  return (
    <div className="vgrid">
      <figure className="vfig">
        <svg viewBox="0 0 800 440" preserveAspectRatio="none" role="img" aria-label={m.visionAlt}>
          <polygon points="250,70 550,70 720,420 80,420" fill="rgba(43,125,100,.18)" stroke="rgba(250,250,247,.55)" strokeWidth="2" />
          <line x1="400" y1="70" x2="400" y2="420" stroke="rgba(250,250,247,.35)" strokeWidth="2" />
          <line x1="183" y1="210" x2="617" y2="210" stroke="rgba(250,250,247,.8)" strokeWidth="3" />
          <path d="M300 360 C 360 120, 470 90, 520 150" fill="none" stroke="#d4f23c" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 10" />
          <circle cx="520" cy="150" r="9" fill="#d4f23c" stroke="#0b1b2b" strokeWidth="3" />
          <rect x="262" y="300" width="80" height="120" rx="10" fill="none" stroke="#d4f23c" strokeWidth="2.5" />
          <rect x="470" y="120" width="56" height="84" rx="8" fill="none" stroke="rgba(250,250,247,.8)" strokeWidth="2" />
        </svg>
        <figcaption className="chip lime">{t(lang).badge.sample}<span className="vh">: {v.figureCaption[lang]}</span></figcaption>
        <div className="glass-dark vchip vchip-rally" aria-hidden="true"><span className="dot" style={{ background: "#ff6b4a", width: 8, height: 8 }} />{m.rally}</div>
        <div className="glass vchip vchip-win" aria-hidden="true"><span className="label">{m.youSmash}</span><b>{m.winner}</b></div>
        <div className="glass-dark timeline" aria-hidden="true">
          <span className="play"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></span>
          <div className="scrub"><i /><i style={{ left: "12%" }} /><i style={{ left: "31%" }} /><i style={{ left: "57%" }} /><i style={{ left: "78%" }} /></div>
          <span style={{ fontSize: 13, color: "#a9b8b2" }}>{m.highlights}</span>
        </div>
      </figure>
      <div className="vstats" role="img" aria-label={v.figureCaption[lang]}>
        <div className="shots" aria-hidden="true">
          <span className="label">{m.shots}</span>
          <dl>
            {shots.map(([name, pct, n]) => (
              <div key={name}><dt>{name}</dt><span className="meter"><i style={{ width: `${pct}%` }} /></span><dd>{n}</dd></div>
            ))}
          </dl>
        </div>
        <div className="two" aria-hidden="true">
          <div className="glass-dark stat"><b>9.4</b><span>{m.avgRally}</span></div>
          <div className="glass-dark stat"><b>38</b><span>{m.longest}</span></div>
        </div>
        <div className="glass-dark heat" aria-hidden="true">
          <span className="label" style={{ color: "#a9b8b2" }}>{m.where}</span>
          <div className="heat-grid">{heat.map((o, i) => <i key={i} style={{ opacity: o }} />)}</div>
        </div>
      </div>
    </div>
  );
}

const BENEFIT_ICONS = ["phone", "arc", "cut", "star"];

export function Vision({ lang, content, page = false }: P & { page?: boolean }) {
  const m = t(lang);
  const v = content.home.vision;
  const H = page ? "h1" : "h2";
  const B = page ? "h2" : "h3";
  return (
    <section id="vision" className="vision-outer" style={page ? { paddingTop: 40 } : undefined}>
      <div className="vision navy on-dark">
        <div className="vhead">
          <div>
            <span className="eyebrow label muted"><span className="chip lime">{m.badge.new}</span>{v.eyebrow[lang]}</span>
            <H className="h-sec">{v.title[lang]}</H>
          </div>
          <div>
            <p className="lead-sm muted">{v.lead[lang]}</p>
            <div className="cta-row">
              {page ? (
                <a className="btn btn-lime btn-lg" href={href(lang, "/get-the-app")}><Icon name="video" size={20} />{m.form.submit.app}</a>
              ) : (
                <a className="btn btn-lime btn-lg" href={href(lang, "/vision")}><Icon name="video" size={20} />{v.primaryCta[lang]}</a>
              )}
              {page ? <a className="btn btn-ghost btn-lg" href="#vision-how">{v.secondaryCta[lang]}</a> : null}
            </div>
          </div>
        </div>
        <VisionFigure lang={lang} content={content} />
        <p className="vnote">{v.figureCaption[lang]}.{page ? ` ${(availabilityOf(content, "vision")?.note ?? v.note)[lang]}` : ""}</p>
        {page ? (
          <div id="vision-how" className="benefits">
            {v.benefits.map((b, i) => (
              <div key={b._key} className="glass-dark benefit">
                <Icon name={BENEFIT_ICONS[i % 4]} size={26} />
                <B className="h-small">{b.title[lang]}</B>
                <p>{b.body[lang]}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function How({ lang, content }: P) {
  const m = t(lang);
  const h = content.home.how;
  const hero = content.home.hero;
  const s = content.settings;
  const live = s.launchMode === "live";
  const stores: ["appStore" | "playStore", string][] = [["appStore", m.mock.appStore], ["playStore", m.mock.playStore]];
  return (
    <section id="members" className="wrap how">
      <div>
        <div className="phone-wrap">
          <div className="phone" role="img" aria-label={m.mock.caption}>
            <div className="screen" aria-hidden="true">
              <div className="screen-top"><b>{m.mock.home}</b><span className="bell"><Icon name="bell" size={20} /><i /></span></div>
              <div className="m-card m-green green"><span className="label">{m.mock.next}</span><b>{hero.nextLabel[lang]}</b><span>{m.mock.youreIn}</span></div>
              <div className="m-card m-rank"><div><span className="label">{m.mock.rank}</span><b>#4</b></div><span className="chip lime">{m.mock.up}</span></div>
              <div className="m-card">
                <span className="label">{m.mock.arena}</span>
                <span style={{ fontWeight: 600 }}>{m.mock.challenge}</span>
                <span className="m-btns"><span className="btn-primary">{m.mock.accept}</span><span className="btn-secondary">{m.mock.decline}</span></span>
              </div>
              <div className="m-tabs">{m.mock.tabs.map((tab, i) => <span key={tab} className={i === 0 ? "btn-primary" : undefined}>{tab}</span>)}</div>
            </div>
          </div>
          <div className="glass float float-booked" aria-hidden="true"><i className="btn-primary"><Icon name="check" size={14} strokeWidth={2.6} /></i>{m.mock.booked}</div>
          <div className="glass float float-final" aria-hidden="true"><span className="label muted" style={{ fontSize: 11 }}>{m.mock.final}</span><b>{m.mock.finalScore}</b></div>
        </div>
        <p className="phone-cap">{m.mock.caption}</p>
      </div>
      <div className="how-copy">
        <div className="how-head">
          {h.eyebrow ? <span className="label accent">{h.eyebrow[lang]}</span> : null}
          <h2 className="h-sec">{h.title[lang]}</h2>
          {h.lead ? <p className="lead-sm">{h.lead[lang]}</p> : null}
        </div>
        <ol className="steps">
          {h.steps.map((st, i) => (
            <li key={st._key} className="card step">
              <span className={`num ${i === 1 ? "btn-dark" : "btn-primary"}`} aria-hidden="true">{i + 1}</span>
              <div><h3 className="h-small">{st.title[lang]}</h3><p>{st.body[lang]}</p></div>
            </li>
          ))}
        </ol>
        <div className="stores">
          {stores.map(([kind, label]) => {
            const target = ctaTarget(kind, lang, s);
            return (
              <a key={kind} className="btn btn-dark btn-store" href={target.href} rel={target.external ? "noopener" : undefined}>
                {target.soon ? <small>{m.badge.soon}</small> : null}
                {label}
              </a>
            );
          })}
        </div>
        {(availabilityOf(content, "storeApps")?.status ?? (live ? "live" : "soon")) === "live" ? null : <p>{(availabilityOf(content, "storeApps")?.note ?? h.storeNote)[lang]}</p>}
      </div>
    </section>
  );
}

export function finderProps(lang: Lang, content: Content) {
  const m = t(lang);
  const sportName = Object.fromEntries(content.sports.map((s) => [s.key, s.name[lang]]));
  const clubs: FinderClub[] = content.clubs.map((c) => ({
    id: c._id,
    name: c.name,
    sportKey: c.sportKey,
    sport: sportName[c.sportKey] ?? c.sportKey,
    place: [c.suburb, c.city, c.country].filter(Boolean).join(", "),
    schedule: c.schedule[lang],
    meta: c.audience[lang],
    url: c.url,
    logo: c.logo?.url ? logoSrc(c.logo.url) : undefined,
    logoAlt: c.logo?.alt?.[lang] ?? "",
  }));
  return {
    clubs,
    sports: content.sports.map((s) => ({ key: s.key, name: s.name[lang], live: s.status === "live" })),
    inviteHref: href(lang, "/invite-a-club"),
    heading: "h3" as "h2" | "h3",
    words: { ...m.finder, soon: m.badge.soon, count: [m.finder.results(1), m.finder.results(0).replace("0", "{n}")] as [string, string], results: undefined },
  };
}

export function FinderSection({ lang, content }: P) {
  const f = content.home.finder;
  return (
    <section id="finder" className="wrap sec" style={{ gap: 32 }}>
      <div className="sec-head-split">
        <h2 className="h-sec">{f.title[lang]}</h2>
        <p>{f.lead[lang]}</p>
      </div>
      <Finder {...finderProps(lang, content)} />
    </section>
  );
}

export function ForClubs({ lang, content }: P) {
  const c = content.home.clubs;
  const s = content.settings;
  const walk = ctaTarget("walkthrough", lang, s);
  return (
    <section id="clubs" className="clubs-outer">
      <div className="clubs green court-lines on-green">
        <div>
          <span className="label">{c.eyebrow[lang]}</span>
          <h2 className="h-sec">{c.title[lang]}</h2>
          <p className="lead-sm">{c.lead[lang]}</p>
          <div className="cta-row">
            <a className="btn btn-secondary btn-lg" href={ctaTarget("startClub", lang, s).href}>{c.primaryCta[lang]}</a>
            <a className="btn btn-ghost btn-lg" href={walk.href} rel={walk.external ? "noopener" : undefined}>{c.secondaryCta[lang]}</a>
          </div>
        </div>
        {c.steps?.length ? (
          <ol className="club-steps">
            {c.steps.map((st, i) => (
              <li key={st._key} className="navy">
                <span className="num lime" aria-hidden="true">{i + 1}</span>
                <div><h3 className="h-small">{st.title[lang]}</h3><p>{st.body[lang]}</p></div>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  );
}

export function Pricing({ lang, content, heading = "h2" }: P & { heading?: "h2" | "h3" }) {
  const p = content.home.pricing;
  const s = content.settings;
  const H = heading;
  return (
    <section id="pricing" className="wrap pricing">
      <div className="green price price-green on-green">
        <span className="chip lime">{p.clubs.badge[lang]}</span>
        <H className="label">{p.clubs.eyebrow[lang]}</H>
        <p className="big">{p.clubs.price[lang]}</p>
        <p>{p.clubs.body[lang]}</p>
        <p className="price-note">{p.clubs.note[lang]}</p>
        <a className="btn btn-secondary" href={ctaTarget("startClub", lang, s).href}>{p.clubs.cta[lang]}</a>
      </div>
      <div className="card price">
        <H className="label muted">{p.players.eyebrow[lang]}</H>
        <p className="big">{p.players.price[lang]}</p>
        <p className="muted">{p.players.body[lang]}</p>
        <a className="btn btn-dark" href={ctaTarget("getApp", lang, s).href}>{p.players.cta[lang]}</a>
      </div>
    </section>
  );
}
