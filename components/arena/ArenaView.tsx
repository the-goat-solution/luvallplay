"use client";
import { isTrial } from "@/lib/wolf-vision-trial";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useArenaT, type ArenaKey } from "@/lib/arena-i18n";
import {
  LADDER,
  LEAGUES,
  isValidGameScore,
  nextRank,
  rankName,
} from "@/lib/ranks";
import type {
  AfterGame,
  ArenaState,
  ChallengeView,
  FeedItem,
  PairView,
  PlayerChip,
} from "@/lib/arena-state";
import { MatchStatsModal } from "./MatchStatsModal";
import { BonusIcon, RankIcon } from "./RankIcon";
import s from "./arena.module.css";

type Tone = "c" | "t" | "y";
type Screen =
  | { kind: "checkinShow"; id: number; code: string; expiresAt: string }
  | { kind: "checkinEnter"; id: number }
  | { kind: "score"; id: number }
  | null;

const VS_SEEN_KEY = "tw-arena-vs-seen";
/** Matches whose "Let's go" screen is minimized (the profile shows a pill to reopen it). */
export const VS_MIN_KEY = "tw-arena-vs-min";

function readIds(key: string): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
}
function writeIds(key: string, ids: number[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(-50)));
    window.dispatchEvent(new Event("tw-arena-vs"));
  } catch {
    // private mode
  }
}

// ── Small pieces ──────────────────────────────────────────────────────

function Avatar({
  p,
  tone,
  size = "md",
}: {
  p: PlayerChip;
  tone: Tone;
  size?: "sm" | "md" | "lg";
}) {
  const cls = `${s.av} ${tone === "c" ? s.avC : tone === "t" ? s.avT : s.avY} ${size === "sm" ? s.avSm : size === "lg" ? s.avLg : ""}`;
  const badge = size === "lg" ? 28 : size === "sm" ? 18 : 22;
  return (
    <div className={cls}>
      {p.initials}
      <span className={`${s.avBadge} ${p.tarnishing ? s.tarnish : ""}`}>
        <RankIcon
          index={p.rank}
          seat={p.seat}
          px={badge}
          tarnished={p.tarnishing}
        />
      </span>
    </div>
  );
}

function Duo({
  pair,
  tone,
  size,
}: {
  pair: PairView;
  tone: Tone;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className={s.duo}>
      <Avatar p={pair.players[0]} tone={tone} size={size} />
      <Avatar p={pair.players[1]} tone={tone} size={size} />
    </div>
  );
}

const pairNames = (p: PairView) =>
  `${p.players[0].name} & ${p.players[1].name}`;
const pairTitle = (p: PairView) => p.name || pairNames(p);
const firstNames = (p: PairView, joiner: string) =>
  `${p.players[0].name.split(" ")[0]} ${joiner} ${p.players[1].name.split(" ")[0]}`;

function rankLine(index: number, lang: "en" | "vi"): string {
  return rankName(LADDER[index], lang);
}

