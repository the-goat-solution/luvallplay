"use client";

import { CLUB_TIME_ZONE } from "@/lib/constants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { ModalShell } from "@/components/modals/ModalShell";
import type { Lang } from "@/lib/i18n";
import {
  TEAM_LOCK_DAYS,
  WIN_POINTS,
  buildSchedule,
  computeStandings,
  isValidScore,
  matchResult,
  teamName,
  type Match,
  type MiniGameState,
  type Score,
  type Team,
} from "@/lib/mini-game";

const POLL_MS = 15_000;

const COPY = {
  en: {
    eyebrow: "Club Mini Game",
    title: "Round Robin",
    sub: "Doubles · Every team meets every team",
    howLbl: "How it works",
    how1: "Teams of two are drawn at random and balanced by skill.",
    how2: `Once drawn, teams are locked in for ${TEAM_LOCK_DAYS} days, then the page resets for a new draw. Every team plays every other team once, one game per team each round.`,
    how3: `Confirm each score to lock it in for good. A win earns ${WIN_POINTS} points, a loss 0. Ties on points are split by head-to-head, then point difference, then points scored.`,
    roster: "Players",
    draw: "Draw Teams",
    auth: {
      draw: {
        title: "Draw the teams?",
        body: `The teams will be locked in for ${TEAM_LOCK_DAYS} days. After that the page resets so a new draw can be made. Enter the password to continue.`,
        confirm: "Draw & lock teams",
      },
    },
    password: "Password",
    wrongPassword: "Incorrect password.",
    preview: "Preview with sample data",
    previewBanner: "Preview mode: sample data only. Nothing here is saved.",
    exitPreview: "Exit preview",
    lockedUntil: (when: string) => `Teams locked until ${when}. The page then resets for a new draw.`,
    teams: "The Teams",
    standings: "Standings",
    games: "Games",
    round: "Round",
    game: "Game",
    vs: "vs",
    played: "P",
    won: "W",
    lost: "L",
    diff: "+/-",
    pts: "Pts",
    form: "Form",
    team: "Team",
    progress: (done: number, total: number) => `${done} of ${total} games played`,
    noDraws: "Scores can't be level",
    confirm: "Confirm score",
    locked: "Final",
    leader: "Leader",
    champion: "Champions",
    championSub: "Every team has met every team. Congratulations!",
    confirmTitle: "Lock in this score?",
    confirmBody: "Once confirmed, this score is final and can't be edited.",
    confirmYes: "Lock it in",
    cancel: "Cancel",
    loadError: "Couldn't load the mini game. Check your connection and try again.",
    retry: "Try again",
    errAlreadyLocked: "That score was already locked in by someone else. Showing the final result.",
    errStale: "The teams changed since this page loaded. Showing the latest draw.",
    officialDraw: "The teams have been officially drawn. Showing the live game.",
    errGeneric: "Something went wrong. Please try again.",
    scoreLabel: (name: string) => `Score for ${name}`,
    syncNote: "Results are shared live with everyone who has this page open.",
  },
  vi: {
    eyebrow: "Mini Game Của CLB",
    title: "Vòng Tròn",
    sub: "Đánh đôi · Mọi đội đều gặp nhau",
    howLbl: "Cách chơi",
    how1: "Các đội hai người được bốc thăm ngẫu nhiên và cân bằng trình độ.",
    how2: `Sau khi bốc thăm, đội được giữ nguyên trong ${TEAM_LOCK_DAYS} ngày, rồi trang sẽ đặt lại để bốc thăm mới. Mỗi đội gặp tất cả các đội còn lại một lần, mỗi vòng một trận.`,
    how3: `Xác nhận tỉ số để chốt vĩnh viễn. Thắng được ${WIN_POINTS} điểm, thua 0 điểm. Bằng điểm thì xét đối đầu, rồi hiệu số, rồi tổng điểm ghi được.`,
    roster: "Người chơi",
    draw: "Bốc Thăm Đội",
    auth: {
      draw: {
        title: "Bốc thăm các đội?",
        body: `Các đội sẽ được giữ nguyên trong ${TEAM_LOCK_DAYS} ngày. Sau đó trang sẽ tự đặt lại để bốc thăm mới. Nhập mật khẩu để tiếp tục.`,
        confirm: "Bốc thăm & chốt đội",
      },
    },
    password: "Mật khẩu",
    wrongPassword: "Sai mật khẩu.",
    preview: "Xem thử với dữ liệu mẫu",
    previewBanner: "Chế độ xem thử: chỉ là dữ liệu mẫu, không có gì được lưu.",
    exitPreview: "Thoát xem thử",
    lockedUntil: (when: string) => `Đội được chốt đến ${when}. Sau đó trang sẽ đặt lại để bốc thăm mới.`,
    teams: "Các Đội",
    standings: "Bảng Xếp Hạng",
    games: "Các Trận",
    round: "Vòng",
    game: "Trận",
    vs: "vs",
    played: "Tr",
    won: "T",
    lost: "B",
    diff: "+/-",
    pts: "Đ",
    form: "Phong độ",
    team: "Đội",
    progress: (done: number, total: number) => `Đã đấu ${done} / ${total} trận`,
    noDraws: "Tỉ số không thể hoà",
    confirm: "Xác nhận",
    locked: "Chung cuộc",
    leader: "Dẫn đầu",
    champion: "Vô Địch",
    championSub: "Tất cả các đội đã gặp nhau. Chúc mừng!",
    confirmTitle: "Chốt tỉ số này?",
    confirmBody: "Sau khi xác nhận, tỉ số là chung cuộc và không thể sửa.",
    confirmYes: "Chốt tỉ số",
    cancel: "Huỷ",
    loadError: "Không tải được mini game. Kiểm tra kết nối và thử lại.",
    retry: "Thử lại",
    errAlreadyLocked: "Tỉ số này đã được người khác chốt. Đang hiển thị kết quả chung cuộc.",
    errStale: "Các đội đã thay đổi. Đang hiển thị lần bốc thăm mới nhất.",
    officialDraw: "Các đội đã được bốc thăm chính thức. Đang hiển thị trận đấu thật.",
    errGeneric: "Đã xảy ra lỗi. Vui lòng thử lại.",
    scoreLabel: (name: string) => `Tỉ số của ${name}`,
    syncNote: "Kết quả được cập nhật trực tiếp cho mọi người đang mở trang này.",
  },
} satisfies Record<Lang, Record<string, unknown>>;

