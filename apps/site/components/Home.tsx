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
  return (
    <section id="top" className="wrap hero">
      <div className="hero-copy">
        <a href={href(lang, "/vision")} className="card hero-badge">
          <span className="chip lime">{m.badge.new}</span>
          {h.badge[lang]}
          <Icon name="arrow" size={16} />
        </a>
        <h1 className="h-hero">
          {h.title[lang]} <span className="accent">{h.titleAccent[lang]}</span>
        </h1>
        <p className="lead">{h.lead[lang]}</p>
        <div className="cta-row">
          <a className="btn btn-primary btn-lg" href={href(lang, "/find-a-club")}><Icon name="pin" size={20} />{h.primaryCta[lang]}</a>
          <a className="btn btn-secondary btn-lg" href={href(lang, "/for-clubs")}>{h.secondaryCta[lang]}</a>
        </div>
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
        <div className="navy kudos hide-sm" aria-hidden="true">
          <span className="kudos-ic"><Icon name="heart" size={16} strokeWidth={2.2} /></span>
          {h.kudos[lang]}
        </div>
      </div>
    </section>
  );
}

export function Sports({ lang, content }: P) {
  const m = t(lang);
  return (
    <section aria-label={m.finder.sportsLabel} className="wrap sports">
      <p className="muted" style={{ fontSize: 14 }}>{content.home.sports.intro[lang]}</p>
      <ul>
        {content.sports.map((s) => (
          <li key={s.key} className="card">
            {s.name[lang]}
            {s.status === "live" ? <span className="chip lime">{m.badge.live}</span> : <span className="soon">{m.badge.soon}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const FEATURE_ICON: Record<string, string> = { challenges: "flag", memberships: "card", social: "chat", marketplace: "bag" };

export function Features({ lang, content }: P) {
  const m = t(lang);
  const f = content.home.features;
  const by = Object.fromEntries(f.items.map((i) => [i.key, i]));
  // "Coming soon" comes from the availability list, never from the tile itself.
  const soon = (key: string) => (availabilityOf(content, key)?.status === "soon" ? <span className="chip chip-soft">{m.badge.soon}</span> : null);
  return (
    <section id="features" className="wrap sec">
      <div className="sec-head-center">
        <h2 className="h-sec">{f.title[lang]}</h2>
        <p className="lead-sm">{f.lead[lang]}</p>
      </div>
      <div className="bento">
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

        <div className="tile tile-navy navy on-dark rise">
          <h3 className="h-card">{by.rankings.title[lang]}</h3>
          <p className="muted">{by.rankings.body[lang]}</p>
          <div className="ladder" role="img" aria-label={`${m.badge.illustration}: ${content.home.rankings.note[lang]}`}>
            <div aria-hidden="true"><span className="pos">1</span><span className="bar" /></div>
            <div aria-hidden="true" className="you lime"><span className="pos">2</span><span style={{ flex: 1 }}>{m.mock.you}</span></div>
            <div aria-hidden="true"><span className="pos">3</span><span className="bar bar-short" /></div>
          </div>
        </div>

        {(["challenges", "memberships"] as const).map((k) => (
          <div key={k} className="tile card lift rise">
            <span className="ic-box"><Icon name={FEATURE_ICON[k]} size={26} /></span>
            <h3 className="h-card">{by[k].title[lang]}</h3>
            <p className="card-p">{by[k].body[lang]}</p>
          </div>
        ))}

        <div className="tile tile-finder card span2 rise">
          <div>
            <h3 className="h-card" style={{ fontSize: 36 }}>{by.finder.title[lang]}</h3>
            <p className="card-p">{by.finder.body[lang]}</p>
            <a className="btn btn-primary btn-sm" href={href(lang, "/find-a-club")}>{f.finderCta[lang]}</a>
          </div>
          <div className="map" aria-hidden="true">
            <i className="road1" /><i className="road2" /><i className="pin" />
            <div className="glass map-chip">{f.mapChip[lang]}</div>
          </div>
        </div>

        {(["social", "marketplace"] as const).map((k) => (
          <div key={k} className={`tile card lift rise${k === "marketplace" ? " tile-wide" : ""}`}>
            <span className="ic-box"><Icon name={FEATURE_ICON[k]} size={26} />{k === "social" ? <span className="ic-dot" /> : null}</span>
            <h3 className="h-card">{by[k].title[lang]}</h3>
            <p className="card-p">{by[k].body[lang]}</p>
            {soon(k)}
          </div>
        ))}
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
              <a className="btn btn-ghost btn-lg" href="#vision-how">{v.secondaryCta[lang]}</a>
            </div>
          </div>
        </div>
        <VisionFigure lang={lang} content={content} />
        <p className="vnote">{v.figureCaption[lang]}. {availabilityOf(content, "vision")?.note[lang]}</p>
        <div id="vision-how" className="benefits">
          {v.benefits.map((b, i) => (
            <div key={b._key} className="glass-dark benefit">
              <Icon name={BENEFIT_ICONS[i % 4]} size={26} />
              <B className="h-small">{b.title[lang]}</B>
              <p>{b.body[lang]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function How({ lang, content }: P) {
  const m = t(lang);
  const h = content.home.how;
  const hero = content.home.hero;
  const s = content.settings;
  const stores: ["appStore" | "playStore", string][] = [["appStore", m.mock.appStore], ["playStore", m.mock.playStore]];
  return (
    <section className="wrap how">
      <div>
        <div className="phone-wrap">
          <div className="phone" role="img" aria-label={m.mock.caption}>
            <div className="screen" aria-hidden="true">
              <div className="screen-top"><b>{m.mock.home}</b><span className="bell"><Icon name="bell" size={20} /><i /></span></div>
              <div className="m-card m-green green"><span className="label">{hero.nextLabel[lang]}</span><b>{hero.nextTitle[lang]}</b><span>{hero.nextMeta[lang]}</span></div>
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
        <h2 className="h-sec">{h.title[lang]}</h2>
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
        {availabilityOf(content, "storeApps")?.status === "live" ? null : <p>{availabilityOf(content, "storeApps")?.note[lang]}</p>}
      </div>
    </section>
  );
}

export function Rankings({ lang, content }: P) {
  const m = t(lang);
  const r = content.home.rankings;
  return (
    <section id="rankings" className="rank-band">
      <div className="wrap sec">
        <div className="sec-head-split">
          <div className="rank-head">
            <span className="chip lime">{r.eyebrow[lang]}</span>
            <h2 className="h-sec">{r.title[lang]}</h2>
          </div>
          <p>{r.lead[lang]}</p>
        </div>
        <div className="podium" role="img" aria-label={r.note[lang]}>
          <div className="card pod pod-2" aria-hidden="true"><span className="pos">2</span><span className="skel" /><span className="skel skel-sm" /><span className="chip lime">{m.mock.up}</span></div>
          <div className="green pod pod-1" aria-hidden="true"><span className="pos">1</span><span className="skel" /><span className="skel skel-sm" /></div>
          <div className="card pod" aria-hidden="true"><span className="pos">3</span><span className="skel" /><span className="skel skel-sm" /></div>
          <ol className="rank-list" aria-hidden="true">
            <li className="card"><span className="pos">4</span><span className="skel" /></li>
            <li className="card"><span className="pos">5</span><span className="skel" style={{ width: "50%" }} /></li>
          </ol>
        </div>
        <p className="note"><span className="chip chip-soft">{m.badge.illustration}</span> {r.note[lang]} <a href={href(lang, "/help/challenges-and-the-ladder")}>{r.cta[lang]}</a></p>
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

export function Story({ lang, content }: P) {
  const s = content.home.story;
  const m = t(lang);
  const quote = content.testimonials[0];
  const club = content.clubs.find((x) => x.slug === "three-wolves") ?? content.clubs[0];
  return (
    <section className="wrap story">
      <div className="collage" role="img" aria-label={s.caption[lang]}>
        <div className="c1"><Icon name="court" strokeWidth={1.2} /></div>
        <div className="c2"><Icon name="shuttle" strokeWidth={1.2} /></div>
        <div className="c3"><Icon name="net" strokeWidth={1.2} /></div>
      </div>
      {quote ? (
        <figure>
          <span className="quote-mark" aria-hidden="true"><img src="/brand/luvallplay-mark.svg" alt="" width={40} height={39} /></span>
          <blockquote>{quote.quote[lang]}</blockquote>
          <figcaption className="muted" style={{ fontSize: 14 }}>{quote.name}, {quote.role[lang]} · {quote.club}</figcaption>
        </figure>
      ) : (
        <div className="story-copy">
          <span className="quote-mark" aria-hidden="true"><img src="/brand/luvallplay-mark.svg" alt="" width={40} height={39} /></span>
          <h2>{s.title[lang]}</h2>
          <p className="lead-sm">{s.body[lang]}</p>
          {club ? (
            <a className="card first-club" href={club.url} rel="noopener">
              {club.logo?.url ? <span className="club-logo club-logo-lg"><img src={logoSrc(club.logo.url, 240)} alt={club.logo.alt?.[lang] ?? ""} width={94} height={80} loading="lazy" /></span> : null}
              <span><span className="label muted">{m.mock.firstClub}</span><b>{club.name}</b><span className="go">{m.mock.visitClub}</span></span>
            </a>
          ) : null}
          <p className="note">{s.caption[lang]}</p>
        </div>
      )}
    </section>
  );
}

export function ForClubs({ lang, content }: P) {
  const m = t(lang);
  const c = content.home.clubs;
  const s = content.settings;
  const club = content.clubs.find((x) => x.slug === "three-wolves") ?? content.clubs[0];
  const sport = content.sports.find((x) => x.key === club?.sportKey);
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
        <div style={{ gap: 16 }}>
          {club ? (
            <div className="tw-card">
              <div className="tw-head">
                {club.logo?.url ? (
                  <span className="club-logo"><img src={logoSrc(club.logo.url)} alt={club.logo.alt?.[lang] ?? ""} width={56} height={48} loading="lazy" /></span>
                ) : (
                  <span className="tw-logo btn-dark" aria-hidden="true">{club.name.split(" ").slice(0, 2).map((w) => w[0]).join("")}</span>
                )}
                <span><small className="label">{m.mock.firstClub}</small><b><a href={club.url} rel="noopener">{club.name}</a></b><small>{club.city} · {club.schedule[lang]}</small></span>
              </div>
              <div className="tw-stats">
                <div><b>2</b><span>{m.mock.sessionsWeek}</span></div>
                <div><b style={{ fontSize: 30 }}>{sport?.name[lang]}</b><span>{m.mock.sport}</span></div>
              </div>
              <div className="tw-foot"><img src="/brand/luvallplay-mark.svg" alt="" width={18} height={18} />{m.mock.onLuvallplay}</div>
            </div>
          ) : null}
          <div className="trio">
            {c.stats.map((st) => <div key={st._key} className="navy"><b>{st.value[lang]}</b><span>{st.label[lang]}</span></div>)}
          </div>
        </div>
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
      <div className="card price">
        <H className="label muted">{p.players.eyebrow[lang]}</H>
        <p className="big">{p.players.price[lang]}</p>
        <p className="muted">{p.players.body[lang]}</p>
        <a className="btn btn-dark" href={ctaTarget("getApp", lang, s).href}>{p.players.cta[lang]}</a>
      </div>
      <div className="green price price-green on-green">
        <span className="chip lime">{p.clubs.badge[lang]}</span>
        <H className="label">{p.clubs.eyebrow[lang]}</H>
        <p className="big">{p.clubs.price[lang]}</p>
        <p>{p.clubs.body[lang]}</p>
        <p className="price-note">{p.clubs.note[lang]}</p>
        <a className="btn btn-secondary" href={ctaTarget("startClub", lang, s).href}>{p.clubs.cta[lang]}</a>
      </div>
    </section>
  );
}
