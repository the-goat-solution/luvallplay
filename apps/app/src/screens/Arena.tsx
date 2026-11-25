// The Arena tab, as on the website: pair up, throw down challenges, take
// others on, play, enter and confirm scores, and see the crown and the feed.
// The board refreshes every 5 seconds while the tab is on screen. A game
// you're in that was just accepted opens with the "versus" splash.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useArena, useArenaAction, errorCode, type Challenge } from "./arena/data.ts";
import { useArenaT } from "./arena/words.ts";
import { Live, Mine, Open, PairPanel, Requests, Side } from "./arena/Board.tsx";
import { TeamUp } from "./arena/TeamUp.tsx";
import { AfterGame, RankUp, ScoreEntry } from "./arena/Dialogs.tsx";
import { Versus, VersusPill, useVersus } from "./arena/Versus.tsx";
import { LoadError } from "../components/LoadError.tsx";

export default function ArenaScreen() {
  const { t, rank, lang } = useArenaT();
  const arena = useArena();
  const action = useArenaAction();
  const navigate = useNavigate();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [scoring, setScoring] = useState<Challenge | null>(null);
  const timer = useRef(0);
  const state = arena.data;
  const versus = useVersus(state);

  const toast = (ok: boolean, text: string) => {
    setMessage({ ok, text });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 4200);
  };
  /** The Arena's words for a refused action (err_<code>), or the generic line for a code it has no words for. */
  const onError = (code: string) => {
    const key = `err_${code}` as Parameters<typeof t>[0];
    const text = t(key, { n: state?.minGameMinutes ?? 0 });
    toast(false, text === key ? t("err_generic") : text);
  };

  // An invite link (/arena?join=<code>) pairs you with whoever made it.
  const joined = useRef(false);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("join");
    if (!code || joined.current || !state) return;
    joined.current = true;
    void navigate({ to: "/arena", replace: true });
    if (!/^\d{12}$/.test(code)) return onError("bad_code");
    if (state.me?.pair && !window.confirm(t("replaces_pair"))) return;
    action.mutate({ action: "pair_join", code }, { onSuccess: () => toast(true, t("joined")), onError: (e) => onError(errorCode(e)) });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // From a player's card (/arena?vs=<player id>): their open challenge, or a hint to post one they can accept.
  const vsRan = useRef(false);
  useEffect(() => {
    const vs = Number(new URLSearchParams(window.location.search).get("vs"));
    if (!vs || vsRan.current || !state) return;
    vsRan.current = true;
    void navigate({ to: "/arena", replace: true });
    const theirs = state.open.find((c) => c.posting.players.some((p) => p.id === vs));
    requestAnimationFrame(() => document.getElementById(theirs ? `challenge-${theirs.id}` : "arena-me")?.scrollIntoView({ block: "center" }));
    if (!theirs) toast(true, t("vs_hint"));
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) {
    return (
      <div className="screen arena" data-screen="nav_arena" data-state={arena.isError ? "error" : "loading"}>
        <header className="arena-hero"><h1>{t("title")}</h1></header>
        {arena.isError ? (
          <LoadError onRetry={() => void arena.refetch()} />
        ) : (
          <div className="skeleton skeleton-tall" aria-busy="true" />
        )}
      </div>
    );
  }

  const me = state.me;
  const count = (n: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0]) => `${n} ${t(n === 1 ? one : many)}`;
  const after = me?.after[0];
  return (
    <div className="screen arena" data-screen="nav_arena" data-state="ready">
      <header className="arena-hero stack-tight">
        <p className="muted small">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p className="lead">{t("tag1")} {t("tag2")} {t("tag3")}</p>
        <p className="chips">
          <span className="pill">{count(state.counts.up, "stat_up_1", "stat_up")}</span>
          <span className="pill">{state.counts.live} {t("stat_live")}</span>
          <span className="pill">{count(state.counts.week, "stat_week_1", "stat_week")}</span>
        </p>
        {state.sandbox && <p className="notice">{t("sandbox")}</p>}
      </header>
      {versus.show && <Versus c={versus.show} t={t} onGo={() => versus.go(versus.show!.id)} onLater={() => versus.putOff(versus.show!.id)} />}
      {versus.later && <VersusPill c={versus.later} t={t} onOpen={() => versus.reopen(versus.later!.id)} />}
      <div aria-live="polite" className="toast-area">
        {message && <p className={`notice${message.ok ? "" : " notice-error"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      </div>
      <div className="me-grid">
        <div className="stack">
          {me && (me.incomingRequest || (!me.pair && me.outgoingRequest)) ? (
            <Requests me={me} t={t} onError={onError} />
          ) : me?.pair ? (
            <PairPanel me={me} state={state} t={t} rank={rank} onError={onError} lang={lang} />
          ) : (
            me && <TeamUp t={t} onError={onError} onJoined={() => toast(true, t("joined"))} />
          )}
          <Mine state={state} t={t} rank={rank} onError={onError} onScore={setScoring} />
          <Live state={state} t={t} rank={rank} />
          <Open state={state} t={t} rank={rank} onError={onError} />
        </div>
        <Side state={state} t={t} rank={rank} lang={lang} />
      </div>
      {scoring ? (
        <ScoreEntry c={scoring} t={t} onClose={() => setScoring(null)} onError={onError} />
      ) : after && me ? (
        <AfterGame key={after.challengeId} a={after} me={me} t={t} rank={rank} onError={onError} />
      ) : me?.rankUp ? (
        <RankUp to={me.rankUp.to} t={t} rank={rank} onError={onError} />
      ) : null}
    </div>
  );
}
