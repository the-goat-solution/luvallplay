// The stage: match night for the Arena, the Leaderboard and Vision. The
// screen plays on a floodlit court in the club's own dark theme, whatever
// the page's mode (system.css, "The stage"), so every scheme and imported
// brand gets the same excitement with no per-club code. The pieces here
// (rays, confetti, a count-up, stickers, a pair's faces, a meter) are the
// stage's shared props; their styles are in styles/stage.css, which loads
// with the screens that use them, not with the app's first screen.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useCurrentClub } from "../hooks.tsx";
import { applyTheme } from "../lib/theme.ts";
import { RankIcon } from "./RankIcon.tsx";
import "../styles/stage.css";
import "../styles/fold-stage.css";

/** True when the person asked for less motion (read once per mount; the CSS also stops every animation). */
export function prefersLessMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Wraps a screen in the floodlit stage. `foldSplit` lets the screen lay
 * itself out on both halves of a foldable opened like a book (the shell
 * then keeps only its narrow rail beside it).
 */
export function Stage({ children, foldSplit = true }: { children: ReactNode; foldSplit?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useCurrentClub().config?.theme ?? null;
  useLayoutEffect(() => {
    if (ref.current) applyTheme(ref.current, theme, "dark");
  }, [theme]);
  return (
    <div ref={ref} className="stage" data-stage="" data-look-scope="" data-theme="dark" data-fold-split={foldSplit ? "" : undefined}>
      <div className="stage-backdrop" aria-hidden="true">
        <svg className="stage-court" viewBox="0 0 600 240" preserveAspectRatio="xMidYMin slice" focusable="false">
          {/* A court in perspective: the outline, a centre line and the service lines. Any sport's. */}
          <path d="M150 40 H450 L570 230 H30 Z M300 40 V230 M110 103 H490 M70 167 H530" />
        </svg>
      </div>
      {children}
    </div>
  );
}

/** A sunburst behind a moment (the crown, a victory). Still: it never turns. */
export function Rays({ className }: { className?: string }) {
  return <span className={`rays${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}

const CONFETTI = 28;
const CONFETTI_COLOURS = ["var(--flood)", "var(--side-you)", "var(--side-them)", "var(--ink)", "var(--medal-2)"];

/** One burst of confetti, once. Not drawn at all for less motion; gone after it falls. */
export function Confetti() {
  const [on, setOn] = useState(() => !prefersLessMotion());
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setOn(false), 3200);
    return () => window.clearTimeout(t);
  }, [on]);
  if (!on) return null;
  return (
    <span className="confetti" aria-hidden="true">
      {Array.from({ length: CONFETTI }, (_, i) => (
        <i
          key={i}
          style={{
            "--x": `${(i * 37) % 100}%`,
            "--delay": `${(i % 9) * 0.09}s`,
            "--turn": `${180 + ((i * 53) % 360)}deg`,
            "--drift": `${((i * 29) % 13) - 6}vw`,
            "--c": CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
          } as CSSProperties}
        />
      ))}
    </span>
  );
}

/**
 * A number that counts up to `value` once (about 0.9s, easing out). The
 * final text is in the page from the start for screen readers and tests;
 * only the drawn copy counts.
 */
export function CountUp({ value, prefix = "", suffix = "", className }: { value: number; prefix?: string; suffix?: string; className?: string }) {
  const [shown, setShown] = useState(() => (prefersLessMotion() ? value : 0));
  useEffect(() => {
    if (prefersLessMotion()) return setShown(value);
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 900);
      setShown(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span className={className}>
      <span aria-hidden="true">{prefix}{shown}{suffix}</span>
      <span className="visually-hidden">{prefix}{value}{suffix}</span>
    </span>
  );
}

/** A tilted label badge: "Golden point", "Winner", "Hot". */
export function Sticker({ children, tone = "flood", className }: { children: ReactNode; tone?: "flood" | "you" | "them" | "quiet"; className?: string }) {
  return <span className={`sticker sticker-${tone}${className ? ` ${className}` : ""}`}>{children}</span>;
}

type Face = { id: number | string; initials: string; rank?: number; avatarUrl?: string | null; tarnishing?: boolean };

/** A pair's two faces, overlapped, each with its rank badge. `side` colours the discs. */
export function Duo({ players, side = "you", size = "md", rankLabel }: { players: readonly Face[]; side?: "you" | "them" | "crown"; size?: "sm" | "md" | "lg"; rankLabel?: boolean }) {
  const px = size === "lg" ? 30 : size === "md" ? 22 : 18;
  return (
    <span className={`duo duo-${size} duo-${side}`} aria-hidden={rankLabel ? undefined : "true"}>
      {players.map((p) => (
        <span key={p.id} className="duo-face">
          {p.avatarUrl ? <img className="duo-disc" src={p.avatarUrl} alt="" /> : <span className="duo-disc" aria-hidden="true">{p.initials}</span>}
          {p.rank != null && <RankIcon index={p.rank} tarnished={p.tarnishing} px={px} className="duo-rank" />}
        </span>
      ))}
    </span>
  );
}

/** A bar that fills to `value` (0–1) once it's on screen. */
export function Meter({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <span className="meter-fill" style={{ "--v": v } as CSSProperties} />
    </span>
  );
}

/** A short buzz for a big moment, where the phone can (never on its own for less motion). */
export function buzz(): void {
  if (prefersLessMotion()) return;
  try {
    navigator.vibrate?.([18, 40, 28]);
  } catch {
    // Not allowed here.
  }
}
