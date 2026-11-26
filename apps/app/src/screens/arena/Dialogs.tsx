// The Arena's dialogs: entering a final score, the after-game card (points
// won, keep the pair, another challenge?) and a rank-up.
import { useEffect, useState, type CSSProperties } from "react";
import { isValidGameScore, nextRank, LADDER } from "@luvallplay/core/ranks";
import { errorCode, pairTitle, useArenaAction, type ArenaState, type Challenge } from "./data.ts";
import type { ArenaT } from "./words.ts";
import { Icon } from "../../components/Icon.tsx";
import { Dialog } from "../../components/Dialog.tsx";
export { Dialog };
import { RankIcon } from "../../components/RankIcon.tsx";
import { Confetti, CountUp, Meter, Rays, Sticker, buzz } from "../../components/Stage.tsx";

/** One side's score as a flip card: − and + flip the number over, as on a court's scoreboard. */
function Stepper({ label, name, value, onChange, side, winner }: { label: string; name: string; value: number; onChange: (n: number) => void; side: "you" | "them"; winner: string | null }) {
  const clamp = (n: number) => Math.max(0, Math.min(30, Number.isFinite(n) ? n : 0));
  // A flap with the new number turns down over the card when a button changes it (not while typing).
  const [flip, setFlip] = useState(0);
  const step = (d: number) => { onChange(clamp(value + d)); setFlip((f) => f + 1); };
  return (
    <div className={`stepper flip-card flip-${side}`}>
      <span className="stepper-label">{name}{winner && <Sticker className="winner-sticker">{winner}</Sticker>}</span>
      <div className="stepper-row">
        <button type="button" className="button" aria-label={`${label} −1`} onClick={() => step(-1)}>−</button>
        <span className="flip-face">
          <input aria-label={label} inputMode="numeric" value={value} onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, ""))))} />
          {flip > 0 && <span key={flip} className="flip-flap" aria-hidden="true">{value}</span>}
        </span>
        <button type="button" className="button" aria-label={`${label} +1`} onClick={() => step(1)}>+</button>
      </div>
    </div>
  );
}

export function ScoreEntry({ c, t, onClose, onError }: { c: Challenge; t: ArenaT; onClose: () => void; onError: (code: string) => void }) {
  const action = useArenaAction();
  const mine = c.mySide ?? "posting";
  const [ours, setOurs] = useState(21);
  const [theirs, setTheirs] = useState(0);
  const [retired, setRetired] = useState(false);
  const them = mine === "posting" ? c.accepting : c.posting;
  const us = mine === "posting" ? c.posting : c.accepting;
  const valid = isValidGameScore(ours, theirs);
  const send = (a: Parameters<typeof action.mutate>[0]) => action.mutate(a, { onSuccess: onClose, onError: (e) => onError(errorCode(e)) });
  const scores = mine === "posting" ? { posting: ours, accepting: theirs } : { posting: theirs, accepting: ours };
  return (
    <Dialog label={t("score_title")} onClose={onClose} className="score-dialog">
      <h2>{t("score_title")}</h2>
      <div className="score-grid">
        <Stepper
          label={`${us ? pairTitle(us) : ""}${ours > theirs && valid ? ` · ${t("winners")}` : ""}`}
          name={us ? pairTitle(us) : ""}
          side="you"
          winner={ours > theirs && valid ? t("winners") : null}
          value={ours}
          onChange={setOurs}
        />
        <Stepper
          label={`${them ? pairTitle(them) : ""}${theirs > ours && valid ? ` · ${t("winners")}` : ""}`}
          name={them ? pairTitle(them) : ""}
          side="them"
          winner={theirs > ours && valid ? t("winners") : null}
          value={theirs}
          onChange={setTheirs}
        />
      </div>
      <p className={`score-rules ${valid ? "score-ok" : "score-bad"}`} role="status">{valid ? t("score_valid") : t("score_invalid")} · {t("score_rules")}</p>
      <div className="actions">
        <button type="button" className="button button-primary" disabled={!valid || action.isPending} onClick={() => send({ action: "score", id: c.id, ...scores })}>
          {t("score_send", { names: them ? pairTitle(them) : "" })}
        </button>
        <button type="button" className="button button-quiet" onClick={onClose}>{t("cancel")}</button>
      </div>
      {!retired ? (
        <div><button type="button" className="button button-quiet" onClick={() => setRetired(true)}>{t("retired_q")}</button></div>
      ) : (
        <div className="actions">
          <button type="button" className="button" disabled={action.isPending} onClick={() => send({ action: "retired", id: c.id, retiredBy: mine })}>{t("retired_us")}</button>
          <button type="button" className="button" disabled={action.isPending} onClick={() => send({ action: "retired", id: c.id, retiredBy: mine === "posting" ? "accepting" : "posting" })}>{t("retired_them")}</button>
        </div>
      )}
    </Dialog>
  );
}

type After = NonNullable<ArenaState["me"]>["after"][number];
type IconName = Parameters<typeof Icon>[0]["name"];
const BONUS_ICON: Record<string, IconName> = { pts_gk: "bolt", pts_nr: "sparkles", pts_hs: "flame", pts_cb: "crown" };

