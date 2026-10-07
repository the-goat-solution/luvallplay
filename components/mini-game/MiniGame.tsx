"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { ModalShell } from "@/components/modals/ModalShell";
import type { Lang } from "@/lib/i18n";
import {
  ROSTER,
  WIN_POINTS,
  buildSchedule,
  computeStandings,
  drawTeams,
  matchResult,
  teamName,
  type Match,
  type Score,
  type Team,
  type Tier,
} from "@/lib/mini-game";

const STORAGE_KEY = "tw-mini-game-v1";

type SavedGame = {
  teams: Team[];
  matches: Match[];
  scores: Record<string, Score>;
};

const COPY = {
  en: {
    back: "Back to main site",
    eyebrow: "Club Mini Game",
    title: "Round Robin",
    sub: "Doubles · Every team meets every team",
    howLbl: "How it works",
    how1: "Teams are drawn at random: a Tier 1 player with a Tier 4 player, and a Tier 2 player with a Tier 3 player.",
    how2: "Every team plays every other team once. Games are grouped into rounds so each team plays once per round.",
    how3: `A win earns ${WIN_POINTS} points, a loss 0. Ties on points are split by head-to-head, then point difference, then points scored.`,
    roster: "Tonight's players",
    tier: "Tier",
    draw: "Draw Teams",
    redraw: "Redraw Teams",
    redrawLocked: "Teams are locked once a score is entered. Reset to start over.",
    reset: "Reset",
    teams: "The Teams",
    pairing14: "Tier 1 + 4",
    pairing23: "Tier 2 + 3",
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
    leader: "Leader",
    champion: "Champions",
    championSub: "Every team has met every team. Congratulations!",
    resetTitle: "Reset the mini game?",
    resetBody: "This clears the teams and every score entered so far. It can't be undone.",
    resetConfirm: "Yes, reset",
    cancel: "Cancel",
    savedNote: "Scores are saved on this device automatically.",
    scoreLabel: (name: string) => `Score for ${name}`,
  },
  vi: {
    back: "Về trang chính",
    eyebrow: "Mini Game Của CLB",
    title: "Vòng Tròn",
    sub: "Đánh đôi · Mọi đội đều gặp nhau",
    howLbl: "Cách chơi",
    how1: "Các đội được bốc thăm ngẫu nhiên: một người Tier 1 với một người Tier 4, và một người Tier 2 với một người Tier 3.",
    how2: "Mỗi đội gặp tất cả các đội còn lại một lần. Các trận được chia theo vòng, mỗi đội chơi một trận mỗi vòng.",
    how3: `Thắng được ${WIN_POINTS} điểm, thua 0 điểm. Bằng điểm thì xét đối đầu, rồi hiệu số, rồi tổng điểm ghi được.`,
    roster: "Người chơi hôm nay",
    tier: "Tier",
    draw: "Bốc Thăm Đội",
    redraw: "Bốc Thăm Lại",
    redrawLocked: "Đã có tỉ số nên không thể bốc lại. Bấm Đặt lại để chơi từ đầu.",
    reset: "Đặt lại",
    teams: "Các Đội",
    pairing14: "Tier 1 + 4",
    pairing23: "Tier 2 + 3",
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
    leader: "Dẫn đầu",
    champion: "Vô Địch",
    championSub: "Tất cả các đội đã gặp nhau. Chúc mừng!",
    resetTitle: "Đặt lại mini game?",
    resetBody: "Thao tác này xoá các đội và toàn bộ tỉ số đã nhập. Không thể hoàn tác.",
    resetConfirm: "Đặt lại",
    cancel: "Huỷ",
    savedNote: "Tỉ số được tự động lưu trên thiết bị này.",
    scoreLabel: (name: string) => `Tỉ số của ${name}`,
  },
} satisfies Record<Lang, Record<string, unknown>>;

function loadSaved(): SavedGame | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedGame;
    if (!Array.isArray(parsed.teams) || !Array.isArray(parsed.matches)) return null;
    return { teams: parsed.teams, matches: parsed.matches, scores: parsed.scores ?? {} };
  } catch {
    return null;
  }
}

function persist(game: SavedGame | null) {
  try {
    if (game) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the game still works in memory.
  }
}

function TierChip({ tier }: { tier: Tier }) {
  return <span className={`mg-tier mg-tier-${tier}`}>T{tier}</span>;
}

function isPairing14(team: Team) {
  return team.players.some((p) => p.tier === 1);
}

