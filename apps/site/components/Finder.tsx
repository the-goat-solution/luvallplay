"use client";
// Find a club: sport chips and a suburb or city search over the curated club
// list. Without JavaScript the full list shows.
import { useState } from "react";
import { fold } from "@/lib/site";

export type FinderClub = { id: string; name: string; sportKey: string; sport: string; place: string; schedule: string; meta: string; url: string; logo?: string; logoAlt?: string };
type Words = { all: string; input: string; placeholder: string; search: string; sportsLabel: string; book: string; empty: string; emptyPlace: string; invite: string; opensClub: string; soon: string; count: [string, string] };

export function Finder({ clubs, sports, words, inviteHref, heading: H = "h3" }: { heading?: "h2" | "h3"; clubs: FinderClub[]; sports: { key: string; name: string; live: boolean }[]; words: Words; inviteHref: string }) {
  const [sport, setSport] = useState("all");
  const [typed, setTyped] = useState("");
  const [place, setPlace] = useState("");
  const q = fold(place);
  const bySport = clubs.filter((c) => sport === "all" || c.sportKey === sport);
  const shown = bySport.filter((c) => !q || fold(`${c.place} ${c.name}`).includes(q));
  return (
    <>
      <form role="search" className="finder-bar" onSubmit={(e) => { e.preventDefault(); setPlace(typed); }}>
        <label>
          {words.input}
          <input className="input" type="search" name="place" autoComplete="address-level2" placeholder={words.placeholder} value={typed} onChange={(e) => { setTyped(e.target.value); setPlace(e.target.value); }} />
        </label>
        <button className="btn btn-primary" type="submit">{words.search}</button>
      </form>
      <div className="chips" role="group" aria-label={words.sportsLabel}>
        {[{ key: "all", name: words.all, live: true }, ...sports].map((s) => (
          <button key={s.key} type="button" className={`btn ${sport === s.key ? "btn-dark" : "btn-secondary"}`} aria-pressed={sport === s.key} onClick={() => setSport(s.key)}>
            {s.name}
            {s.live ? null : <small>· {words.soon}</small>}
          </button>
        ))}
      </div>
      <p className="vh" role="status">{shown.length === 1 ? words.count[0] : words.count[1].replace("{n}", String(shown.length))}</p>
      {shown.length ? (
        <ul className="club-grid">
          {shown.map((c) => (
            <li key={c.id} className="card club">
              <div className="club-top"><span className="chip chip-soft">{c.sport}</span><span>{c.schedule}</span></div>
              {c.logo ? <span className="club-logo"><img src={c.logo} alt={c.logoAlt ?? ""} width={56} height={48} loading="lazy" /></span> : null}
              <H className="h-card">{c.name}</H>
              <p>{c.place} · {c.meta}</p>
              <a className="btn btn-primary btn-sm" href={c.url} rel="noopener">{words.book}<span className="vh"> ({c.name}, {words.opensClub})</span></a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <p>{bySport.length ? words.emptyPlace : words.empty}</p>
          <a className="btn btn-secondary btn-sm" href={inviteHref}>{words.invite}</a>
        </div>
      )}
    </>
  );
}
