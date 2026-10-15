"use client";

import { useEffect, useState } from "react";
import { useJerseyClock } from "./useJerseyClock";

type Props = { opensAt: string; serverNow: string; earlyBirdsLeft: number };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function JerseyHero({ opensAt, serverNow, earlyBirdsLeft }: Props) {
  const { open, msLeft } = useJerseyClock(opensAt, serverNow);
  const [left, setLeft] = useState(earlyBirdsLeft);

  // Once open, keep the early-bird count fresh while people register.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () =>
      fetch("/api/jersey", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => alive && typeof d.earlyBirdsLeft === "number" && setLeft(d.earlyBirdsLeft))
        .catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open]);

  const s = Math.floor(msLeft / 1000);
  const parts = [
    ["Days", Math.floor(s / 86400)],
    ["Hours", Math.floor((s % 86400) / 3600)],
    ["Mins", Math.floor((s % 3600) / 60)],
    ["Secs", s % 60],
  ] as const;

  return (
    <section className="section section-navy jersey-hero">
      <div className="container" style={{ textAlign: "center", paddingTop: 40 }}>
        <img
          src="/uploads/Three wolves logo transparent.svg"
          alt="Three Wolves Badminton Club"
          style={{ width: 96, margin: "0 auto 20px" }}
        />
        <div className="section-label" style={{ justifyContent: "center" }}>Official Club Jersey</div>
        <h1 className="section-title section-title-white">Wear the pack</h1>
        <p className="section-sub section-sub-light" style={{ margin: "16px auto 0" }}>
          Authentic Yonex, printed in Vietnam and shipped to Christchurch. Arriving around early November.
        </p>

        {!open ? (
          <div style={{ marginTop: 36 }}>
            <div style={{ fontSize: 13, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--bronze-light)", fontWeight: 700 }}>
              Registration opens in
            </div>
            <div className="jersey-count" role="timer" aria-live="off">
              {parts.map(([label, v]) => (
                <div key={label} className="jersey-count-cell">
                  <div className="jersey-count-num">{pad(v)}</div>
                  <div className="jersey-count-lbl">{label}</div>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 18, color: "rgba(255,255,255,.7)", fontSize: 15 }}>
              Opens 1:30 AM, Friday 16 October (NZ time). First come, first served — the first 10 pay just $15.
            </p>
          </div>
        ) : (
          <div style={{ marginTop: 32 }}>
            <div className="jersey-badge">
              {left > 0 ? (
                <>
                  <strong>{left}</strong> of 10 early-bird spots left at <strong>$15</strong>
                </>
              ) : (
                <>Early-bird spots are gone — jerseys are now <strong>$30</strong></>
              )}
            </div>
            <div style={{ marginTop: 22 }}>
              <a href="#register" className="btn btn-primary">Register now</a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
