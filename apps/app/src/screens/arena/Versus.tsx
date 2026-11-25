// The moment a challenge you're in is accepted, as on the website: the two
// pairs slide in, "VS" lands, then "Let's go" (seen, not shown again) or
// "Later" (a pill on the Arena brings it back). Which games were seen or put
// off is kept on this device.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { storage } from "../../app.ts";
import { RankIcon } from "../../components/RankIcon.tsx";
import { pairTitle, type ArenaState, type Challenge, type Pair } from "./data.ts";
import type { ArenaT } from "./words.ts";

const SEEN = "arena.vsSeen";
const LATER = "arena.vsLater";
const listeners = new Set<() => void>();

function ids(key: string): number[] {
  try {
    const v = JSON.parse(storage.get(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}
function write(key: string, list: number[]) {
  storage.set(key, JSON.stringify(list.slice(-50)));
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const snapshot = () => `${storage.get(SEEN) ?? ""}|${storage.get(LATER) ?? ""}`;

/** The accepted game to show (or the one put off), and what to do with it. */
export function useVersus(state: ArenaState | undefined) {
  useSyncExternalStore(subscribe, snapshot);
  const seen = ids(SEEN);
  const later = ids(LATER);
  const pending = state?.mine.find((c) => c.status === "accepted" && c.accepting && !seen.includes(c.id));
  return {
    show: pending && !later.includes(pending.id) ? pending : undefined,
    later: pending && later.includes(pending.id) ? pending : undefined,
    go: (id: number) => {
      write(SEEN, [...seen, id]);
      write(LATER, later.filter((x) => x !== id));
    },
    putOff: (id: number) => write(LATER, [...later.filter((x) => x !== id), id]),
    reopen: (id: number) => write(LATER, later.filter((x) => x !== id)),
  };
}

function Duo({ pair }: { pair: Pair }) {
  return (
    <div className="vs-duo">
      {pair.players.map((p) => (
        <span key={p.id} className="vs-face">
          <span className="avatar" aria-hidden="true">{p.initials}</span>
          <RankIcon index={p.rank} px={28} className="vs-face-rank" />
        </span>
      ))}
    </div>
  );
}

export function Versus({ c, t, onGo, onLater }: { c: Challenge; t: ArenaT; onGo: () => void; onLater: () => void }) {
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    go.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onLater();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLater]);
  if (!c.accepting) return null;
  const offer = c.mySide === "accepting" ? c.offer : null;
  return (
    <div className="vs-screen" role="dialog" aria-modal="true" aria-labelledby="vs-title" data-testid="versus">
      <button type="button" className="button button-small vs-later" onClick={onLater} aria-label={t("vs_minimize")}>
        {t("vs_minimize_short")}
      </button>
      <div className="vs-half vs-half-top">
        <Duo pair={c.posting} />
        <strong className="vs-who">{pairTitle(c.posting)}</strong>
        <span className="vs-sub">{t("vs_threw")}</span>
      </div>
      <div className="vs-half vs-half-bottom">
        <Duo pair={c.accepting} />
        <strong className="vs-who">{pairTitle(c.accepting)}</strong>
        <span className="vs-sub">{t("vs_took")}</span>
      </div>
      <div className="vs-big" aria-hidden="true">{t("vs")}</div>
      <div className="vs-foot stack-tight">
        <h2 id="vs-title" className="vs-kicker">{t("vs_accepted")}</h2>
        <p>{t("vs_body")}</p>
        {offer?.giantKiller && <p className="vs-kicker">{t("chip_gk")}</p>}
        <div>
          <button ref={go} type="button" className="button button-primary" onClick={onGo}>{t("vs_go")}</button>
        </div>
      </div>
    </div>
  );
}

/** "Your match is on · Open": the splash put off with Later. */
export function VersusPill({ c, t, onOpen }: { c: Challenge; t: ArenaT; onOpen: () => void }) {
  return (
    <p className="notice vs-pill">
      <strong>{t("vs_waiting")}</strong> · {c.accepting ? `${pairTitle(c.posting)} ${t("vs")} ${pairTitle(c.accepting)}` : pairTitle(c.posting)}{" "}
      <button type="button" className="button button-small" onClick={onOpen}>{t("vs_open")}</button>
    </p>
  );
}