export function MiniGame() {
  const { lang, setLang } = useLanguage();
  const c = COPY[lang];
  const [game, setGame] = useState<SavedGame | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [justDrawn, setJustDrawn] = useState(false);

  useEffect(() => {
    setGame(loadSaved());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) persist(game);
  }, [game, loaded]);

  const setLanguage = (l: Lang) => {
    setLang(l);
    document.documentElement.lang = l;
  };

  const draw = () => {
    const teams = drawTeams();
    setGame({ teams, matches: buildSchedule(teams), scores: {} });
    setJustDrawn(true);
  };

  const reset = () => {
    setGame(null);
    setJustDrawn(false);
    setConfirmReset(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const setScore = (matchId: string, side: "a" | "b", value: string) => {
    const clean = value.replace(/\D/g, "").slice(0, 2);
    setGame((g) => {
      if (!g) return g;
      const prev = g.scores[matchId] ?? { a: "", b: "" };
      return { ...g, scores: { ...g.scores, [matchId]: { ...prev, [side]: clean } } };
    });
  };

  const teamsById = useMemo(
    () => new Map(game?.teams.map((t) => [t.id, t]) ?? []),
    [game?.teams],
  );

  const standings = useMemo(
    () => (game ? computeStandings(game.teams, game.matches, game.scores) : []),
    [game],
  );

  const completed = game
    ? game.matches.filter((m) => matchResult(m, game.scores[m.id])).length
    : 0;
  const total = game?.matches.length ?? 0;
  const anyScoreEntered = game
    ? Object.values(game.scores).some((s) => s.a !== "" || s.b !== "")
    : false;
  const finished = total > 0 && completed === total;

  const rounds = useMemo(() => {
    const map = new Map<number, Match[]>();
    for (const m of game?.matches ?? []) {
      map.set(m.round, [...(map.get(m.round) ?? []), m]);
    }
    return [...map.entries()];
  }, [game?.matches]);

  const tiers: Tier[] = [1, 2, 3, 4];

  return (
    <div className="mg-page">
      <header className="mg-hero">
        <div className="mg-hero-bg" />
        <div className="mg-hero-overlay" />
        <div className="container mg-topbar">
          <Link href="/" className="mg-back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {c.back}
          </Link>
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
          {!loaded ? (
            <div className="mg-loading" aria-hidden="true" />
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
                <div className="mg-roster">
                  {tiers.map((tier) => (
                    <div key={tier} className="mg-roster-col">
                      <div className="mg-roster-head">
                        <TierChip tier={tier} />
                        <span>
                          {c.tier} {tier}
                        </span>
                      </div>
                      <ul>
                        {ROSTER.filter((p) => p.tier === tier).map((p) => (
                          <li key={p.name}>{p.name}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn btn-primary btn-full mg-draw" onClick={draw}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                  </svg>
                  {c.draw}
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
                  <div className="mg-actions">
                    <button
                      type="button"
                      className="btn btn-bronze-outline mg-btn-sm"
                      onClick={draw}
                      disabled={anyScoreEntered}
                      title={anyScoreEntered ? c.redrawLocked : undefined}
                    >
                      {c.redraw}
                    </button>
                    <button type="button" className="btn btn-navy mg-btn-sm" onClick={() => setConfirmReset(true)}>
                      {c.reset}
                    </button>
                  </div>
                </div>
                {anyScoreEntered && <p className="mg-hint">{c.redrawLocked}</p>}
                <div className={`mg-teams${justDrawn ? " mg-teams-reveal" : ""}`} key={game.teams.map(teamName).join("|")}>
                  {game.teams.map((team, i) => (
                    <div key={team.id} className="mg-team" style={{ animationDelay: `${i * 70}ms` }}>
                      <div className="mg-team-top">
                        <span className="mg-team-num">#{team.id}</span>
                        <span className="mg-team-pool">{isPairing14(team) ? c.pairing14 : c.pairing23}</span>
                      </div>
                      {team.players.map((p) => (
                        <div key={p.name} className="mg-team-player">
                          <TierChip tier={p.tier} />
                          <span>{p.name}</span>
                        </div>
                      ))}
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
                  <p className="mg-note">{c.savedNote}</p>
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
                        {matches.map((m) => {
                          const a = teamsById.get(m.teamA)!;
                          const b = teamsById.get(m.teamB)!;
                          const score = game.scores[m.id] ?? { a: "", b: "" };
                          const result = matchResult(m, score);
                          const level = score.a !== "" && score.b !== "" && score.a === score.b;
                          const side = (team: Team, key: "a" | "b") => {
                            const won = result?.winner === team.id;
                            const lost = result?.loser === team.id;
                            return (
                              <div className={`mg-side${won ? " mg-side-won" : ""}${lost ? " mg-side-lost" : ""}`}>
                                <div className="mg-side-names">
                                  {team.players.map((p) => (
                                    <span key={p.name}>{p.name}</span>
                                  ))}
                                </div>
                                <input
                                  className="mg-score"
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  maxLength={2}
                                  placeholder="–"
                                  value={score[key]}
                                  aria-label={c.scoreLabel(teamName(team))}
                                  onChange={(e) => setScore(m.id, key, e.target.value)}
                                />
                              </div>
                            );
                          };
                          return (
                            <div key={m.id} className={`mg-match${result ? " mg-match-done" : ""}`}>
                              <div className="mg-match-top">
                                <span>
                                  {c.game} {m.number}
                                </span>
                                {result && (
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M20 6 9 17l-5-5" />
                                  </svg>
                                )}
                              </div>
                              {side(a, "a")}
                              <div className="mg-vs">{c.vs}</div>
                              {side(b, "b")}
                              {level && <div className="mg-warn">{c.noDraws}</div>}
                            </div>
                          );
                        })}
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
          <Link href="/">{c.back}</Link>
        </div>
      </footer>

      <ModalShell
        id="mg-reset-modal"
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={c.resetTitle}
        footer={
          <>
            <button type="button" className="btn btn-bronze-outline" onClick={() => setConfirmReset(false)}>
              {c.cancel}
            </button>
            <button type="button" className="btn btn-primary mg-btn-grow" onClick={reset}>
              {c.resetConfirm}
            </button>
          </>
        }
      >
        <p className="mg-modal-text">{c.resetBody}</p>
      </ModalShell>
    </div>
  );
}