type Draft = { a: string; b: string };
/** Organiser actions that need the password. */
type AuthAction = "draw";
type PendingConfirm = { match: Match; a: number; b: number };

function formatWhen(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: CLUB_TIME_ZONE,
  }).format(new Date(iso));
}

/**
 * Sample draw for preview mode: teams come from the server's real draw rules
 * (nothing is saved), with the first few rounds filled in with made-up scores.
 */
function sampleDraw(teams: Team[]): NonNullable<MiniGameState["draw"]> {
  const matches = buildSchedule(teams);
  const scores: Record<string, Score> = {};
  for (const m of matches.filter((m) => m.round <= 3)) {
    const loser = 8 + Math.floor(Math.random() * 12);
    scores[m.id] = Math.random() < 0.5 ? { a: 21, b: loser } : { a: loser, b: 21 };
  }
  const now = Date.now();
  return {
    id: 0,
    teams,
    matches,
    scores,
    createdAt: new Date(now).toISOString(),
    lockedUntil: new Date(now + TEAM_LOCK_DAYS * 86_400_000).toISOString(),
  };
}

function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function MiniGame() {
  const { lang, setLang } = useLanguage();
  const c = COPY[lang];
  const [state, setState] = useState<MiniGameState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [authAction, setAuthAction] = useState<AuthAction | null>(null);
  const [justDrawn, setJustDrawn] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [demo, setDemo] = useState<MiniGameState["draw"]>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mini-game", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setState((await res.json()) as MiniGameState);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- false positive: load() is async and only sets state after awaiting fetch
    load();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
      setNow(Date.now());
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  /** POSTs an action; resolves to the HTTP status (0 on network failure). */
  const post = async (body: object, conflictNotice?: string): Promise<number> => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/mini-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as MiniGameState | null;
      if (data && "players" in data) setState(data);
      if (res.status === 409) setNotice(conflictNotice ?? c.errGeneric);
      else if (!res.ok && res.status !== 401) setNotice(c.errGeneric);
      return res.status;
    } catch {
      setNotice(c.errGeneric);
      return 0;
    } finally {
      setBusy(false);
    }
  };

  const openAuth = (action: AuthAction) => {
    setPassword("");
    setPasswordError(false);
    setAuthAction(action);
  };

  const setLanguage = (l: Lang) => {
    setLang(l);
    document.documentElement.lang = l;
  };

  const runAuthAction = async () => {
    if (!authAction || !password) return;
    const status = await post({ action: authAction, password });
    if (status === 401) return setPasswordError(true);
    setAuthAction(null);
    if (status !== 200) return;
    setDrafts({});
    setJustDrawn(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startPreview = async () => {
    if (state?.draw) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/mini-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview" }),
      });
      // 409: teams were drawn since this page loaded. The response carries
      // the live game, so show that instead of sample data.
      if (res.status === 409) {
        setState((await res.json()) as MiniGameState);
        setNotice(c.officialDraw);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { teams } = (await res.json()) as { teams: Team[] };
      setDemo(sampleDraw(teams));
    } catch {
      setNotice(c.errGeneric);
      return;
    } finally {
      setBusy(false);
    }
    setDrafts({});
    setJustDrawn(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const exitPreview = () => {
    setDemo(null);
    setDrafts({});
    setJustDrawn(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const lockIn = async () => {
    if (!pending) return;
    const { match, a, b } = pending;
    setPending(null);
    let ok = false;
    if (demo && !state?.draw) {
      setDemo({ ...demo, scores: { ...demo.scores, [match.id]: { a, b } } });
      ok = true;
    } else if (state?.draw) {
      const scoreConflict = state.draw.scores[match.id] ? c.errAlreadyLocked : c.errStale;
      const status = await post(
        { action: "score", drawId: state.draw.id, matchId: match.id, a, b },
        scoreConflict,
      );
      ok = status === 200;
    }
    if (ok) {
      setDrafts((d) => {
        const next = { ...d };
        delete next[match.id];
        return next;
      });
    }
  };

  const setDraft = (matchId: string, side: "a" | "b", value: string) => {
    const clean = value.replace(/\D/g, "").slice(0, 2);
    setDrafts((d) => ({ ...d, [matchId]: { ...(d[matchId] ?? { a: "", b: "" }), [side]: clean } }));
  };

  // Once teams are officially drawn the live game always wins: preview mode
  // is only ever available before the draw.
  const liveDrawId = state?.draw?.id ?? null;
  if (liveDrawId !== null && demo) {
    setDemo(null);
    setDrafts({});
    setPending(null);
    setJustDrawn(true);
    setNotice(c.officialDraw);
  }

  const game = state?.draw ?? demo ?? null;
  const inPreview = !state?.draw && demo !== null;

  const teamsById = useMemo(() => new Map(game?.teams.map((t) => [t.id, t]) ?? []), [game?.teams]);

  const standings = useMemo(
    () => (game ? computeStandings(game.teams, game.matches, game.scores) : []),
    [game],
  );

  const rounds = useMemo(() => {
    const map = new Map<number, Match[]>();
    for (const m of game?.matches ?? []) map.set(m.round, [...(map.get(m.round) ?? []), m]);
    return [...map.entries()];
  }, [game?.matches]);

  const completed = game ? game.matches.filter((m) => game.scores[m.id]).length : 0;
  const total = game?.matches.length ?? 0;
  const finished = total > 0 && completed === total;
  const teamsLocked = game ? new Date(game.lockedUntil).getTime() > now : false;

  return (
    <div className="mg-page">
      <header className="mg-hero">
        <div className="mg-hero-bg" />
        <div className="mg-hero-overlay" />
        <div className="container mg-topbar">
          <div className="lang-toggle">
            <button type="button" className={`lang-btn${lang === "en" ? " active" : ""}`} onClick={() => setLanguage("en")}>
              EN
            </button>
            <button type="button" className={`lang-btn${lang === "vi" ? " active" : ""}`} onClick={() => setLanguage("vi")}>
              VI
            </button>
          </div>
        </div>
        <div className="mg-hero-content">
          <img src="/uploads/Three wolves logo transparent.svg" alt="Three Wolves" className="mg-hero-logo" />
          <div className="hero-eyebrow">{c.eyebrow}</div>
          <h1 className="mg-hero-title">{c.title}</h1>
          <p className="mg-hero-sub">{c.sub}</p>
          {game && (
            <div className="mg-progress" aria-live="polite">
              <div className="mg-progress-bar">
                <div className="mg-progress-fill" style={{ width: `${(completed / total) * 100}%` }} />
              </div>
              <span>{c.progress(completed, total)}</span>
            </div>
          )}
        </div>
      </header>

      <main className="mg-main">
        <div className="container">
          {notice && (
            <div className="mg-notice" role="status">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label={c.cancel}>
                ×
              </button>
            </div>
          )}

          {inPreview && (
            <div className="mg-preview-banner" role="status">
              <span>{c.previewBanner}</span>
              <button type="button" className="btn btn-primary mg-btn-sm" onClick={exitPreview}>
                {c.exitPreview}
              </button>
            </div>
          )}

          {!state ? (
            loadFailed ? (
              <div className="mg-card mg-error">
                <p>{c.loadError}</p>
                <button type="button" className="btn btn-navy mg-btn-sm" onClick={load}>
                  {c.retry}
                </button>
              </div>
            ) : (
              <div className="mg-loading" aria-hidden="true" />
            )
          ) : !game ? (
            <section className="mg-intro">
              <div className="mg-card mg-how">
                <div className="section-label">{c.howLbl}</div>
                <ol className="mg-how-list">
                  <li>{c.how1}</li>
                  <li>{c.how2}</li>
                  <li>{c.how3}</li>
                </ol>
              </div>
              <div className="mg-card">
                <div className="section-label">{c.roster}</div>
                <ul className="mg-roster">
                  {state.players.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn btn-primary btn-full mg-draw"
                  onClick={() => openAuth("draw")}
                  disabled={busy}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                  </svg>
                  {c.draw}
                </button>
                <button type="button" className="btn btn-bronze-outline btn-full mg-preview-btn" onClick={startPreview} disabled={busy}>
                  {c.preview}
                </button>
              </div>
            </section>
          ) : (
            <>
              {finished && standings[0] && (
                <section className="mg-champion">
                  <div className="mg-champion-trophy" aria-hidden="true">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
                    </svg>
                  </div>
                  <div className="section-label">{c.champion}</div>
                  <h2 className="mg-champion-name">{teamName(standings[0].team)}</h2>
                  <p>{c.championSub}</p>
                </section>
              )}

              <section className="mg-section">
                <div className="mg-section-head">
                  <h2 className="mg-h2">{c.teams}</h2>
                </div>
                {teamsLocked && (
                  <p className="mg-lock-line">
                    <LockIcon />
                    {c.lockedUntil(formatWhen(game.lockedUntil, lang))}
                  </p>
                )}
                <div className={`mg-teams${justDrawn ? " mg-teams-reveal" : ""}`}>
                  {game.teams.map((team, i) => (
                    <div key={team.id} className="mg-team" style={{ animationDelay: `${i * 70}ms` }}>
                      <span className="mg-team-num">#{team.id}</span>
                      <div className="mg-team-players">
                        {team.players.map((p) => (
                          <span key={p}>{p}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="mg-board">
                <section className="mg-section mg-standings-wrap">
                  <h2 className="mg-h2">{c.standings}</h2>
                  <div className="mg-card mg-table-card">
                    <table className="mg-table">
                      <thead>
                        <tr>
                          <th className="mg-col-rank">#</th>
                          <th className="mg-col-team">{c.team}</th>
                          <th>{c.played}</th>
                          <th>{c.won}</th>
                          <th>{c.lost}</th>
                          <th>{c.diff}</th>
                          <th className="mg-col-pts">{c.pts}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((s, i) => {
                          const leader = i === 0 && completed > 0;
                          return (
                            <tr key={s.team.id} className={leader ? "mg-row-leader" : undefined}>
                              <td className="mg-col-rank">
                                {leader ? (
                                  <span className="mg-crown" title={c.leader}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                      <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7z" />
                                    </svg>
                                  </span>
                                ) : (
                                  i + 1
                                )}
                              </td>
                              <td className="mg-col-team">
                                <div className="mg-table-team">{teamName(s.team)}</div>
                                {s.form.length > 0 && (
                                  <div className="mg-form" aria-label={c.form}>
                                    {s.form.slice(-5).map((r, j) => (
                                      <span key={j} className={`mg-form-dot mg-form-${r}`}>
                                        {r === "W" ? c.won : c.lost}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td>{s.played}</td>
                              <td>{s.won}</td>
                              <td>{s.lost}</td>
                              <td className={s.diff > 0 ? "mg-pos" : s.diff < 0 ? "mg-neg" : undefined}>
                                {s.diff > 0 ? `+${s.diff}` : s.diff}
                              </td>
                              <td className="mg-col-pts">{s.points}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mg-note">{c.syncNote}</p>
                </section>

                <section className="mg-section mg-games-wrap">
                  <h2 className="mg-h2">{c.games}</h2>
                  {rounds.map(([round, matches]) => (
                    <div key={round} className="mg-round">
                      <div className="mg-round-head">
                        <span>
                          {c.round} {round}
                        </span>
                      </div>
                      <div className="mg-matches">
                        {matches.map((m) => (
                          <MatchCard
                            key={m.id}
                            match={m}
                            teamA={teamsById.get(m.teamA)!}
                            teamB={teamsById.get(m.teamB)!}
                            final={game.scores[m.id]}
                            draft={drafts[m.id] ?? { a: "", b: "" }}
                            busy={busy}
                            copy={c}
                            onDraft={(side, v) => setDraft(m.id, side, v)}
                            onConfirm={(a, b) => setPending({ match: m, a, b })}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="mg-footer">
        <div className="container">
          <span>Three Wolves Badminton Club</span>
        </div>
      </footer>

      <ModalShell
        id="mg-auth-modal"
        open={authAction !== null}
        onClose={() => setAuthAction(null)}
        title={authAction ? c.auth[authAction].title : ""}
        footer={
          <>
            <button type="button" className="btn btn-bronze-outline" onClick={() => setAuthAction(null)}>
              {c.cancel}
            </button>
            <button
              type="button"
              className="btn btn-primary mg-btn-grow"
              onClick={runAuthAction}
              disabled={busy || !password}
            >
              {authAction ? c.auth[authAction].confirm : ""}
            </button>
          </>
        }
      >
        <p className="mg-modal-text">{authAction ? c.auth[authAction].body : ""}</p>
        <PasswordField
          id="mg-password"
          label={c.password}
          value={password}
          error={passwordError ? c.wrongPassword : null}
          onChange={(v) => {
            setPassword(v);
            setPasswordError(false);
          }}
          onSubmit={runAuthAction}
        />
      </ModalShell>

      <ModalShell
        id="mg-score-modal"
        open={pending !== null}
        onClose={() => setPending(null)}
        title={c.confirmTitle}
        footer={
          <>
            <button type="button" className="btn btn-bronze-outline" onClick={() => setPending(null)}>
              {c.cancel}
            </button>
            <button type="button" className="btn btn-primary mg-btn-grow" onClick={lockIn} disabled={busy}>
              <LockIcon size={16} />
              {c.confirmYes}
            </button>
          </>
        }
      >
        {pending && game && (
          <>
            <div className="mg-confirm-score">
              <div className="mg-confirm-game">
                {c.game} {pending.match.number}
              </div>
              {(
                [
                  [teamsById.get(pending.match.teamA)!, pending.a, pending.a > pending.b],
                  [teamsById.get(pending.match.teamB)!, pending.b, pending.b > pending.a],
                ] as const
              ).map(([team, score, won]) => (
                <div key={team.id} className={`mg-confirm-row${won ? " mg-confirm-won" : ""}`}>
                  <span>{teamName(team)}</span>
                  <strong>{score}</strong>
                </div>
              ))}
            </div>
            <p className="mg-modal-text">{c.confirmBody}</p>
          </>
        )}
      </ModalShell>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  error,
  onChange,
  onSubmit,
}: {
  id: string;
  label: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="mg-password"
      onSubmit={(e) => {
        e.preventDefault();
        if (value) onSubmit();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="password"
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error && <p className="mg-password-error">{error}</p>}
    </form>
  );
}

function MatchCard({
  match,
  teamA,
  teamB,
  final,
  draft,
  busy,
  copy: c,
  onDraft,
  onConfirm,
}: {
  match: Match;
  teamA: Team;
  teamB: Team;
  final: { a: number; b: number } | undefined;
  draft: Draft;
  busy: boolean;
  copy: (typeof COPY)[Lang];
  onDraft: (side: "a" | "b", value: string) => void;
  onConfirm: (a: number, b: number) => void;
}) {
  const result = matchResult(match, final);
  const a = draft.a === "" ? NaN : Number(draft.a);
  const b = draft.b === "" ? NaN : Number(draft.b);
  const draftValid = isValidScore(a, b);
  const level = draft.a !== "" && draft.a === draft.b;
  const draftWinner = draftValid ? (a > b ? teamA.id : teamB.id) : null;

  const side = (team: Team, key: "a" | "b") => {
    const won = result ? result.winner === team.id : draftWinner === team.id;
    const lost = result ? result.loser === team.id : draftWinner !== null && draftWinner !== team.id;
    return (
      <div className={`mg-side${won ? " mg-side-won" : ""}${lost ? " mg-side-lost" : ""}`}>
        <div className="mg-side-names">
          {team.players.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
        {final ? (
          <span className="mg-score mg-score-final">{final[key]}</span>
        ) : (
          <input
            className="mg-score"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            placeholder="–"
            value={draft[key]}
            aria-label={c.scoreLabel(teamName(team))}
            onChange={(e) => onDraft(key, e.target.value)}
          />
        )}
      </div>
    );
  };

  return (
    <div className={`mg-match${final ? " mg-match-done" : ""}`}>
      <div className="mg-match-top">
        <span>
          {c.game} {match.number}
        </span>
        {final && (
          <span className="mg-final-tag">
            <LockIcon size={12} />
            {c.locked}
          </span>
        )}
      </div>
      {side(teamA, "a")}
      <div className="mg-vs">{c.vs}</div>
      {side(teamB, "b")}
      {!final && (
        <>
          {level && <div className="mg-warn">{c.noDraws}</div>}
          <button
            type="button"
            className="btn btn-primary btn-full mg-confirm-btn"
            disabled={!draftValid || busy}
            onClick={() => onConfirm(a, b)}
          >
            <LockIcon />
            {c.confirm}
          </button>
        </>
      )}
    </div>
  );
}
