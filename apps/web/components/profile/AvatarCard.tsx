"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useProfileT } from "@/lib/profile-i18n";
import { BusyLabel } from "./BusyLabel";
import styles from "./profile.module.css";

const SIZE = 512;

/** Centre-crops and shrinks a photo to a SIZE×SIZE square (WebP, or JPEG where WebP can't be made). */
async function squareImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    const as = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.88));
    const webp = await as("image/webp");
    const blob = webp && webp.type === "image/webp" ? webp : await as("image/jpeg");
    if (!blob) throw new Error("encode");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Avatar({ url, initials, px = 44, className }: { url: string | null; initials: string; px?: number; className?: string }) {
  return url ? (
    <img src={url} alt="" width={px} height={px} className={className} style={{ width: px, height: px, borderRadius: "50%", objectFit: "cover" }} />
  ) : (
    <span className={className} style={{ width: px, height: px }}>
      {initials}
    </span>
  );
}

export function AvatarCard({ url, initials }: { url: string | null; initials: string }) {
  const { tr } = useProfileT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(url);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setMsg(null);
    setBusy("save");
    try {
      const blob = await squareImage(file);
      const form = new FormData();
      form.append("file", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg");
      const res = await fetch("/api/profile/avatar", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "failed");
      setPreview(data.url);
      setMsg({ ok: true, text: tr("av_saved") });
      router.refresh();
    } catch (err) {
      const code = (err as Error).message;
      setMsg({ ok: false, text: tr(code === "not_configured" ? "av_not_configured" : code === "encode" || code === "EncodingError" ? "av_bad_photo" : "av_failed") });
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setMsg(null);
    setBusy("remove");
    const res = await fetch("/api/profile/avatar", { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      setPreview(null);
      setMsg({ ok: true, text: tr("av_removed") });
      router.refresh();
    } else setMsg({ ok: false, text: tr("av_failed") });
  };

  return (
    <section className={styles.card} aria-labelledby="avatar-title">
      <h2 id="avatar-title" className={styles.cardTitle}>
        {tr("av_title")}
      </h2>
      <div className={styles.avatarRow}>
        <Avatar url={preview} initials={initials} px={88} className={styles.avatarBig} />
        <div className={styles.avatarActions}>
          <p className={styles.small} style={{ margin: 0 }}>
            {tr("av_sub")}
          </p>
          <div className={styles.btnRow}>
            <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={busy !== null} onClick={() => input.current?.click()}>
              <BusyLabel busy={busy === "save"}>{tr(preview ? "av_change" : "av_add")}</BusyLabel>
            </button>
            {preview && (
              <button type="button" className={`${styles.btn} ${styles.secondary}`} disabled={busy !== null} onClick={remove}>
                <BusyLabel busy={busy === "remove"}>{tr("av_remove")}</BusyLabel>
              </button>
            )}
          </div>
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0])} />
      {msg && <div className={msg.ok ? styles.success : styles.error} style={{ marginTop: 12 }}>{msg.text}</div>}
    </section>
  );
}
