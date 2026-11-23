"use client";

// Wolf Vision labelling tool. Load a match video, play it slowly, and press
// 1–4 at the moment of each hit (who hit it, as the camera sees them:
// 1 near-left, 2 near-right, 3 far-left, 4 far-right). R starts a new rally,
// Backspace removes the last hit, ←/→ step a frame, Shift+←/→ half a second,
// Space plays/pauses. Labels are saved to the labelling set (signed in) and
// can be downloaded as JSON for offline training.
import { visionName } from "@/lib/club-terms";
import { useCallback, useEffect, useRef, useState } from "react";
import s from "./analyzer.module.css";

type LabelHit = { t: number; player: number; rally: number };
const SLOTS = ["Near left", "Near right", "Far left", "Far right"];
const COLORS = ["#ff6b57", "#ffb4a6", "#2fd4b5", "#a4f2e2"];

export function LabelTool() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [hits, setHits] = useState<LabelHit[]>([]);
  const [rally, setRally] = useState(0);
  const [rate, setRate] = useState(0.5);
  const [now, setNow] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tick = () => setNow(v.currentTime);
    v.addEventListener("timeupdate", tick);
    v.addEventListener("seeked", tick);
    return () => {
      v.removeEventListener("timeupdate", tick);
      v.removeEventListener("seeked", tick);
    };
  }, [name]);

  const mark = useCallback(
    (player: number) => {
      const v = videoRef.current;
      if (!v || !name) return;
      const t = Math.round(v.currentTime * 1000) / 1000;
      setHits((h) => [...h, { t, player, rally }].sort((a, b) => a.t - b.t));
    },
    [name, rally],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v || !name || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (["1", "2", "3", "4"].includes(e.key)) mark(Number(e.key) - 1);
      else if (e.key === "r" || e.key === "R") setRally((r) => r + 1);
      else if (e.key === "Backspace") setHits((h) => h.slice(0, -1));
      else if (e.key === " ") {
        e.preventDefault();
        if (v.paused) void v.play();
        else v.pause();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        v.pause();
        const step = e.shiftKey ? 0.5 : 1 / 30;
        v.currentTime = Math.max(0, v.currentTime + (e.key === "ArrowLeft" ? -step : step));
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mark, name]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate, name]);

  const open = (f: File) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(f);
    setName(f.name);
    setHits([]);
    setRally(0);
    setStatus(null);
    if (videoRef.current) videoRef.current.src = urlRef.current;
  };

  const payload = () => ({ videoName: name ?? "video", duration: videoRef.current?.duration ?? 0, hits });

  const save = async () => {
    setStatus("Saving…");
    const res = await fetch("/api/wolf-vision/labels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()) }).catch(() => null);
    if (res?.ok) setStatus(`Saved ${hits.length} hits to the labelling set. Thank you!`);
    else if (res?.status === 401) setStatus("Sign in to save to the labelling set (you can still download the file).");
    else setStatus("Could not save. Download the file instead.");
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(payload(), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(name ?? "video").replace(/\.[^.]+$/, "")}.labels.json`;
    a.click();
  };

  const byRally = hits.reduce<Record<number, LabelHit[]>>((m, h) => ((m[h.rally] ??= []).push(h), m), {});

  return (
    <div className={`${s.page} ${s.embedded}`}>
      <header className={s.top}>
        <a href="/profile/wolf-vision" className={s.exitBtn} style={{ color: "inherit" }}>
          ← Back
        </a>
        <h1>
          {visionName()}<small>Labelling set</small>
        </h1>
      </header>
      <main className={s.body}>
        <section className={s.card}>
          <span className={s.aiBadge}>✦ Trains the AI-enhanced tracker</span>
          <p>
            Play the match slowly and press <b>1–4</b> the moment each player hits the shuttle (1 near left, 2 near right, 3 far left, 4 far right, as the camera sees
            them). <b>R</b> new rally · <b>Backspace</b> undo · <b>←/→</b> one frame · <b>Shift+←/→</b> half a second · <b>Space</b> play/pause.
          </p>
          <input type="file" accept="video/*" data-testid="label-file" onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} />
        </section>
        <div className={s.stage} hidden={!name}>
          <video ref={videoRef} controls playsInline muted style={{ width: "100%", display: "block" }} />
        </div>
        {name ? (
          <section className={s.card}>
            <div className={s.row}>
              {SLOTS.map((label, i) => (
                <button key={label} type="button" className={s.btnGhost} onClick={() => mark(i)} style={{ borderColor: COLORS[i] }} data-testid={`label-${i + 1}`}>
                  {i + 1} · {label}
                </button>
              ))}
              <button type="button" className={s.btnGhost} onClick={() => setRally((r) => r + 1)}>
                New rally
              </button>
              <label className={s.hint}>
                Speed{" "}
                <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                  {[0.25, 0.5, 1].map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className={s.hint} data-testid="label-summary">
              {now.toFixed(2)} s · {hits.length} hits in {Object.keys(byRally).length} rallies · rally {rally + 1}
            </p>
            <ol className={s.hint} style={{ maxHeight: 200, overflow: "auto" }}>
              {hits.map((h, i) => (
                <li key={`${h.t}-${i}`}>
                  {h.t.toFixed(2)} s · rally {h.rally + 1} · <span style={{ color: COLORS[h.player] }}>{SLOTS[h.player]}</span>
                </li>
              ))}
            </ol>
            <div className={s.row}>
              <button type="button" className={s.btn} disabled={!hits.length} onClick={() => void save()} data-testid="label-save">
                Save to labelling set
              </button>
              <button type="button" className={s.btnGhost} disabled={!hits.length} onClick={download}>
                Download JSON
              </button>
            </div>
            {status ? <div className={s.notice}>{status}</div> : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
