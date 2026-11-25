// The labelling set, as the website's Wolf Vision labelling tool: load a
// match video, play it slowly and press 1–4 the moment each player hits (as
// the camera sees them: near left, near right, far left, far right). R starts
// a new rally, Backspace removes the last hit, ←/→ step a frame (Shift: half
// a second), Space plays or pauses. Saved to the labelling set, or downloaded.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { AppKey } from "@luvallplay/i18n/app";
import { useCurrentClub, useT } from "../hooks.tsx";
import { useSaveLabels } from "./vision/data.ts";

type Hit = { t: number; player: number; rally: number };
const SLOTS: AppKey[] = ["label_near_left", "label_near_right", "label_far_left", "label_far_right"];

export default function VisionLabelScreen() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const video = useRef<HTMLVideoElement>(null);
  const url = useRef<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [rally, setRally] = useState(0);
  const [rate, setRate] = useState(0.5);
  const [now, setNow] = useState(0);
  const save = useSaveLabels();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => () => {
    if (url.current) URL.revokeObjectURL(url.current);
  }, []);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const tick = () => setNow(v.currentTime);
    v.addEventListener("timeupdate", tick);
    v.addEventListener("seeked", tick);
    return () => {
      v.removeEventListener("timeupdate", tick);
      v.removeEventListener("seeked", tick);
    };
  }, [name]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = rate;
  }, [rate, name]);

  const mark = useCallback(
    (player: number) => {
      const v = video.current;
      if (!v || !name) return;
      const time = Math.round(v.currentTime * 1000) / 1000;
      setHits((h) => [...h, { t: time, player, rally }].sort((a, b) => a.t - b.t));
    },
    [name, rally],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = video.current;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (!v || !name || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mark, name]);

  const open = (f: File) => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = URL.createObjectURL(f);
    setName(f.name);
    setHits([]);
    setRally(0);
    setStatus(null);
    if (video.current) video.current.src = url.current;
  };
  const payload = () => ({ videoName: name ?? "video", duration: Number.isFinite(video.current?.duration) ? (video.current?.duration ?? 0) : 0, hits });
  const store = () => {
    setStatus({ ok: true, text: t("label_saving") });
    save.mutate(payload(), {
      onSuccess: () => setStatus({ ok: true, text: t("label_saved", { n: hits.length }) }),
      onError: () => setStatus({ ok: false, text: t("label_save_failed") }),
    });
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload(), null, 1))}`;
    a.download = `${(name ?? "video").replace(/\.[^.]+$/, "")}.labels.json`;
    document.body.append(a);
    a.click();
    a.remove();
  };
  const rallies = new Set(hits.map((h) => h.rally)).size;

  return (
    <div className="screen vision-label" data-screen="vision-label">
      <Link to="/vision" className="back">← {t("nav_vision")}</Link>
      <h1>{t("label_title")}</h1>
      <section className="card stack">
        <span className="tag">✦ {t("label_badge")}</span>
        <p className="small">{t("label_help")}</p>
        <label className="field">
          <span>{t("label_video")}</span>
          <input type="file" accept="video/*" data-testid="label-file" onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} />
        </label>
      </section>
      <video ref={video} className="label-video" hidden={!name} controls playsInline muted />
      {name && (
        <section className="card stack">
          <div className="actions">
            {SLOTS.map((k, i) => (
              <button key={k} type="button" className={`button slot-${i}`} onClick={() => mark(i)}>{i + 1} · {t(k)}</button>
            ))}
            <button type="button" className="button button-quiet" onClick={() => setRally((r) => r + 1)}>{t("label_new_rally")}</button>
            <button type="button" className="button button-quiet" disabled={!hits.length} onClick={() => setHits((h) => h.slice(0, -1))}>{t("label_undo")}</button>
            <label className="choice">
              <span>{t("label_speed")}</span>
              <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                {[0.25, 0.5, 1].map((r) => <option key={r} value={r}>{r}×</option>)}
              </select>
            </label>
          </div>
          <p className="muted small" data-testid="label-summary" aria-live="polite">
            {t("label_summary", { t: now.toFixed(2), hits: hits.length, rallies, rally: rally + 1 })}
          </p>
          <ol className="label-hits">
            {hits.map((h, i) => (
              <li key={`${h.t}-${i}`}>
                <span className={`label-dot slot-${h.player}`} aria-hidden="true" /> {h.t.toFixed(3)} s · {t(SLOTS[h.player])} · {h.rally + 1}
              </li>
            ))}
          </ol>
          <div className="actions">
            <button type="button" className="button button-primary" disabled={!hits.length || save.isPending} onClick={store}>{t("label_save")}</button>
            <button type="button" className="button" disabled={!hits.length} onClick={download}>{t("label_download")}</button>
          </div>
          {status && <p className={`notice${status.ok ? "" : " notice-error"}`} role={status.ok ? "status" : "alert"}>{status.text}</p>}
        </section>
      )}
    </div>
  );
}
