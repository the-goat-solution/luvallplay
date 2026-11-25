// My photos on Me, as the website's: take one or choose up to 20, a
// caption and the consent line, then each is prepared on the device (GPS
// removed, a display copy and a thumbnail made), uploaded straight to the
// club's photo store, and checked. Your photos below with where they are
// (in the Gallery, under review, can't be shared, hidden), and delete.
import { useId, useRef, useState } from "react";
import { ScopeTag } from "../../components/ClubTag.tsx";
import type { AppKey } from "@luvallplay/i18n/app";
import type { T } from "../../lib/messages.ts";
import { LoadError } from "../../components/LoadError.tsx";
import { useDeletePhoto, usePhotos, useSharePhoto, type PhotoStatus } from "./photos-data.ts";

type JobState = "preparing" | "checking" | PhotoStatus | "failed";
type Job = { name: string; preview: string; state: JobState };

const STATUS: Record<PhotoStatus, [AppKey, string]> = {
  approved: ["ph_status_approved", "ok"],
  needs_review: ["ph_status_review", "wait"],
  pending: ["ph_status_review", "wait"],
  rejected: ["ph_status_rejected", "bad"],
  hidden: ["ph_status_hidden", "bad"],
};

/** `onlyWhenOn`: Home with several clubs leaves out a club whose photo sharing isn't set up. */
export function PhotosCard({ t, playerId, onlyWhenOn = false }: { t: T; playerId: number; onlyWhenOn?: boolean }) {
  const titleId = useId();
  const list = usePhotos();
  const remove = useDeletePhoto();
  const share = useSharePhoto();
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [caption, setCaption] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const data = list.data;
  if (!data) return list.isError ? <LoadError compact onRetry={() => void list.refetch()} /> : null;
  const enabled = data.uploadMode !== null;
  if (onlyWhenOn && !enabled) return null;

  const pick = (picked: FileList | null) => {
    if (!picked) return;
    setFiles(Array.from(picked).filter((f) => f.type.startsWith("image/")).slice(0, data.perDay));
    setJobs([]);
  };
  const setJob = (i: number, state: JobState) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, state } : j)));
  const send = async () => {
    if (!consent || !files.length) return;
    setBusy(true);
    setJobs(files.map((f) => ({ name: f.name, preview: URL.createObjectURL(f), state: "preparing" })));
    for (const [i, file] of files.entries()) {
      try {
        setJob(i, "preparing");
        const status = await share(file, { playerId, index: i, caption, presigned: data.uploadMode === "presigned" });
        setJob(i, status);
      } catch {
        setJob(i, "failed");
      }
    }
    setBusy(false);
    setFiles([]);
    setCaption("");
    void list.refetch();
  };
  const jobLabel = (s: JobState) =>
    s === "preparing" ? t("ph_preparing") : s === "checking" ? t("ph_checking") : s === "approved" ? `✓ ${t("ph_done_shared")}` : s === "needs_review" || s === "pending" ? t("ph_done_review") : s === "rejected" || s === "hidden" ? t("ph_done_blocked") : t("ph_failed");

  return (
    <section className="card stack" aria-labelledby={titleId} data-testid="my-photos">
      <ScopeTag />
      <h2 id={titleId}>{t("ph_title")}</h2>
      <p className="muted small">{t("ph_sub")}</p>
      {!enabled ? (
        <p className="muted">{t("ph_not_configured")}</p>
      ) : (
        <>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files)} data-testid="photo-camera" />
          <input ref={library} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} data-testid="photo-library" />
          <div className="actions">
            <button type="button" className="button" disabled={busy} onClick={() => camera.current?.click()}>{t("ph_take")}</button>
            <button type="button" className="button" disabled={busy} onClick={() => library.current?.click()}>{t("ph_choose")}</button>
          </div>
          {files.length > 0 && (
            <div className="stack-tight">
              <p className="small">{t("ph_count", { n: files.length })} · {t("ph_limit")}</p>
              <label className="field">
                <span>{t("ph_caption")}</span>
                <input maxLength={140} value={caption} onChange={(e) => setCaption(e.target.value)} />
              </label>
              <label className="choice">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span className="small">{t("ph_consent")}</span>
              </label>
              <div>
                <button type="button" className="button button-primary" disabled={!consent || busy} aria-busy={busy} onClick={() => void send()}>
                  {busy ? t("ph_uploading") : t("ph_upload", { n: files.length })}
                </button>
              </div>
            </div>
          )}
          {jobs.length > 0 && (
            <ul className="photo-jobs" aria-live="polite">
              {jobs.map((j, i) => (
                <li key={i}>
                  <img src={j.preview} alt="" />
                  <span className={`small photo-${j.state === "approved" ? "ok" : j.state === "failed" || j.state === "rejected" || j.state === "hidden" ? "bad" : "wait"}`}>{jobLabel(j.state)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {data.photos.length === 0 ? (
        <p className="muted">{t("ph_empty")}</p>
      ) : (
        <ul className="photo-grid">
          {data.photos.map((ph) => {
            const [key, tone] = STATUS[ph.status];
            return (
              <li key={ph.id} className="photo-tile">
                {ph.status === "rejected" ? <div className="photo-blocked small">{t("ph_blocked_note")}</div> : <img src={ph.thumbUrl} alt={ph.caption ?? ""} loading="lazy" decoding="async" />}
                <div className="photo-foot">
                  <span className={`small photo-${tone}`}>{t(key)}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("ph_delete")}
                    disabled={remove.isPending && remove.variables === ph.id}
                    onClick={() => window.confirm(t("ph_delete_confirm")) && remove.mutate(ph.id)}
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
