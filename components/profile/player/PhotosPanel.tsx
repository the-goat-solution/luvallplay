"use client";

import { useRef, useState } from "react";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import type { Photo } from "@/lib/photos-db";
import { BusyLabel, Spinner } from "../BusyLabel";
import { useBusyAction } from "../useBusyAction";
import styles from "../profile.module.css";
import p from "./photos.module.css";

type Job = { name: string; preview: string; state: "preparing" | "uploading" | "checking" | "approved" | "needs_review" | "rejected" | "failed" };

const STATUS: Record<string, { key: ProfileKey; cls: string }> = {
  approved: { key: "ph_status_approved", cls: p.ok },
  needs_review: { key: "ph_status_review", cls: p.wait },
  pending: { key: "ph_status_review", cls: p.wait },
  rejected: { key: "ph_status_rejected", cls: p.bad },
  hidden: { key: "ph_status_hidden", cls: p.bad },
};

/**
 * Share photos from play days. Take one with the camera or pick several
 * from the library; each is prepared in the browser (GPS removed, display
 * copy and thumbnail made), uploaded straight to storage, then checked.
 * Uploads continue if the player switches app briefly.
 */
export function PhotosPanel({
  photos,
  playerId,
  uploadMode,
}: {
  photos: Photo[];
  playerId: number;
  /** null: no public Blob store connected yet (see lib/public-blob.ts). */
  uploadMode: "token" | "presigned" | null;
}) {
  const enabled = uploadMode !== null;
  const { tr } = useProfileT();
  const { refresh } = useBusyAction();
  const [deleting, setDeleting] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [caption, setCaption] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);

  const pick = (list: FileList | null) => {
    if (!list) return;
    setFiles(Array.from(list).filter((f) => f.type.startsWith("image/")).slice(0, 20));
    setJobs([]);
  };

  const setJob = (i: number, state: Job["state"]) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, state } : j)));

  const share = async () => {
    if (!consent || files.length === 0) return;
    setBusy(true);
    setJobs(files.map((f) => ({ name: f.name, preview: URL.createObjectURL(f), state: "preparing" })));
    // Loaded only when sharing, to keep the Player tab light.
    const [blobClient, { preparePhoto }] = await Promise.all([import("@vercel/blob/client"), import("./imagePrep")]);
    // Same route either way; it answers in the flavour the store is set up for.
    // Multipart (for big originals) only with a client token: presigned
    // uploads go up in one request, which Blob accepts up to the 25 MB cap.
    const presigned = uploadMode === "presigned";
    const upload = presigned ? blobClient.uploadPresigned : blobClient.upload;
    for (const [i, file] of files.entries()) {
      try {
        const prepared = await preparePhoto(file);
        setJob(i, "uploading");
        const base = `photos/${playerId}/${Date.now()}-${i}`;
        const opts = { access: "public" as const, handleUploadUrl: "/api/profile/photos/upload" };
        const [original, display, thumb] = await Promise.all([
          upload(`${base}-original.jpg`, prepared.original, { ...opts, multipart: !presigned && prepared.original.size > 8 * 1024 * 1024 }),
          upload(`${base}-display.${prepared.display.type === "image/webp" ? "webp" : "jpg"}`, prepared.display, opts),
          upload(`${base}-thumb.${prepared.thumb.type === "image/webp" ? "webp" : "jpg"}`, prepared.thumb, opts),
        ]);
        setJob(i, "checking");
        const res = await fetch("/api/profile/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originalUrl: original.url,
            displayUrl: display.url,
            thumbUrl: thumb.url,
            width: prepared.width,
            height: prepared.height,
            bytes: prepared.original.size + prepared.display.size + prepared.thumb.size,
            caption: caption.trim() || null,
            consent: true,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { status?: Job["state"] };
        setJob(i, res.ok && data.status ? data.status : "failed");
      } catch (err) {
        console.error("photo upload failed", err);
        setJob(i, "failed");
      }
    }
    setBusy(false);
    setFiles([]);
    setCaption("");
    refresh();
  };

  const remove = async (id: number) => {
    if (!window.confirm(tr("ph_delete_confirm"))) return;
    setDeleting(id);
    await fetch(`/api/profile/photos/${id}`, { method: "DELETE" });
    refresh();
  };

  const jobLabel = (s: Job["state"]) =>
    s === "preparing"
      ? tr("ph_preparing")
      : s === "uploading"
        ? tr("ph_uploading")
        : s === "checking"
          ? tr("ph_checking")
          : s === "approved"
            ? `✓ ${tr("ph_done_shared")}`
            : s === "needs_review"
              ? tr("ph_done_review")
              : s === "rejected"
                ? tr("ph_done_blocked")
                : tr("ph_failed");

  return (
    <section className={styles.card} aria-labelledby="photos-title">
      <h2 id="photos-title" className={styles.cardTitle}>
        {tr("ph_title")}
      </h2>
      <p className={styles.small} style={{ marginBottom: 14 }}>
        {tr("ph_sub")}
      </p>

      {!enabled ? (
        <p className={styles.muted}>{tr("ph_not_configured")}</p>
      ) : (
        <>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files)} />
          <input ref={libraryRef} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
          <div className={styles.btnRow}>
            <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={() => cameraRef.current?.click()} disabled={busy}>
              📷 {tr("ph_take")}
            </button>
            <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={() => libraryRef.current?.click()} disabled={busy}>
              🖼 {tr("ph_choose")}
            </button>
          </div>

          {files.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p className={styles.small} style={{ marginBottom: 8 }}>
                {tr("ph_count", { n: files.length })} · {tr("ph_limit")}
              </p>
              <div className={styles.field}>
                <label htmlFor="ph-caption">{tr("ph_caption")}</label>
                <input id="ph-caption" className={styles.input} maxLength={140} value={caption} onChange={(e) => setCaption(e.target.value)} />
              </div>
              <label className={styles.row} style={{ alignItems: "flex-start", cursor: "pointer", marginBottom: 12 }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2, flexShrink: 0 }} />
                <span className={styles.small} style={{ color: "var(--text-mid)" }}>
                  {tr("ph_consent")}
                </span>
              </label>
              <button type="button" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={!consent || busy} aria-busy={busy} onClick={share}>
                <BusyLabel busy={busy} busyText={tr("ph_uploading")}>
                  {tr("ph_upload", { n: files.length })}
                </BusyLabel>
              </button>
            </div>
          )}

          {jobs.length > 0 && (
            <ul className={p.jobs}>
              {jobs.map((j, i) => (
                <li key={i}>
                  <img src={j.preview} alt="" />
                  <span className={j.state === "approved" ? p.ok : j.state === "rejected" || j.state === "failed" ? p.bad : p.wait}>{jobLabel(j.state)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {photos.length === 0 ? (
        <p className={styles.muted} style={{ marginTop: 14 }}>
          {tr("ph_empty")}
        </p>
      ) : (
        <div className={p.grid}>
          {photos.map((ph) => {
            const st = STATUS[ph.status] ?? STATUS.pending;
            const blocked = ph.status === "rejected";
            return (
              <figure key={ph.id} className={p.tile}>
                {blocked ? <div className={p.blocked}>{tr("ph_blocked_note")}</div> : <img src={ph.thumbUrl} alt={ph.caption ?? ""} loading="lazy" decoding="async" />}
                <figcaption>
                  <span className={st.cls}>{tr(st.key)}</span>
                  <button type="button" onClick={() => remove(ph.id)} aria-label={tr("ph_delete")} disabled={deleting === ph.id} aria-busy={deleting === ph.id}>
                    {deleting === ph.id ? <Spinner /> : "×"}
                  </button>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}
