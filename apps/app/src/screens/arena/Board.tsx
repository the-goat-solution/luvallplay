// The Arena board's cards: your pair (or a request), your challenges, games
// live now, open challenges, and the crown, feed and hot streak.
import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useCurrentClub } from "../../hooks.tsx";
import { localeOf, openFor } from "../../lib/format.ts";
import { errorCode, pairTitle, useArenaAction, type ArenaState, type Challenge, type Chip, type Pair } from "./data.ts";
import type { ArenaT } from "./words.ts";
import { MatchStats } from "./Stats.tsx";
import { RankIcon } from "../../components/RankIcon.tsx";
import { useVisionStatus } from "../vision/data.ts";
import { Icon } from "../../components/Icon.tsx";

/** "Set up {visionName}", with "Free now" during the tracker's free trial (as on the website). */
function RecordStats({ id, t, hint = false }: { id: number; t: ArenaT; hint?: boolean }) {
  const trial = !!useVisionStatus().data?.trial;
  return (
    <span className="stack-tight">
      <Link to="/vision" search={{ challenge: id } as never} className="button">
        {t("rec_stats")}
        {trial && <em className="tag free-tag">{t("rec_stats_free")}</em>}
      </Link>
      {hint && <span className="muted small">{t(trial ? "rec_stats_hint_trial" : "rec_stats_hint")}</span>}
    </span>
  );
}

type Props = { t: ArenaT; rank: (i: number) => string; onError: (code: string) => void };
type MeView = NonNullable<ArenaState["me"]>;
const HOUR = 3_600_000;

function Person({ p, rank }: { p: Chip; rank: (i: number) => string }) {
  return (
    <span className="person">
      <span className="board-face">
        <span className="avatar avatar-small" aria-hidden="true">{p.initials}</span>
        <RankIcon index={p.rank} px={20} className="board-face-rank" />
      </span>
      <span className="person-text">
        <strong>{p.name}</strong>
        <span className="muted small">{rank(p.rank)}</span>
      </span>
    </span>
  );
}

function PairBlock({ pair, rank }: { pair: Pair; rank: (i: number) => string }) {
  return (
    <div className="pair-block">
      {pair.name && <strong className="pair-name">{pair.name}</strong>}
      <Person p={pair.players[0]} rank={rank} />
      <Person p={pair.players[1]} rank={rank} />
    </div>
  );
}

/** Someone wants to team up (or you asked someone). */
export function Requests({ me, t, onError }: { me: MeView } & Omit<Props, "rank">) {
  const action = useArenaAction();
  const run = (a: Parameters<typeof action.mutate>[0]) => action.mutate(a, { onError: (e) => onError(errorCode(e)) });
  if (me.incomingRequest) {
    return (
      <section className="card stack arena-me" aria-labelledby="req-title" id="arena-me">
        <h2 id="req-title">{t("request_in", { name: me.incomingRequest.name })}</h2>
        <p className="muted">{t("request_in_body")}</p>
        {me.pair && <p className="notice">{t("replaces_pair")}</p>}
        <div className="actions">
          <button type="button" className="button button-primary" disabled={action.isPending} onClick={() => run({ action: "pair_respond", accept: true })}>{t("accept")}</button>
          <button type="button" className="button button-quiet" disabled={action.isPending} onClick={() => run({ action: "pair_respond", accept: false })}>{t("decline")}</button>
        </div>
      </section>
    );
  }
  if (!me.pair && me.outgoingRequest) {
    return (
      <section className="card stack arena-me" id="arena-me">
        <p role="status">{t("request_out", { name: me.outgoingRequest.name })}</p>
        <div><button type="button" className="button button-quiet" disabled={action.isPending} onClick={() => run({ action: "pair_cancel" })}>{t("cancel")}</button></div>
      </section>
    );
  }
  return null;
}

