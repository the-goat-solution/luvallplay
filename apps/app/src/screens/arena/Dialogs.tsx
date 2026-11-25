// The Arena's dialogs: entering a final score, the after-game card (points
// won, keep the pair, another challenge?) and a rank-up.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isValidGameScore, nextRank, LADDER } from "@luvallplay/core/ranks";
import { errorCode, pairTitle, useArenaAction, type ArenaState, type Challenge } from "./data.ts";
import type { ArenaT } from "./words.ts";

/** A modal <dialog> that opens with its content and closes with Escape. */
export function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className="dialog" aria-label={label} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="stack">{children}</div>
    </dialog>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.max(0, Math.min(30, Number.isFinite(n) ? n : 0));
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-row">
        <button type="button" className="button" aria-label={`${label} −1`} onClick={() => onChange(clamp(value - 1))}>−</button>
        <input aria-label={label} inputMode="numeric" value={value} onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, ""))))} />
        <button type="button" className="button" aria-label={`${label} +1`} onClick={() => onChange(clamp(value + 1))}>+</button>
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
    <Dialog label={t("score_title")} onClose={onClose}>
      <h2>{t("score_title")}</h2>
      <div className="score-grid">
        <Stepper label={`${us ? pairTitle(us) : ""}${ours > theirs && valid ? ` · ${t("winners")}` : ""}`} value={ours} onChange={setOurs} />
        <Stepper label={`${them ? pairTitle(them) : ""}${theirs > ours && valid ? ` · ${t("winners")}` : ""}`} value={theirs} onChange={setTheirs} />
      </div>
      <p className={valid ? "small" : "small notice-error"} role="status">{valid ? t("score_valid") : t("score_invalid")} · {t("score_rules")}</p>
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

export function AfterGame({ a, me, t, rank, onError }: { a: After; me: NonNullable<ArenaState["me"]>; t: ArenaT; rank: (i: number) => string; onError: (code: string) => void }) {
  const action = useArenaAction();
  const [keep, setKeep] = useState<boolean | null>(null);
  const [again, setAgain] = useState<boolean | null>(null);
  const next = nextRank(me.rank.shown);
  const ready = keep === false || (keep === true && again !== null);
  const parts: [string, number][] = [["pts_gk", a.giantKiller], ["pts_nr", a.newRival], ["pts_hs", a.hotStreak], ["pts_cb", a.crownBounty]];
  return (
    <Dialog label={a.won ? t("victory") : t("good_game")} onClose={() => undefined}>
      <h2>{a.won ? `🏆 ${t("victory")}` : t("good_game")}</h2>
      <p className="score-big">{a.retired ? t("retired_note") : `${a.scoreFor ?? 0}–${a.scoreAgainst ?? 0}`} · {pairTitle(a.opponents)}</p>
      {a.won ? (
        <>
          <p className="score-big">+{a.total} WP</p>
          <p className="muted small">
            {t("pts_win", { n: a.base })}
            {parts.filter(([, n]) => n > 0).map(([k, n]) => ` · ${t(k as Parameters<ArenaT>[0], { n })}`).join("")}
          </p>
        </>
      ) : (
        <p className="muted">{t("gg_body")}</p>
      )}
      <div className="stack-tight">
        <strong>{rank(me.rank.shown)}</strong>
        <progress max={1} value={me.rank.progress} aria-label={rank(me.rank.shown)} />
        <span className="muted small">{next ? t("to_next", { n: Math.max(0, next.wp - me.rank.wpTotal), rank: rank(LADDER.indexOf(next)) }) : t("top")}</span>
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
      <div>
        <button
          type="button"
          className="button button-primary"
          disabled={!ready || action.isPending}
          onClick={() => action.mutate({ action: "after", id: a.challengeId, keep: !!keep, again: !!keep && !!again }, { onError: (e) => onError(errorCode(e)) })}
        >
          {t("done")}
        </button>
      </div>
    </Dialog>
  );
}

export function RankUp({ to, t, rank, onError }: { to: number; t: ArenaT; rank: (i: number) => string; onError: (code: string) => void }) {
  const action = useArenaAction();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const share = async () => {
    try {
      await navigator.share?.({ title: t("rankup"), text: `${t("rankup_body")} ${rank(to)}` });
    } catch {
      // Closed the share sheet.
    }
  };
  return (
    <Dialog label={t("rankup")} onClose={() => undefined}>
      <h2>⬆️ {t("rankup")}</h2>
      <p>{t("rankup_body")}</p>
      <p className="score-big">{rank(to)}</p>
      <div className="actions">
        <button type="button" className="button button-primary" onClick={() => { setHidden(true); action.mutate({ action: "rank_seen" }, { onError: (e) => onError(errorCode(e)) }); }}>{t("nice")}</button>
        {"share" in navigator && <button type="button" className="button" onClick={() => void share()}>{t("share")}</button>}
      </div>
    </Dialog>
  );
}
