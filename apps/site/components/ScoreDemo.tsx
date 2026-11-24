"use client";
// The hero's score card: one demo game counted to its end, then it rests.
// Labelled as a demo. Under reduced motion it shows the final score, still.
import { useEffect, useReducer } from "react";

type Words = { you: string; start: string; yourPoint: string; theirPoint: string; won: string; lost: string; replay: string; label: string };
type State = { a: number; b: number; last: "" | "a" | "b"; done: boolean; run: number };

// A fixed, believable game (no randomness, so the server and browser agree).
const RALLY = "abaabbabaababbaabababbaabbabaabababbabaa";
const FINAL: State = { a: 21, b: 19, last: "a", done: true, run: 0 };

function reducer(s: State, action: "point" | "replay" | "skip"): State {
  if (action === "skip") return { ...FINAL, run: s.run };
  if (action === "replay") return { a: 0, b: 0, last: "", done: false, run: s.run + 1 };
  if (s.done) return s;
  const who = RALLY[s.a + s.b] === "b" ? "b" : "a";
  const a = s.a + (who === "a" ? 1 : 0);
  const b = s.b + (who === "b" ? 1 : 0);
  return { ...s, a, b, last: who, done: (a >= 21 || b >= 21) && Math.abs(a - b) >= 2 };
}

export function ScoreDemo({ words, caption, label, demo }: { words: Words; caption: string; label: string; demo: string }) {
  // Rendered on the server at the final score, so the card is complete without JavaScript.
  const [s, dispatch] = useReducer(reducer, FINAL);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = setTimeout(() => dispatch("replay"), 600);
    return () => clearTimeout(start);
  }, []);
  useEffect(() => {
    if (s.done || s.run === 0) return;
    const id = setTimeout(() => dispatch("point"), 900);
    return () => clearTimeout(id);
  }, [s]);
  const note = s.done ? (s.a > s.b ? words.won : words.lost) : s.a + s.b === 0 ? words.start : s.last === "a" ? words.yourPoint : words.theirPoint;
  return (
    <div className="glass score">
      <div className="score-top">
        <span className="label muted">{label}</span>
        <span className="chip lime"><span className="dot" style={{ width: 6, height: 6 }} aria-hidden="true" />{demo}</span>
      </div>
      <div className="score-num" role="img" aria-label={`${words.label}: ${s.a}–${s.b}`}>
        <span key={`a${s.a}`} className={s.last === "a" && !s.done ? "tick" : undefined}>{s.a}</span>
        <span className="dash">–</span>
        <span key={`b${s.b}`} className={s.last === "b" && !s.done ? "tick" : undefined}>{s.b}</span>
      </div>
      <div className="score-note">{caption} · {note}</div>
      {s.done ? <button type="button" className="score-replay" onClick={() => dispatch("replay")}>{words.replay}</button> : null}
    </div>
  );
}
