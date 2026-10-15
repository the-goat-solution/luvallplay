"use client";

import { useEffect, useState } from "react";
import { useJerseyT } from "@/lib/jersey-i18n";
import { useJerseyClock } from "./useJerseyClock";

type Props = { opensAt: string; closesAt: string; serverNow: string; earlyBirdsLeft: number };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function JerseyHero({ opensAt, closesAt, serverNow, earlyBirdsLeft }: Props) {
  const { tr } = useJerseyT();
  const { started, closed, open, msLeft } = useJerseyClock(opensAt, serverNow, closesAt);
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
    [tr("days"), Math.floor(s / 86400)],
    [tr("hours"), Math.floor((s % 86400) / 3600)],
    [tr("mins"), Math.floor((s % 3600) / 60)],
    [tr("secs"), s % 60],
  ] as const;

  return (
    <section className="section section-navy jersey-hero">
      <div className="container" style={{ textAlign: "center", paddingTop: 40 }}>
        <img
          src="/uploads/Three wolves logo transparent.svg"
          alt="Three Wolves Badminton Club"
          style={{ width: 96, margin: "0 auto 20px" }}
        />
        <div className="section-label" style={{ justifyContent: "center" }}>{tr("hero_label")}</div>
        <h1 className="section-title section-title-white">{tr("hero_title")}</h1>
        <p className="section-sub section-sub-light" style={{ margin: "16px auto 0" }}>
          {tr("hero_sub")}
        </p>

        {!started ? (
          <div style={{ marginTop: 36 }}>
            <div style={{ fontSize: 13, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--bronze-light)", fontWeight: 700 }}>
              {tr("opens_in")}
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
              {tr("opens_note")}
            </p>
          </div>
        ) : closed ? (
          <div style={{ marginTop: 32 }}>
            <div className="jersey-badge">{tr("closed_msg")}</div>
          </div>
        ) : (
          <div style={{ marginTop: 32 }}>
            <div className="jersey-badge">
              {left > 0 ? tr("spots_left", { n: left }) : tr("spots_gone")}
            </div>
            <p style={{ marginTop: 14, color: "rgba(255,255,255,.7)", fontSize: 15 }}>{tr("closes_note")}</p>
            <div style={{ marginTop: 18 }}>
              <a href="#register" className="btn btn-primary">{tr("register_now")}</a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