export function AfterGame({ a, me, t, rank, onError }: { a: After; me: NonNullable<ArenaState["me"]>; t: ArenaT; rank: (i: number) => string; onError: (code: string) => void }) {
  const action = useArenaAction();
  const [keep, setKeep] = useState<boolean | null>(null);
  const [again, setAgain] = useState<boolean | null>(null);
  const next = nextRank(me.rank.shown);
  const ready = keep === false || (keep === true && again !== null);
  const parts: [string, number][] = [["pts_gk", a.giantKiller], ["pts_nr", a.newRival], ["pts_hs", a.hotStreak], ["pts_cb", a.crownBounty]];
  useEffect(() => {
    if (a.won) buzz();
  }, [a.won]);
  const bonuses = [["pts_win", a.base, "check"], ...parts.map(([k, n]) => [k, n, BONUS_ICON[k]])].filter(([, n]) => (n as number) > 0) as [string, number, IconName][];
  return (
    <Dialog label={a.won ? t("victory") : t("good_game")} onClose={() => undefined} className={`moment ${a.won ? "moment-win" : "moment-gg"}`}>
      <div className="moment-head">
        {a.won && <Rays />}
        {a.won && <Confetti />}
        <p className="moment-kicker">{a.retired ? t("retired_note") : `${a.scoreFor ?? 0}–${a.scoreAgainst ?? 0}`} · {pairTitle(a.opponents)}</p>
        <h2 className="moment-title pop">{a.won ? t("victory") : t("good_game")}</h2>
        {a.won ? (
          <CountUp className="moment-points" prefix="+" value={a.total} suffix=" WP" />
        ) : (
          <p className="moment-sub">{t("gg_body")}</p>
        )}
      </div>
      {a.won && (
        <ul className="bonus-list" aria-label={t("victory")}>
          {bonuses.map(([k, n, icon], i) => (
            <li key={k} className="bonus enter" style={{ "--i": i + 4 } as CSSProperties}>
              <Icon name={icon} size={16} />
              {t(k as Parameters<ArenaT>[0], { n })}
            </li>
          ))}
        </ul>
      )}
      <div className="rank-progress">
        <RankIcon index={me.rank.shown} px={48} />
        <div className="rank-progress-text">
          <strong>{rank(me.rank.shown)}</strong>
          <Meter value={me.rank.progress} label={rank(me.rank.shown)} />
          <span className="muted small">{next ? t("to_next", { n: Math.max(0, next.wp - me.rank.wpTotal), rank: rank(LADDER.indexOf(next)) }) : t("top")}</span>
        </div>
      </div>
      <fieldset className="stack">
        <legend>{t("keep_q")}</legend>
        <div className="actions">
          <label className="choice"><input type="radio" name="keep" checked={keep === true} onChange={() => setKeep(true)} /><span>{t("keep_yes")}</span></label>
          <label className="choice"><input type="radio" name="keep" checked={keep === false} onChange={() => setKeep(false)} /><span>{t("keep_no")}</span></label>
        </div>
      </fieldset>
      {keep !== false && (
        <fieldset className="stack">
          <legend>{t("again_q")}</legend>
          <div className="actions">
            <label className="choice"><input type="radio" name="again" checked={again === true} onChange={() => setAgain(true)} /><span>{t("again_yes")}</span></label>
            <label className="choice"><input type="radio" name="again" checked={again === false} onChange={() => setAgain(false)} /><span>{t("again_no")}</span></label>
          </div>
        </fieldset>
      )}
      <div className="moment-actions">
        <button
          type="button"
          className="button button-accent"
          disabled={!ready || action.isPending}
          onClick={() => action.mutate({ action: "after", id: a.challengeId, keep: !!keep, again: !!keep && !!again }, { onError: (e) => onError(errorCode(e)) })}
        >
          {t("done")}
        </button>
      </div>
    </Dialog>
  );
}

export function RankUp({ from, to, t, rank, onError }: { from: number; to: number; t: ArenaT; rank: (i: number) => string; onError: (code: string) => void }) {
  const action = useArenaAction();
  const [hidden, setHidden] = useState(false);
  useEffect(() => buzz(), []);
  if (hidden) return null;
  const share = async () => {
    try {
      await navigator.share?.({ title: t("rankup"), text: `${t("rankup_body")} ${rank(to)}` });
    } catch {
      // Closed the share sheet.
    }
  };
  return (
    <Dialog label={t("rankup")} onClose={() => undefined} className="moment moment-rankup">
      <div className="moment-head">
        <Rays />
        <Confetti />
        <p className="moment-kicker icon-line"><Icon name="rankUp" size={16} />{t("rankup")}</p>
        <span className="rankup-art pop"><RankIcon index={to} px={160} /></span>
        <p className="moment-sub">{t("rankup_body")}</p>
        <h2 className="moment-title">{rank(to)}</h2>
        {from !== to && (
          <p className="rankup-from icon-line">
            <RankIcon index={from} px={28} />
            <span className="muted small">{rank(from)}</span>
            <Icon name="arrowRight" size={16} />
            <RankIcon index={to} px={28} />
          </p>
        )}
      </div>
      <div className="actions moment-actions">
        <button type="button" className="button button-accent" onClick={() => { setHidden(true); action.mutate({ action: "rank_seen" }, { onError: (e) => onError(errorCode(e)) }); }}>{t("nice")}</button>
        {"share" in navigator && <button type="button" className="button" onClick={() => void share()}>{t("share")}</button>}
      </div>
    </Dialog>
  );
}