/** Your pair: its record, putting it up for a challenge (or taking it down), naming and splitting. */
export function PairPanel({ me, state, t, rank, onError, lang }: { me: MeView; state: ArenaState; lang: string } & Props) {
  const action = useArenaAction();
  const run = (a: Parameters<typeof action.mutate>[0], then?: () => void) => action.mutate(a, { onSuccess: then, onError: (e) => onError(errorCode(e)) });
  const pair = me.pair!;
  const partner = pair.players.find((p) => p.id !== me.id) ?? pair.players[1];
  const up = state.mine.find((c) => c.status === "open");
  const busy = state.mine.some((c) => ["accepted", "live", "awaiting", "disputed"].includes(c.status));
  const [composing, setComposing] = useState(false);
  const [days, setDays] = useState<0 | 3 | 7>(3);
  const [note, setNote] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(pair.name ?? "");
  const post = (e?: FormEvent) => {
    e?.preventDefault();
    run({ action: "post", days, note: note.trim() }, () => { setComposing(false); setNote(""); });
  };
  const until = (iso: string) => new Date(iso).toLocaleString(localeOf(lang, ""), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <section className="card stack arena-me" aria-labelledby="pair-title" id="arena-me">
      <div className="card-head">
        <div>
          <h2 className="title" id="pair-title">{pair.name || t("you_and", { name: partner.name })}</h2>
          <p className="muted small">
            {t("pair_record", { w: pair.record.won, l: pair.record.lost })}
            {pair.record.streak >= 2 && <> · {t("in_a_row", { n: pair.record.streak })}</>}
          </p>
        </div>
      </div>
      <PairBlock pair={pair} rank={rank} />
      {up ? (
        <div className="stack up-now">
          <strong>{t("up_now")}</strong>
          <span className="muted small">{t("up_until", { when: until(up.availableUntil) })}</span>
          <div><button type="button" className="button" disabled={action.isPending} onClick={() => run({ action: "cancel", id: up.id })}>{t("take_down")}</button></div>
        </div>
      ) : busy ? null : composing ? (
        <form className="stack" onSubmit={post}>
          <fieldset className="stack">
            <legend>{t("open_for")}</legend>
            <div className="actions">
              {([0, 3, 7] as const).map((d) => (
                <label key={d} className="choice">
                  <input type="radio" name="days" checked={days === d} onChange={() => setDays(d)} />
                  <span>{t(`days_${d}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span>{t("note_ph")}</span>
            <input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={action.isPending}>{t("post_btn")}</button>
            <button type="button" className="button button-quiet" onClick={() => setComposing(false)}>{t("cancel")}</button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <p className="muted small">{t("throw_hint")}</p>
          <div className="actions">
            <button type="button" className="button button-primary" disabled={action.isPending} onClick={() => run({ action: "post", days: 3, note: "" })}>{t("throw_down")}</button>
            <button type="button" className="button button-quiet" onClick={() => setComposing(true)}>{t("post_options")}</button>
          </div>
        </div>
      )}
      {naming ? (
        <form className="actions" onSubmit={(e) => { e.preventDefault(); run({ action: "pair_rename", name: name.trim() }, () => setNaming(false)); }}>
          <label className="field grow">
            <span>{t("name_pair")}</span>
            <input value={name} maxLength={24} placeholder={t("name_ph")} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="button" disabled={action.isPending}>{t("save")}</button>
          <button type="button" className="button button-quiet" onClick={() => setNaming(false)}>{t("cancel")}</button>
        </form>
      ) : (
        <div className="actions">
          {!busy && <button type="button" className="button button-quiet" onClick={() => setNaming(true)}>{t("name_pair")}</button>}
          <button
            type="button"
            className="button button-quiet"
            disabled={action.isPending}
            onClick={() => window.confirm(t("split_confirm", { name: partner.name })) && run({ action: "pair_leave" })}
          >
            {t("split")}
          </button>
        </div>
      )}
    </section>
  );
}

const scoreText = (c: Challenge, t: ArenaT) => (c.retiredBy ? t("retired_score") : `${c.scorePosting ?? 0}–${c.scoreAccepting ?? 0}`);

/** One of your challenges that's under way: check in, call off, enter or answer a score. */
function MyChallenge({ c, t, rank, onError, onScore }: { c: Challenge; onScore: (c: Challenge) => void } & Props) {
  const action = useArenaAction();
  const run = (a: Parameters<typeof action.mutate>[0]) => action.mutate(a, { onError: (e) => onError(errorCode(e)) });
  const [disputing, setDisputing] = useState(false);
  const visionOn = !!useCurrentClub().config?.modules.includes("vision");
  const [note, setNote] = useState("");
  const them = c.mySide === "posting" ? c.accepting : c.posting;
  const names = them ? pairTitle(them) : "";
  return (
    <article className="card stack challenge" id={`challenge-${c.id}`} aria-label={c.accepting ? `${pairTitle(c.posting)} ${t("vs")} ${pairTitle(c.accepting)}` : pairTitle(c.posting)}>
      <div className="versus">
        <PairBlock pair={c.posting} rank={rank} />
        <span className="vs" aria-hidden="true">{t("vs")}</span>
        {c.accepting && <PairBlock pair={c.accepting} rank={rank} />}
      </div>
      {c.status === "accepted" && (
        <>
          <p>{t("st_accepted")}</p>
          <div className="actions">
            <button type="button" className="button button-primary" disabled={action.isPending} onClick={() => run({ action: "checkin_now", id: c.id })}>{t("were_here")}</button>
            <button type="button" className="button button-quiet" disabled={action.isPending} onClick={() => run({ action: "call_off", id: c.id })}>{t("call_off")}</button>
          </div>
        </>
      )}
      {c.status === "live" && (
        <>
          <p><span className="live-dot" aria-hidden="true" /> {t("st_live")}</p>
          <div className="actions">
            <button type="button" className="button button-primary" onClick={() => onScore(c)}>{t("score_title")}</button>
            {visionOn && <RecordStats id={c.id} t={t} />}
            <button type="button" className="button button-quiet" disabled={action.isPending} onClick={() => run({ action: "call_off", id: c.id })}>{t("call_off")}</button>
          </div>
        </>
      )}
      {c.status === "awaiting" && c.enteredByMySide && (
        <p className="muted">{t("st_awaiting_mine", { names, score: scoreText(c, t) })} {t("auto_confirm")}</p>
      )}
      {c.status === "awaiting" && !c.enteredByMySide && (
        <>
          <p>{t("st_awaiting_theirs", { names, score: scoreText(c, t) })}</p>
          {!disputing ? (
            <div className="actions">
              <button type="button" className="button button-primary" disabled={action.isPending} onClick={() => run({ action: "confirm", id: c.id })}>{t("confirm")}</button>
              <button type="button" className="button button-quiet" onClick={() => setDisputing(true)}>{t("wrong")}</button>
            </div>
          ) : (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); run({ action: "dispute", id: c.id, note: note.trim() }); }}>
              <label className="field">
                <span>{t("dispute_ph")}</span>
                <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="actions">
                <button type="submit" className="button button-danger" disabled={action.isPending}>{t("dispute_send")}</button>
                <button type="button" className="button button-quiet" onClick={() => setDisputing(false)}>{t("cancel")}</button>
              </div>
            </form>
          )}
        </>
      )}
      {c.status === "disputed" && <p className="muted">{t("st_disputed")}</p>}
    </article>
  );
}

export function Mine({ state, ...props }: { state: ArenaState; onScore: (c: Challenge) => void } & Props) {
  const list = state.mine.filter((c) => c.status !== "open");
  if (!list.length) return null;
  return (
    <section className="stack" aria-labelledby="mine-title">
      <h2 id="mine-title">{props.t("mine")}</h2>
      {list.map((c) => <MyChallenge key={c.id} c={c} {...props} />)}
    </section>
  );
}

export function Live({ state, t, rank }: { state: ArenaState } & Omit<Props, "onError">) {
  const visionOn = !!useCurrentClub().config?.modules.includes("vision");
  if (!state.live.length) return null;
  const now = Date.parse(state.now);
  return (
    <section className="stack" aria-labelledby="live-title">
      <h2 id="live-title">{t("live_now")}</h2>
      {state.live.map((c) => (
        <article key={c.id} className="card stack challenge" aria-label={`${pairTitle(c.posting)} ${t("vs")} ${c.accepting ? pairTitle(c.accepting) : ""}`}>
          <p className="live-label">
            <span className="live-dot" aria-hidden="true" /> {t("live")}
            {c.checkedInAt && <span className="muted small"> · {t("minutes", { n: Math.max(0, Math.round((now - Date.parse(c.checkedInAt)) / 60_000)) })}</span>}
          </p>
          <div className="versus">
            <PairBlock pair={c.posting} rank={rank} />
            <span className="vs" aria-hidden="true">{t("vs")}</span>
            {c.accepting && <PairBlock pair={c.accepting} rank={rank} />}
          </div>
          {c.tracking ? (
            <p className="muted small"><span className="live-dot" aria-hidden="true" /> {t("wv_live")} · {t("wv_live_stats", { rallies: c.tracking.rallies, hits: c.tracking.hits })}</p>
          ) : (
            visionOn && <RecordStats id={c.id} t={t} hint />
          )}
        </article>
      ))}
    </section>
  );
}

/** An open challenge anyone's pair can take. */
function FightCard({ c, i, count, me, now, t, rank, onError }: { c: Challenge; i: number; count: number; me: MeView | null; now: number } & Props) {
  const action = useArenaAction();
  const partner = me?.pair?.players.find((p) => p.id !== me.id);
  const leftMs = Date.parse(c.availableUntil) - now;
  const open = openFor(leftMs);
  const left = open.unit === "today" ? t("open_today") : open.unit === "hours" ? t("open_hours", { n: open.n }) : t("open_days", { n: open.n });
  const chips = [c.offer?.crown && t("chip_crown"), c.offer?.giantKiller && t("chip_gk"), c.offer?.newRival && t("chip_nr")].filter(Boolean) as string[];
  const ribbon = c.crownMatch ? t("crown_ribbon") : i === 0 && count > 2 ? t("hot_ribbon") : null;
  return (
    <article className="card stack challenge fight" id={`challenge-${c.id}`} aria-label={pairTitle(c.posting)}>
      {ribbon && <span className="ribbon">{ribbon}</span>}
      <div className="versus">
        <PairBlock pair={c.posting} rank={rank} />
        <span className="vs" aria-hidden="true">{t("vs")}</span>
        <div className="pair-block slot">
          <span className="slot-mark" aria-hidden="true">?</span>
          <span className="muted small">{partner ? t("slot_you", { name: partner.name }) : t("slot_anyone")}</span>
        </div>
      </div>
      {c.h2h && <p className="muted small">{c.h2h.won + c.h2h.lost === 0 ? t("h2h_never") : t("h2h", { w: c.h2h.won, l: c.h2h.lost })}</p>}
      {c.note && <p className="note">“{c.note}”</p>}
      <p className="chips">
        {(chips.length ? chips : [t("chip_even")]).map((x) => <span key={x} className="tag">{x}</span>)}
        <span className="tag tag-quiet">{left}</span>
      </p>
      {c.blocker ? (
        <p className="muted small">{t(`block_${c.blocker}` as Parameters<ArenaT>[0])}</p>
      ) : (
        <div>
          <button type="button" className="button button-primary" disabled={action.isPending} onClick={() => action.mutate({ action: "accept", id: c.id }, { onError: (e) => onError(errorCode(e)) })}>
            {t("accept_btn")}
          </button>
        </div>
      )}
    </article>
  );
}

export function Open({ state, ...props }: { state: ArenaState } & Props) {
  const now = Date.parse(state.now);
  return (
    <section className="stack" aria-labelledby="open-title">
      <div>
        <h2 id="open-title">{props.t("open_title")}</h2>
        <p className="muted small">{props.t("open_sub")}</p>
      </div>
      {state.open.length ? (
        state.open.map((c, i) => <FightCard key={c.id} c={c} i={i} count={state.open.length} me={state.me} now={now} {...props} />)
      ) : (
        <p className="muted">{props.t("open_empty")}</p>
      )}
    </section>
  );
}

export function Side({ state, t, rank, lang }: { state: ArenaState; lang: string } & Omit<Props, "onError">) {
  const now = Date.parse(state.now);
  const when = (iso: string) => new Date(iso).toLocaleString(localeOf(lang, ""), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const [statsFor, setStatsFor] = useState<number | null>(null);
  return (
    <div className="stack">
      {statsFor !== null && <MatchStats id={statsFor} t={t} onClose={() => setStatsFor(null)} />}
      <section className="card stack crown" aria-labelledby="crown-title">
        <h2 id="crown-title" className="icon-title"><Icon name="crown" size={18} />{t("crown")}</h2>
        {state.crown ? (
          <>
            <PairBlock pair={state.crown.pair} rank={rank} />
            <p className="muted small">{t("crown_held", { d: Math.max(0, Math.floor((now - Date.parse(state.crown.since)) / (24 * HOUR))), n: state.crown.defences })}</p>
            <p className="small">{t("crown_bounty")}</p>
          </>
        ) : (
          <>
            <strong>{t("crown_vacant")}</strong>
            <p className="muted small">{t("crown_vacant_body")}</p>
          </>
        )}
        {state.packLeader && (
          <p className="small"><strong>{t("pack_leader")}</strong> · {t("pack_leader_body", { name: state.packLeader.player.name, n: state.packLeader.games })}</p>
        )}
        {state.champion && (
          <p className="small">
            <strong>{t("champion", { key: state.champion.key.replace(/^(\d{4})-(Q\d)$/, "$2 $1") })}</strong> · {t("champion_body", { name: state.champion.player.name, wp: state.champion.wp })}
          </p>
        )}
      </section>
      <section className="card stack" aria-labelledby="feed-title">
        <h2 id="feed-title">{t("feed")}</h2>
        {state.feed.length ? (
          <ul className="rows feed">
            {state.feed.map((f, i) => (
              <li key={f.kind === "result" ? `r${f.id}` : `u${i}`} className="row">
                <span className="row-text">
                  {f.kind === "result" ? (
                    <span>
                      <strong>{pairTitle(f.winners)}</strong> {t("beat")} {pairTitle(f.losers)}{" "}
                      {f.retired ? t("retired_note") : f.scoreW != null && `${f.scoreW}–${f.scoreL}`}
                    </span>
                  ) : (
                    <span><strong>{f.player.name}</strong> {t("reached")} {rank(f.rank)}</span>
                  )}
                  <span className="muted small">
                    {when(f.at)}
                    {f.kind === "result" && f.stickers.map((s) => <span key={s} className="tag">{t(`st_${s}` as Parameters<ArenaT>[0])}</span>)}
                  </span>
                  {f.kind === "result" && f.hasStats && (
                    <span>
                      <button type="button" className="button button-small" aria-haspopup="dialog" onClick={() => setStatsFor(f.id)}>{t("stats_btn")}</button>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("feed_empty")}</p>
        )}
        {state.hot && <p className="small icon-line"><Icon name="flame" size={16} />{t("on_fire", { name: state.hot.player.name, n: state.hot.streak })}</p>}
      </section>
    </div>
  );
}