function useCountdown(expiresAt: string | null): number {
  const [left, setLeft] = useState(() =>
    expiresAt ? Math.max(0, Date.parse(expiresAt) - Date.now()) : 0,
  );
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setLeft(Math.max(0, Date.parse(expiresAt) - Date.now()));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

const mmss = (ms: number) => {
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

function CodeTiles({ code }: { code: string }) {
  return (
    <div className={s.tiles} aria-label={code.split("").join(" ")}>
      {code.split("").map((d, i) => (
        <div
          key={i}
          className={`${s.tile} ${i === 2 ? s.tileGap : ""}`}
          aria-hidden="true"
        >
          {d}
        </div>
      ))}
    </div>
  );
}

function Ring({ ms, total }: { ms: number; total: number }) {
  const pct = Math.max(0, Math.min(100, (ms / total) * 100));
  return (
    <div
      className={s.ring}
      style={{
        background: `conic-gradient(#2fd4b5 0 ${pct}%, rgba(255,255,255,.1) ${pct}% 100%)`,
      }}
    >
      <div>{mmss(ms)}</div>
    </div>
  );
}

function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 9) * 0.12,
        color: ["#ff6b57", "#2fd4b5", "#ffd54a", "#e2ae60", "#fff"][i % 5],
        rot: (i * 53) % 180,
      })),
    [],
  );
  return (
    <div className={s.confetti} aria-hidden="true">
      {bits.map((b, i) => (
        <i
          key={i}
          style={{
            left: `${b.left}%`,
            background: b.color,
            animationDelay: `${b.delay}s`,
            transform: `rotate(${b.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}

// ── The page ──────────────────────────────────────────────────────────

export function ArenaView({ initial, embedded = false }: { initial: ArenaState; embedded?: boolean }) {
  const { t, lang } = useArenaT();
  const [state, setState] = useState<ArenaState>(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(null);
  const [vsSeen, setVsSeen] = useState<number[]>([]);
  const [vsMin, setVsMin] = useState<number[]>([]);
  const [rankDismissed, setRankDismissed] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setVsSeen(readIds(VS_SEEN_KEY));
    setVsMin(readIds(VS_MIN_KEY));
    const sync = () => setVsMin(readIds(VS_MIN_KEY));
    window.addEventListener("tw-arena-vs", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("tw-arena-vs", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const errorText = useCallback(
    (code: string) => {
      const key = `err_${code}` as ArenaKey;
      try {
        const text = t(key, { n: state.minGameMinutes });
        return text && text !== key ? text : t("err_generic");
      } catch {
        return t("err_generic");
      }
    },
    [t, state.minGameMinutes],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/arena", { cache: "no-store" });
      if (res.ok) setState(await res.json());
    } catch {
      // offline: keep the last snapshot
    }
  }, []);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      id = setInterval(() => {
        if (document.visibilityState === "visible") refresh();
      }, 5000);
    };
    start();
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (id) clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const act = useCallback(
    async (
      body: Record<string, unknown>,
    ): Promise<{
      ok: boolean;
      code?: { code: string; expiresAt: string } | null;
      error?: string;
    }> => {
      setBusy(true);
      try {
        const res = await fetch("/api/arena", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (json.state) setState(json.state);
        if (!res.ok) {
          const code =
            res.status === 401 ? "signed_out" : json.error || "generic";
          showToast(errorText(code));
          return { ok: false, error: code };
        }
        return { ok: true, code: json.code ?? null };
      } catch {
        showToast(t("err_generic"));
        return { ok: false, error: "network" };
      } finally {
        setBusy(false);
      }
    },
    [errorText, showToast, t],
  );

  // Opened from an invite link (?join=<code>): pair up straight away.
  const joinRan = useRef(false);
  useEffect(() => {
    if (joinRan.current) return;
    const url = new URL(window.location.href);
    const joinCode = url.searchParams.get("join");
    if (!joinCode) return;
    joinRan.current = true;
    url.searchParams.delete("join");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (!initial.me) return;
    if (initial.me.pair && !confirm(t("replaces_pair"))) return;
    void act({ action: "pair_join", code: joinCode }).then((r) => {
      if (r.ok) showToast(t("joined"));
    });
  }, [act, initial.me, showToast, t]);

  const me = state.me;
  const mine = state.mine;
  const versusPending = mine.find(
    (c) => c.status === "accepted" && c.accepting && !vsSeen.includes(c.id),
  );
  const versusFor = versusPending && !vsMin.includes(versusPending.id) ? versusPending : undefined;
  const versusMinimized = versusPending && vsMin.includes(versusPending.id) ? versusPending : undefined;
  const after = me?.after[0] ?? null;
  const rankUp = me?.rankUp && !rankDismissed ? me.rankUp : null;

  const dismissVs = (id: number) => {
    const next = [...vsSeen, id].slice(-50);
    setVsSeen(next);
    writeIds(VS_SEEN_KEY, next);
    const min = vsMin.filter((x) => x !== id);
    setVsMin(min);
    writeIds(VS_MIN_KEY, min);
  };
  const minimizeVs = (id: number, minimized: boolean) => {
    const next = minimized ? [...vsMin.filter((x) => x !== id), id] : vsMin.filter((x) => x !== id);
    setVsMin(next);
    writeIds(VS_MIN_KEY, next);
  };

  let overlay: ReactNode = null;
  if (screen?.kind === "checkinShow") {
    const c = mine.find((x) => x.id === screen.id);
    if (c && c.status === "accepted")
      overlay = (
        <CheckinShow
          c={c}
          code={screen.code}
          expiresAt={screen.expiresAt}
          onNew={async () => {
            const r = await act({ action: "checkin_code", id: c.id });
            if (r.ok && r.code)
              setScreen({
                kind: "checkinShow",
                id: c.id,
                code: r.code.code,
                expiresAt: r.code.expiresAt,
              });
          }}
          onClose={() => setScreen(null)}
        />
      );
  } else if (screen?.kind === "checkinEnter") {
    const c = mine.find((x) => x.id === screen.id);
    if (c && c.status === "accepted")
      overlay = (
        <CheckinEnter
          c={c}
          busy={busy}
          onSubmit={async (code) => {
            const r = await act({ action: "checkin", id: c.id, code });
            if (r.ok) setScreen(null);
          }}
          onClose={() => setScreen(null)}
        />
      );
  } else if (screen?.kind === "score") {
    const c = mine.find((x) => x.id === screen.id);
    if (c && c.status === "live")
      overlay = (
        <ScoreEntry
          c={c}
          busy={busy}
          minMinutes={state.minGameMinutes}
          onSubmit={async (body) => {
            const r = await act({ id: c.id, ...body });
            if (r.ok) setScreen(null);
          }}
          onClose={() => setScreen(null)}
        />
      );
  }
  if (!overlay && versusFor)
    overlay = <Versus c={versusFor} onGo={() => dismissVs(versusFor.id)} onMinimize={() => minimizeVs(versusFor.id, true)} />;
  if (!overlay && after)
    overlay = (
      <Result
        g={after}
        me={me!}
        busy={busy}
        onDone={(keep, again) =>
          act({ action: "after", id: after.challengeId, keep, again })
        }
      />
    );
  if (!overlay && rankUp)
    overlay = (
      <RankUp
        to={rankUp.to}
        onDone={async () => {
          setRankDismissed(true);
          await act({ action: "rank_seen" });
          setRankDismissed(false);
        }}
      />
    );

  return (
    <main className={`${s.page} ${embedded ? s.embedded : ""}`}>
      <div className={s.wrap}>
        <Hero state={state} />
        <div className={s.grid}>
          <div className={s.col}>
            <section className={s.aMe}>
              <MePanel state={state} busy={busy} act={act} />
            </section>
            {mine.length > 0 && (
              <section className={s.aMine}>
                <h2 className={s.h2}>{t("mine")}</h2>
                {mine.map((c) => (
                  <MyChallenge
                    key={c.id}
                    c={c}
                    busy={busy}
                    act={act}
                    minMinutes={state.minGameMinutes}
                    onCheckinShow={async () => {
                      const r = await act({ action: "checkin_code", id: c.id });
                      if (r.ok && r.code)
                        setScreen({
                          kind: "checkinShow",
                          id: c.id,
                          code: r.code.code,
                          expiresAt: r.code.expiresAt,
                        });
                    }}
                    onCheckinEnter={() =>
                      setScreen({ kind: "checkinEnter", id: c.id })
                    }
                    onScore={() => setScreen({ kind: "score", id: c.id })}
                  />
                ))}
              </section>
            )}
            <section className={s.aLive}>
              <h2 className={s.h2}>
                <span className={s.dot} />
                {t("live_now")} <small>{state.live.length}</small>
              </h2>
              {state.live.length === 0 ? (
                <p className={s.empty}>{t("live_empty")}</p>
              ) : (
                state.live.map((c) => <LiveCard key={c.id} c={c} signedIn={state.signedIn} />)
              )}
            </section>
            <section className={s.aOpen}>
              <h2 className={s.h2}>
                {t("open_title")} <small>{t("open_sub")}</small>
              </h2>
              {state.open.length === 0 ? (
                <p className={s.empty}>{t("open_empty")}</p>
              ) : (
                state.open.map((c, i) => (
                  <FightCard
                    key={c.id}
                    c={c}
                    hot={i === 0 && state.open.length > 2}
                    me={state.me}
                    busy={busy}
                    act={act}
                  />
                ))
              )}
            </section>
          </div>
          <div className={s.col}>
            <section className={s.aCrown}>
              <CrownCard state={state} />
            </section>
            <section className={s.aFeed}>
              <h2 className={s.h2}>{t("feed")}</h2>
              <Feed items={state.feed} lang={lang} signedIn={state.signedIn} />
              {state.hot && (
                <div className={s.fire}>
                  <BonusIcon kind="hot-streak" px={28} />
                  <div>
                    {t("on_fire", {
                      name: state.hot.player.name,
                      n: state.hot.streak,
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
      {overlay && (
        <div className={s.overlay} role="dialog" aria-modal="true">
          {overlay}
        </div>
      )}
      {versusMinimized && !overlay && versusMinimized.accepting && (
        <button type="button" className={s.vsMini} onClick={() => minimizeVs(versusMinimized.id, false)}>
          <span className={s.vsMiniVs}>{t("vs")}</span>
          <span className={s.vsMiniText}>
            <strong>{t("vs_accepted")}</strong>
            <small>
              {pairTitle(versusMinimized.posting)} · {pairTitle(versusMinimized.accepting)}
            </small>
          </span>
          <span className={s.vsMiniOpen}>{t("vs_open")}</span>
        </button>
      )}
      {toast && (
        <div className={s.toast} role="status">
          {toast}
        </div>
      )}
    </main>
  );
}

// ── Sections ──────────────────────────────────────────────────────────

function Hero({ state }: { state: ArenaState }) {
  const { t } = useArenaT();
  return (
    <header className={s.hero}>
      <svg
        className={s.court}
        viewBox="0 0 560 220"
        fill="none"
        stroke="rgba(255,255,255,.18)"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path d="M150 30H410L520 210H40Z" />
        <path d="M175 30L80 210M385 30L480 210" />
        <path d="M118 82H442M95 120H465" />
        <path d="M280 30V82M280 120V210" />
        <path d="M60 178H500" />
        <path
          d="M100 116H460"
          stroke="rgba(255,255,255,.4)"
          strokeWidth="2.5"
          strokeDasharray="3 4"
        />
      </svg>
      <div className={s.eyebrow} style={{ position: "relative" }}>
        {t("eyebrow")}
      </div>
      <h1 className={s.title}>{t("title")}</h1>
      <p className={s.tag}>
        {t("tag1")} <b>{t("tag2")}</b> <i>{t("tag3")}</i>
      </p>
      <div className={s.stats}>
        <span className={`${s.stat} ${s.statUp}`}>
          <b>{state.counts.up}</b>
          {t(state.counts.up === 1 ? "stat_up_1" : "stat_up")}
        </span>
        <span className={`${s.stat} ${s.statLive}`}>
          <b>{state.counts.live}</b>
          {t("stat_live")}
        </span>
        <span className={`${s.stat} ${s.statWeek}`}>
          <b>{state.counts.week}</b>
          {t(state.counts.week === 1 ? "stat_week_1" : "stat_week")}
        </span>
      </div>
      {state.sandbox && <p className={s.sandbox}>{t("sandbox")}</p>}
    </header>
  );
}

type Act = (
  body: Record<string, unknown>,
) => Promise<{
  ok: boolean;
  code?: { code: string; expiresAt: string } | null;
  error?: string;
}>;

function MePanel({
  state,
  busy,
  act,
}: {
  state: ArenaState;
  busy: boolean;
  act: Act;
}) {
  const { t } = useArenaT();
  const me = state.me;
  if (!state.signedIn || !me) {
    return (
      <div className={s.panel}>
        <div className={s.panelTitle}>{t("signin_title")}</div>
        <p className={s.muted} style={{ marginTop: 6 }}>
          {t("signin_body")}
        </p>
        <a
          className={`${s.cta} ${s.ctaBounce}`}
          href="/login?next=/profile/arena"
          style={{ textDecoration: "none" }}
        >
          <span>{t("signin_btn")}</span>
        </a>
      </div>
    );
  }
  if (me.incomingRequest) {
    return (
      <div className={s.panel}>
        <div className={s.row}>
          <Avatar p={me.incomingRequest} tone="t" size="lg" />
          <div>
            <div className={s.panelTitle} style={{ fontSize: 17 }}>
              {t("request_in", { name: me.incomingRequest.name })}
            </div>
            <p className={s.muted}>{t("request_in_body")}</p>
          </div>
        </div>
        {me.pair && (
          <p className={s.muted} style={{ marginTop: 8 }}>
            {t("replaces_pair")}
          </p>
        )}
        <div className={s.yn} style={{ marginTop: 14, display: "grid" }}>
          <button
            className={`${s.btn} ${s.btnTeal}`}
            disabled={busy}
            onClick={() => act({ action: "pair_respond", accept: true })}
          >
            {t("accept")}
          </button>
          <button
            className={`${s.btn} ${s.btnGhost}`}
            disabled={busy}
            onClick={() => act({ action: "pair_respond", accept: false })}
          >
            {t("decline")}
          </button>
        </div>
      </div>
    );
  }
  if (!me.pair) return <TeamUp state={state} busy={busy} act={act} />;
  return <PairPanel state={state} busy={busy} act={act} />;
}

function TeamUp({
  state,
  busy,
  act,
}: {
  state: ArenaState;
  busy: boolean;
  act: Act;
}) {
  const { t } = useArenaT();
  const [mode, setMode] = useState<"show" | "enter" | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(
    null,
  );
  const [typed, setTyped] = useState("");
  const left = useCountdown(code?.expiresAt ?? null);
  const me = state.me!;

  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const makeInvite = async () => {
    const r = await act({ action: "pair_invite" });
    if (r.ok && r.code) {
      const url = `${window.location.origin}/profile/arena?join=${r.code.code}`;
      setInvite(url);
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ text: t("invite_text"), url });
        } catch {
          // dismissed: the link stays on screen
        }
      }
    }
  };
  const copyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
    } catch {
      // ignore
    }
  };

  const show = async () => {
    setMode("show");
    const r = await act({ action: "pair_code" });
    if (r.ok && r.code) setCode(r.code);
  };

  if (me.outgoingRequest) {
    return (
      <div className={s.panel}>
        <div className={s.panelTitle}>{t("team_title")}</div>
        <div className={s.row} style={{ marginTop: 12 }}>
          <Avatar p={me.outgoingRequest} tone="t" />
          <p className={s.muted}>
            {t("request_out", { name: me.outgoingRequest.name })}
          </p>
        </div>
        <button
          className={s.link}
          onClick={() => act({ action: "pair_cancel" })}
        >
          {t("cancel")}
        </button>
      </div>
    );
  }

  return (
    <div className={s.panel}>
      <div className={s.panelTitle}>{t("team_title")}</div>
      <p className={s.muted} style={{ marginTop: 4 }}>
        {t("team_body")}
      </p>
      {mode === "show" && code ? (
        <>
          <CodeTiles code={code.code} />
          {left > 0 ? (
            <p className={s.hint}>{t("code_expires", { s: mmss(left) })}</p>
          ) : (
            <p className={s.hint}>{t("code_expired")}</p>
          )}
          <div
            className={s.row}
            style={{ justifyContent: "center", marginTop: 6 }}
          >
            <button
              className={`${s.btn} ${s.btnGhost}`}
              disabled={busy}
              onClick={show}
            >
              {t("new_code")}
            </button>
            <button className={s.link} onClick={() => setMode(null)}>
              {t("cancel")}
            </button>
          </div>
        </>
      ) : mode === "enter" ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act({ action: "pair_enter", code: typed });
            if (r.ok) setMode(null);
          }}
        >
          <label className={s.label} htmlFor="pair-code">
            {t("code_label")}
          </label>
          <input
            id="pair-code"
            className={s.codeInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={5}
            value={typed}
            onChange={(e) =>
              setTyped(e.target.value.replace(/\D/g, "").slice(0, 5))
            }
            autoFocus
          />
          <p className={s.hint}>{t("code_hint")}</p>
          <button
            className={s.cta}
            disabled={busy || typed.length !== 5}
            type="submit"
          >
            <span>{t("team_btn")}</span>
          </button>
          <button
            type="button"
            className={s.link}
            onClick={() => setMode(null)}
          >
            {t("cancel")}
          </button>
        </form>
      ) : invite ? (
        <>
          <p className={s.hint}>{t("invite_ready")}</p>
          <input
            className={s.field}
            readOnly
            value={invite}
            onFocus={(e) => e.target.select()}
            aria-label={t("invite_btn")}
          />
          <div
            className={s.row}
            style={{ justifyContent: "center", marginTop: 8 }}
          >
            <button
              className={`${s.btn} ${s.btnYellow}`}
              disabled={busy}
              onClick={makeInvite}
            >
              {t("invite_share")}
            </button>
            <button
              className={`${s.btn} ${s.btnGhost}`}
              onClick={copyInvite}
            >
              {copied ? t("invite_copied") : t("invite_copy")}
            </button>
          </div>
          <button className={s.link} onClick={() => setInvite(null)}>
            {t("cancel")}
          </button>
        </>
      ) : (
        <div className={s.yn} style={{ display: "grid", marginTop: 14 }}>
          <button
            className={`${s.btn} ${s.btnYellow}`}
            disabled={busy}
            onClick={makeInvite}
          >
            {t("invite_btn")}
          </button>
          <button
            className={`${s.btn} ${s.btnGhost}`}
            disabled={busy}
            onClick={show}
          >
            {t("show_code")}
          </button>
          <button
            className={`${s.btn} ${s.btnTeal}`}
            disabled={busy}
            onClick={() => setMode("enter")}
          >
            {t("enter_code")}
          </button>
        </div>
      )}
    </div>
  );
}

function PairPanel({
  state,
  busy,
  act,
}: {
  state: ArenaState;
  busy: boolean;
  act: Act;
}) {
  const { t, lang } = useArenaT();
  const me = state.me!;
  const pair = me.pair!;
  const partner = pair.players.find((p) => p.id !== me.id) ?? pair.players[1];
  const myOpen = state.mine.find((c) => c.status === "open");
  const busyGame = state.mine.some((c) =>
    ["accepted", "live", "awaiting", "disputed"].includes(c.status),
  );
  const [composing, setComposing] = useState(false);
  const [days, setDays] = useState(3);
  const [note, setNote] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(pair.name ?? "");
  const mePlayer = pair.players.find((p) => p.id === me.id) ?? pair.players[0];

  return (
    <div className={s.panel}>
      <div className={s.mePair}>
        <div className={s.duo}>
          <Avatar p={mePlayer} tone="t" />
          <Avatar p={partner} tone="t" />
        </div>
        <div style={{ minWidth: 0 }}>
          <strong>
            {pair.name ? `${pair.name} · ` : ""}
            {t("you_and", { name: partner.name })}
          </strong>
          {t("pair_record", { w: pair.record.won, l: pair.record.lost })}
          {pair.record.streak >= 2
            ? ` · ${t("in_a_row", { n: pair.record.streak })}`
            : ""}
        </div>
      </div>

      {myOpen ? (
        <div className={s.stateBox} style={{ margin: "14px 0 0" }}>
          <b>{t("up_now")}</b>
          <div className={s.muted}>
            {t("up_until", {
              when: new Date(myOpen.availableUntil).toLocaleString(
                lang === "vi" ? "vi-VN" : "en-NZ",
                {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                },
              ),
            })}
          </div>
          <button
            className={`${s.btn} ${s.btnGhost}`}
            style={{ marginTop: 10 }}
            disabled={busy}
            onClick={() => act({ action: "cancel", id: myOpen.id })}
          >
            {t("take_down")}
          </button>
        </div>
      ) : busyGame ? null : composing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act({ action: "post", days, note });
            if (r.ok) {
              setComposing(false);
              setNote("");
            }
          }}
        >
          <span className={s.label}>{t("open_for")}</span>
          <div className={s.seg}>
            {[0, 3, 7].map((d) => (
              <button
                type="button"
                key={d}
                aria-pressed={days === d}
                onClick={() => setDays(d)}
              >
                {t(d === 0 ? "days_0" : d === 3 ? "days_3" : "days_7")}
              </button>
            ))}
          </div>
          <input
            className={s.field}
            style={{ marginTop: 10 }}
            maxLength={120}
            placeholder={t("note_ph")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className={s.cta} disabled={busy} type="submit">
            <span>{t("post_btn")}</span>
          </button>
          <button
            type="button"
            className={s.link}
            onClick={() => setComposing(false)}
          >
            {t("cancel")}
          </button>
        </form>
      ) : (
        <>
          <button
            className={`${s.cta} ${s.ctaBounce}`}
            disabled={busy}
            onClick={() => act({ action: "post", days: 3, note: "" })}
          >
            <span>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 15L4 20M14.5 3.5l6 6-7 7-6-6z" />
                <path d="M11 6l7 7" />
              </svg>
              {t("throw_down")}
            </span>
          </button>
          <p className={s.hint}>{t("throw_hint")}</p>
          <button
            type="button"
            className={s.link}
            onClick={() => setComposing(true)}
          >
            {t("post_options")}
          </button>
        </>
      )}

      {(
        <div
          className={s.row}
          style={{ marginTop: 10, justifyContent: "center", gap: 18 }}
        >
          {renaming ? (
            <form
              className={s.row}
              style={{ width: "100%" }}
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await act({ action: "pair_rename", name });
                if (r.ok) setRenaming(false);
              }}
            >
              <input
                className={s.field}
                style={{ flex: 1 }}
                maxLength={24}
                placeholder={t("name_ph")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button className={`${s.btn} ${s.btnTeal}`} disabled={busy}>
                {t("save")}
              </button>
            </form>
          ) : (
            <>
              {!busyGame && (
                <button className={s.link} onClick={() => setRenaming(true)}>
                  {t("name_pair")}
                </button>
              )}
              <button
                className={s.link}
                onClick={() => {
                  if (confirm(t("split_confirm", { name: partner.name })))
                    act({ action: "pair_leave" });
                }}
              >
                {t("split")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CrownCard({ state }: { state: ArenaState }) {
  const { t } = useArenaT();
  const c = state.crown;
  const days = c
    ? Math.max(
        0,
        Math.round(
          (Date.now() - Date.parse(`${c.since}T00:00:00Z`)) / 86_400_000,
        ),
      )
    : 0;
  return (
    <>
      <div className={s.crown}>
        <div className={s.crownK}>👑 {t("crown")}</div>
        {c ? (
          <>
            <div className={`${s.duo} ${s.crownDuo}`}>
              <Avatar p={c.pair.players[0]} tone="y" size="lg" />
              <Avatar p={c.pair.players[1]} tone="y" size="lg" />
            </div>
            <div className={s.crownNames}>{pairTitle(c.pair)}</div>
            <div className={s.crownHeld}>
              {t("crown_held", { d: days, n: c.defences })}
            </div>
            <div className={s.bounty}>👑 {t("crown_bounty")}</div>
          </>
        ) : (
          <>
            <div className={s.crownNames} style={{ marginTop: 12 }}>
              {t("crown_vacant")}
            </div>
            <div className={s.crownHeld}>{t("crown_vacant_body")}</div>
          </>
        )}
      </div>
      {state.packLeader && (
        <div className={s.mini}>
          <span style={{ fontSize: 26 }} aria-hidden="true">
            🐺
          </span>
          <div>
            <b>{t("pack_leader")}</b>
            {t("pack_leader_body", {
              name: state.packLeader.player.name,
              n: state.packLeader.games,
            })}
          </div>
        </div>
      )}
      {state.champion && (
        <div className={s.mini}>
          <span style={{ fontSize: 26 }} aria-hidden="true">
            🏆
          </span>
          <div>
            <b>
              {t("champion", {
                key: state.champion.key.replace(/^(\d{4})-(Q\d)$/, "$2 $1"),
              })}
            </b>
            {t("champion_body", {
              name: state.champion.player.name,
              wp: state.champion.wp,
            })}
          </div>
        </div>
      )}
    </>
  );
}

function LiveCard({ c, signedIn }: { c: ChallengeView; signedIn: boolean }) {
  const { t } = useArenaT();
  const mins = c.checkedInAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(c.checkedInAt)) / 60000))
    : 0;
  return (
    <article className={s.live}>
      <svg
        className={s.arc}
        viewBox="0 0 360 70"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M30 60 Q 180 -20 330 60"
          stroke="rgba(255,255,255,.35)"
          strokeWidth="1.5"
          strokeDasharray="2 5"
          fill="none"
        />
        <g
          className={s.shuttle}
          style={{ offsetDistance: "62%" } as React.CSSProperties}
        >
          <path d="M-6 -3L4 -6L4 6L-6 3Z" fill="#fff" />
          <circle cx="5" cy="0" r="3.2" fill="#ffd54a" />
        </g>
      </svg>
      <div className={s.liveRow}>
        <div className={s.side}>
          <Duo pair={c.posting} tone="c" />
          <div className={s.pname}>
            {pairTitle(c.posting)}
            {c.posting.name && <small>{pairNames(c.posting)}</small>}
          </div>
        </div>
        <div className={s.liveMid}>
          <span className={s.liveBadge}>
            <i />
            {t("live")}
          </span>
          <div className={s.clock}>{t("minutes", { n: mins })}</div>
        </div>
        <div className={`${s.side} ${s.sideR}`}>
          {c.accepting && (
            <>
              <Duo pair={c.accepting} tone="t" />
              <div className={s.pname}>
                {pairTitle(c.accepting)}
                {c.accepting.name && <small>{pairNames(c.accepting)}</small>}
              </div>
            </>
          )}
        </div>
      </div>
      {c.tracking ? (
        <a className={`${s.statsLink} ${s.trackingLive}`} href={signedIn ? `/profile/wolf-vision?challenge=${c.id}` : undefined}>
          <span>
            <i /> {t("wv_live")}
          </span>
          <small>{t("wv_live_stats", { rallies: c.tracking.rallies, hits: c.tracking.hits })}</small>
        </a>
      ) : signedIn ? (
        <a className={s.statsLink} href={`/profile/wolf-vision?challenge=${c.id}`}>
          <span>
            {t("rec_stats")}
            {isTrial() ? <em className={s.freeBadge}>{t("rec_stats_free")}</em> : null}
          </span>
          <small>{t(isTrial() ? "rec_stats_hint_trial" : "rec_stats_hint")}</small>
        </a>
      ) : null}
    </article>
  );
}

function openLeft(until: string, t: ReturnType<typeof useArenaT>["t"]): string {
  const ms = Date.parse(until) - Date.now();
  const h = Math.max(1, Math.round(ms / 3_600_000));
  if (h < 24) return t("open_hours", { n: h });
  return t("open_days", { n: Math.round(h / 24) });
}

function FightCard({
  c,
  hot,
  me,
  busy,
  act,
}: {
  c: ChallengeView;
  hot: boolean;
  me: ArenaState["me"];
  busy: boolean;
  act: Act;
}) {
  const { t, lang } = useArenaT();
  const partner = me?.pair?.players.find((p) => p.id !== me.id);
  const blockerKey = c.blocker ? (`block_${c.blocker}` as ArenaKey) : null;
  return (
    <article className={s.fight}>
      {(hot || c.crownMatch) && (
        <div className={`${s.ribbon} ${c.crownMatch ? s.ribbonCrown : ""}`}>
          {c.crownMatch ? t("crown_ribbon") : t("hot_ribbon")}
        </div>
      )}
      <div className={s.fightRow}>
        <div className={s.side}>
          <Duo pair={c.posting} tone="c" />
          <div className={s.pname}>
            {pairTitle(c.posting)}
            <small>
              {c.posting.name
                ? pairNames(c.posting)
                : c.posting.players
                    .map((p) => rankLine(p.rank, lang).split(" + ")[0])
                    .join(" · ")}
            </small>
          </div>
        </div>
        <div className={s.vs}>{t("vs")}</div>
        <div className={`${s.side} ${s.sideR}`}>
          <div className={s.openSlot}>?</div>
          <div className={`${s.pname} ${s.slotName}`}>
            {partner
              ? t("slot_you", { name: partner.name.split(" ")[0] })
              : t("slot_anyone")}
            {c.h2h && (
              <small>
                {c.h2h.won + c.h2h.lost > 0
                  ? t("h2h", { w: c.h2h.won, l: c.h2h.lost })
                  : t("h2h_never")}
              </small>
            )}
          </div>
        </div>
      </div>
      {c.note && <p className={s.note}>“{c.note}”</p>}
      <div className={s.meta}>
        {c.offer?.crown && (
          <span className={`${s.chip} ${s.chipCrown}`}>
            <BonusIcon kind="crown-bounty" px={16} />
            {t("chip_crown")}
          </span>
        )}
        {c.offer?.giantKiller && (
          <span className={`${s.chip} ${s.chipGk}`}>
            <BonusIcon kind="giant-killer" px={16} color="#ffd54a" />
            {t("chip_gk")}
          </span>
        )}
        {c.offer?.newRival && (
          <span className={`${s.chip} ${s.chipNr}`}>
            <BonusIcon kind="new-rival" px={16} color="#7ee7d3" />
            {t("chip_nr")}
          </span>
        )}
        {c.offer &&
          !c.offer.giantKiller &&
          !c.offer.newRival &&
          !c.offer.crown && (
            <span className={`${s.chip} ${s.chipEven}`}>
              ⚖️ {t("chip_even")}
            </span>
          )}
        <span className={`${s.chip} ${s.chipTime}`}>
          ⏳ {openLeft(c.availableUntil, t)}
        </span>
        <span className={s.metaEnd}>
          {me ? (
            c.blocker ? (
              <span className={s.blocker}>
                {blockerKey ? t(blockerKey) : ""}
              </span>
            ) : (
              <button
                className={`${s.btn} ${s.btnTeal}`}
                disabled={busy}
                onClick={() => act({ action: "accept", id: c.id })}
              >
                {t("accept_btn")}
              </button>
            )
          ) : (
            <a
              className={`${s.btn} ${s.btnTeal}`}
              href="/login?next=/profile/arena"
              style={{
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              {t("accept_btn")}
            </a>
          )}
        </span>
      </div>
    </article>
  );
}

function MyChallenge({
  c,
  busy,
  act,
  minMinutes,
  onCheckinShow,
  onCheckinEnter,
  onScore,
}: {
  c: ChallengeView;
  busy: boolean;
  act: Act;
  minMinutes: number;
  onCheckinShow: () => void;
  onCheckinEnter: () => void;
  onScore: () => void;
}) {
  const { t } = useArenaT();
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  if (c.status === "open") return null;
  const them = c.mySide === "posting" ? c.accepting : c.posting;
  const themNames = them ? firstNames(them, "&") : "";
  const themOr = them ? firstNames(them, "/") : "";
  const scoreText = c.retiredBy
    ? t("retired_score")
    : c.scorePosting !== null && c.scoreAccepting !== null
      ? `${c.scorePosting}–${c.scoreAccepting}`
      : "";
  let body: ReactNode = null;
  if (c.status === "accepted") {
    body = (
      <>
        {t("st_accepted")}
        <div className={s.row}>
          <button
            className={`${s.btn} ${s.btnYellow}`}
            disabled={busy}
            onClick={() => act({ action: "checkin_now", id: c.id })}
          >
            {t("were_here")}
          </button>
          <button
            className={`${s.btn} ${s.btnGhost}`}
            disabled={busy}
            onClick={() => act({ action: "call_off", id: c.id })}
          >
            {t("call_off")}
          </button>
        </div>
      </>
    );
  } else if (c.status === "live") {
    body = (
      <>
        {t("st_live")}
        <div className={s.row}>
          <button
            className={`${s.btn} ${s.btnYellow}`}
            disabled={busy}
            onClick={onScore}
          >
            {t("score_title")}
          </button>
          <a className={`${s.btn} ${s.btnGhost}`} href={`/profile/wolf-vision?challenge=${c.id}`} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            {t("rec_stats")}
            {isTrial() ? <em className={s.freeBadge}>{t("rec_stats_free")}</em> : null}
          </a>
          <button
            className={`${s.btn} ${s.btnGhost}`}
            disabled={busy}
            onClick={() => act({ action: "call_off", id: c.id })}
          >
            {t("call_off")}
          </button>
        </div>
      </>
    );
  } else if (c.status === "awaiting") {
    body = c.enteredByMySide ? (
      <>
        {t("st_awaiting_mine", { names: themNames, score: scoreText })}
        <div className={s.muted}>{t("auto_confirm")}</div>
      </>
    ) : (
      <>
        {t("st_awaiting_theirs", { names: themNames, score: scoreText })}
        {disputing ? (
          <>
            <input
              className={s.field}
              style={{ marginTop: 10 }}
              maxLength={300}
              placeholder={t("dispute_ph")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className={s.row}>
              <button
                className={`${s.btn} ${s.btnCoral}`}
                disabled={busy}
                onClick={() => act({ action: "dispute", id: c.id, note })}
              >
                {t("dispute_send")}
              </button>
              <button className={s.link} onClick={() => setDisputing(false)}>
                {t("cancel")}
              </button>
            </div>
          </>
        ) : (
          <div className={s.row}>
            <button
              className={`${s.btn} ${s.btnTeal}`}
              disabled={busy}
              onClick={() => act({ action: "confirm", id: c.id })}
            >
              {t("confirm")}
            </button>
            <button
              className={`${s.btn} ${s.btnGhost}`}
              disabled={busy}
              onClick={() => setDisputing(true)}
            >
              {t("wrong")}
            </button>
          </div>
        )}
      </>
    );
  } else if (c.status === "disputed") {
    body = t("st_disputed");
  }
  void themOr;
  return (
    <article className={`${s.fight} ${s.myCard}`}>
      <div className={s.fightRow}>
        <div className={s.side}>
          <Duo pair={c.posting} tone="c" />
          <div className={s.pname}>{pairTitle(c.posting)}</div>
        </div>
        <div className={s.vs}>{t("vs")}</div>
        <div className={`${s.side} ${s.sideR}`}>
          {c.accepting && (
            <>
              <Duo pair={c.accepting} tone="t" />
              <div className={s.pname}>{pairTitle(c.accepting)}</div>
            </>
          )}
        </div>
      </div>
      <div className={s.stateBox}>{body}</div>
    </article>
  );
}

function Feed({ items, lang, signedIn }: { items: FeedItem[]; lang: "en" | "vi"; signedIn: boolean }) {
  const { t } = useArenaT();
  const [statsFor, setStatsFor] = useState<number | null>(null);
  if (!items.length) return <p className={s.empty}>{t("feed_empty")}</p>;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === "vi" ? "vi-VN" : "en-NZ", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  return (
    <div className={s.feed}>
      {items.map((it, i) =>
        it.kind === "result" ? (
          <div key={`r${it.id}`} className={s.item}>
            <Duo pair={it.winners} tone={i % 2 ? "t" : "c"} size="sm" />
            <div className={s.itemTxt}>
              <b>{pairTitle(it.winners)}</b> {t("beat")}{" "}
              <b>{pairTitle(it.losers)}</b>{" "}
              {it.retired ? (
                <span>{t("retired_note")}</span>
              ) : (
                <span className={s.score}>
                  {it.scoreW}–{it.scoreL}
                </span>
              )}
              <time>{when(it.at)}</time>
              {it.stickers.map((st) => (
                <span
                  key={st}
                  className={`${s.sticker} ${st === "giant_killer" ? s.stickerTeal : st.startsWith("crown") ? s.stickerBronze : ""}`}
                >
                  {t(`st_${st}` as ArenaKey)}
                </span>
              ))}
              {it.hasStats && signedIn && (
                <button type="button" className={s.statsChip} onClick={() => setStatsFor(it.id)}>
                  {t("stats_btn")}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            key={`u${it.player.id}-${it.rank}-${it.at}`}
            className={`${s.item} ${s.rankup}`}
          >
            <RankIcon index={it.rank} px={46} />
            <div className={s.itemTxt}>
              <b>{it.player.name}</b> {t("reached")}{" "}
              <b style={{ color: "#ffd54a" }}>
                {rankName(LADDER[it.rank], lang)}
              </b>{" "}
              🎉
              <time>{when(it.at)}</time>
            </div>
          </div>
        ),
      )}
      {statsFor !== null && <MatchStatsModal challengeId={statsFor} onClose={() => setStatsFor(null)} />}
    </div>
  );
}

// ── Full-screen moments ───────────────────────────────────────────────

function Versus({ c, onGo, onMinimize }: { c: ChallengeView; onGo: () => void; onMinimize: () => void }) {
  const { t } = useArenaT();
  if (!c.accepting) return null;
  const offer = c.mySide === "accepting" ? c.offer : null;
  return (
    <div className={s.vsScreen}>
      <button type="button" className={s.vsMinBtn} onClick={onMinimize} aria-label={t("vs_minimize")} title={t("vs_minimize")}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M5 12h14" />
        </svg>
        <span>{t("vs_minimize_short")}</span>
      </button>
      <div className={`${s.half} ${s.halfTop}`}>
        <div className={s.halftone} />
        <Duo pair={c.posting} tone="c" size="lg" />
        <div className={s.who}>{pairTitle(c.posting)}</div>
        <div className={s.whoSub}>{t("vs_threw")}</div>
      </div>
      <div className={`${s.half} ${s.halfBot}`}>
        <div
          className={s.halftone}
          style={{ mask: "linear-gradient(315deg,#000,transparent 60%)" }}
        />
        <Duo pair={c.accepting} tone="t" size="lg" />
        <div className={s.who}>{pairTitle(c.accepting)}</div>
        <div className={s.whoSub}>{t("vs_took")}</div>
      </div>
      <div className={s.spark} />
      <div className={s.vsBig}>{t("vs")}</div>
      <div className={s.vsFoot}>
        <span className={s.vsK}>{t("vs_accepted")}</span>
        <p>{t("vs_body")}</p>
        {offer?.giantKiller && (
          <p className={s.vsK} style={{ marginBottom: 10 }}>
            {t("chip_gk")}
          </p>
        )}
        <button className={`${s.btn} ${s.btnYellow}`} onClick={onGo} autoFocus>
          {t("vs_go")}
        </button>
      </div>
    </div>
  );
}

function CheckinShow({
  c,
  code,
  expiresAt,
  onNew,
  onClose,
}: {
  c: ChallengeView;
  code: string;
  expiresAt: string;
  onNew: () => void;
  onClose: () => void;
}) {
  const { t } = useArenaT();
  const left = useCountdown(expiresAt);
  const them = c.posting;
  useEffect(() => {
    if (left === 0) onNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left === 0]);
  return (
    <div className={s.screen}>
      <button className={s.close} onClick={onClose} aria-label={t("cancel")}>
        ×
      </button>
      <h2 className={s.screenTitle}>{t("checkin_title")}</h2>
      <p className={s.lead}>
        {t("checkin_read", { names: firstNames(them, "/") })}
      </p>
      <CodeTiles code={code} />
      <Ring ms={left} total={120_000} />
      <p className={s.hint}>{t("only_this")}</p>
      <div className={s.bottom}>
        <div className={s.mini} style={{ justifyContent: "center" }}>
          <Duo pair={c.posting} tone="c" size="sm" />
          <span className={s.muted}>vs</span>
          {c.accepting && <Duo pair={c.accepting} tone="t" size="sm" />}
        </div>
      </div>
    </div>
  );
}

function CheckinEnter({
  c,
  busy,
  onSubmit,
  onClose,
}: {
  c: ChallengeView;
  busy: boolean;
  onSubmit: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useArenaT();
  const [code, setCode] = useState("");
  const them = c.accepting!;
  return (
    <form
      className={s.screen}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(code);
      }}
    >
      <button
        type="button"
        className={s.close}
        onClick={onClose}
        aria-label={t("cancel")}
      >
        ×
      </button>
      <h2 className={s.screenTitle}>{t("checkin_title")}</h2>
      <p className={s.lead}>
        {t("checkin_ask", { names: firstNames(them, "/") })}
      </p>
      <label
        className={s.label}
        htmlFor="checkin-code"
        style={{ textAlign: "center", marginTop: 24 }}
      >
        {t("checkin_type")}
      </label>
      <input
        id="checkin-code"
        className={s.codeInput}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={5}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
        autoFocus
      />
      <p className={s.hint}>{t("only_this")}</p>
      <div className={s.bottom}>
        <button
          className={s.cta}
          disabled={busy || code.length !== 5}
          type="submit"
        >
          <span>{t("checkin_btn")}</span>
        </button>
      </div>
    </form>
  );
}

function ScoreEntry({
  c,
  busy,
  minMinutes,
  onSubmit,
  onClose,
}: {
  c: ChallengeView;
  busy: boolean;
  minMinutes: number;
  onSubmit: (body: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const { t } = useArenaT();
  const [a, setA] = useState<number>(c.mySide === "posting" ? 21 : 0);
  const [b, setB] = useState<number>(c.mySide === "posting" ? 0 : 21);
  const [retire, setRetire] = useState(false);
  const valid = isValidGameScore(a, b);
  const them = c.mySide === "posting" ? c.accepting! : c.posting;
  const clamp = (n: number) =>
    Math.max(0, Math.min(30, Number.isFinite(n) ? Math.round(n) : 0));
  const Team = ({
    pair,
    tone,
    v,
    set,
    winner,
  }: {
    pair: PairView;
    tone: "c" | "t";
    v: number;
    set: (n: number) => void;
    winner: boolean;
  }) => (
    <div className={`${s.team} ${tone === "c" ? s.teamC : s.teamT}`}>
      <div className={s.teamName}>{pairTitle(pair)}</div>
      <div className={s.flip}>
        <input
          inputMode="numeric"
          type="number"
          min={0}
          max={30}
          value={v}
          aria-label={pairTitle(pair)}
          onChange={(e) => set(clamp(Number(e.target.value)))}
          onFocus={(e) => e.target.select()}
        />
      </div>
      <div className={s.pm}>
        <button type="button" aria-label="−1" onClick={() => set(clamp(v - 1))}>
          −
        </button>
        <button type="button" aria-label="+1" onClick={() => set(clamp(v + 1))}>
          +
        </button>
      </div>
      {winner && <span className={s.winnerTag}>{t("winners")}</span>}
    </div>
  );
  return (
    <div
      className={s.screen}
      style={{
        background:
          "radial-gradient(70% 40% at 50% 0%, rgba(255,213,74,.18), transparent 70%), linear-gradient(180deg, #0d2033, #08131f)",
      }}
    >
      <button className={s.close} onClick={onClose} aria-label={t("cancel")}>
        ×
      </button>
      <h2 className={s.screenTitle}>{t("score_title")}</h2>
      <p className={s.lead}>
        {t("st_live")}
      </p>
      <div className={s.board}>
        <Team
          pair={c.posting}
          tone="c"
          v={a}
          set={setA}
          winner={valid && a > b}
        />
        {c.accepting && (
          <Team
            pair={c.accepting}
            tone="t"
            v={b}
            set={setB}
            winner={valid && b > a}
          />
        )}
      </div>
      <div className={s.rules}>
        <span className={valid ? s.ok : s.bad}>
          {valid ? t("score_valid") : t("score_invalid")}
        </span>
        <span>{t("score_rules")}</span>
      </div>
      <div className={s.bottom}>
        <button
          className={s.cta}
          disabled={busy || !valid}
          onClick={() =>
            onSubmit({ action: "score", posting: a, accepting: b })
          }
        >
          <span>{t("score_send", { names: firstNames(them, "&") })}</span>
        </button>
        {retire ? (
          <div className={s.yn} style={{ display: "grid", marginTop: 12 }}>
            <button
              className={`${s.btn} ${s.btnGhost}`}
              disabled={busy}
              onClick={() =>
                onSubmit({ action: "retired", retiredBy: c.mySide })
              }
            >
              {t("retired_us")}
            </button>
            <button
              className={`${s.btn} ${s.btnGhost}`}
              disabled={busy}
              onClick={() =>
                onSubmit({
                  action: "retired",
                  retiredBy: c.mySide === "posting" ? "accepting" : "posting",
                })
              }
            >
              {t("retired_them")}
            </button>
          </div>
        ) : (
          <button
            className={s.link}
            style={{ display: "block", margin: "10px auto 0" }}
            onClick={() => setRetire(true)}
          >
            {t("retired_q")}
          </button>
        )}
      </div>
    </div>
  );
}

function Result({
  g,
  me,
  busy,
  onDone,
}: {
  g: AfterGame;
  me: NonNullable<ArenaState["me"]>;
  busy: boolean;
  onDone: (keep: boolean, again: boolean) => void;
}) {
  const { t, lang } = useArenaT();
  const [keep, setKeep] = useState<boolean | null>(null);
  const [again, setAgain] = useState<boolean | null>(null);
  const rank = me.rank;
  const next = nextRank(Math.min(rank.earned, LADDER.length - 1));
  const parts = [
    g.base ? t("pts_win", { n: g.base }) : null,
    g.giantKiller ? t("pts_gk", { n: g.giantKiller }) : null,
    g.newRival ? t("pts_nr", { n: g.newRival }) : null,
    g.hotStreak ? t("pts_hs", { n: g.hotStreak }) : null,
    g.crownBounty ? t("pts_cb", { n: g.crownBounty }) : null,
  ].filter(Boolean) as string[];
  return (
    <div className={`${s.screen} ${g.won ? s.win : s.gg}`}>
      {g.won && <div className={s.rays} />}
      {g.won && <Confetti />}
      {g.won ? (
        <div className={s.vic}>{t("victory")}</div>
      ) : (
        <div className={s.hand}>🤝</div>
      )}
      {!g.won && <div className={s.ggTitle}>{t("good_game")}</div>}
      <div className={s.bigScore}>
        {g.retired ? (
          t("retired_note")
        ) : (
          <>
            {g.scoreFor} <i>–</i> {g.scoreAgainst}
          </>
        )}{" "}
        vs {pairTitle(g.opponents)}
      </div>
      {!g.won && <p className={s.lead}>{t("gg_body")}</p>}
      <div className={s.wp}>
        +{g.total} <small>WP</small>
      </div>
      {parts.length > 0 && (
        <div className={s.break}>
          {parts.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
      )}
      <div className={s.rk}>
        <RankIcon index={rank.shown} px={44} />
        <div className={s.rkT}>
          <b>{rankName(LADDER[rank.shown], lang)}</b> · {rank.wpTotal} WP
          <div className={s.bar}>
            <i style={{ width: `${Math.round(rank.progress * 100)}%` }} />
          </div>
          {next
            ? t("to_next", {
                n: Math.max(0, next.wp - rank.wpTotal),
                rank: rankName(next, lang),
              })
            : t("top")}
        </div>
      </div>
      <div className={s.q}>
        <p>{t("keep_q")}</p>
        <div className={s.yn}>
          <button
            className={`${s.btn} ${s.btnTeal}`}
            aria-pressed={keep === true}
            onClick={() => setKeep(true)}
          >
            {t("keep_yes")}
          </button>
          <button
            className={`${s.btn} ${s.btnGhost}`}
            aria-pressed={keep === false}
            onClick={() => setKeep(false)}
          >
            {t("keep_no")}
          </button>
        </div>
      </div>
      {keep !== false && (
        <div className={s.q}>
          <p>{t("again_q")}</p>
          <div className={s.yn}>
            <button
              className={`${s.btn} ${s.btnYellow}`}
              aria-pressed={again === true}
              onClick={() => setAgain(true)}
            >
              {t("again_yes")}
            </button>
            <button
              className={`${s.btn} ${s.btnGhost}`}
              aria-pressed={again === false}
              onClick={() => setAgain(false)}
            >
              {t("again_no")}
            </button>
          </div>
        </div>
      )}
      <div className={s.bottom} style={{ width: "100%" }}>
        <button
          className={s.cta}
          disabled={busy || keep === null || (keep && again === null)}
          onClick={() => onDone(Boolean(keep), Boolean(keep && again))}
        >
          <span>{t("done")}</span>
        </button>
      </div>
    </div>
  );
}

function RankUp({ to, onDone }: { to: number; onDone: () => void }) {
  const { t, lang } = useArenaT();
  const r = LADDER[to];
  const name = rankName(r, lang);
  const share = async () => {
    const text = `${t("rankup_body")} ${name} 🐺 Three Wolves`;
    const url = `${location.origin}/challenges`;
    try {
      if (navigator.share)
        await navigator.share({ title: t("rankup"), text, url });
      else await navigator.clipboard.writeText(`${text} ${url}`);
    } catch {
      // cancelled
    }
  };
  return (
    <div className={`${s.screen} ${s.rankScreen}`}>
      <div className={s.rays} />
      <Confetti />
      <div className={s.eyebrow}>{t("rankup")}</div>
      <div className={s.rankPop} style={{ marginTop: 18 }}>
        <RankIcon index={to} px={150} />
      </div>
      <p className={s.lead}>{t("rankup_body")}</p>
      <div className={s.rankName}>{name}</div>
      <p className={s.muted}>
        {t("league_step", {
          league: LEAGUES[r.league][lang],
          s: r.step,
          n: r.steps,
        })}
      </p>
      <div className={s.bottom} style={{ width: "100%" }}>
        <button className={s.cta} onClick={onDone}>
          <span>{t("nice")}</span>
        </button>
        <button
          className={s.link}
          style={{ display: "block", margin: "10px auto 0" }}
          onClick={share}
        >
          {t("share")}
        </button>
      </div>
    </div>
  );
}
