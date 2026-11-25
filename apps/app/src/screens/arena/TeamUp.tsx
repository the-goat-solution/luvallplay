// Pairing, as on the website: a QR invite (a link that pairs whoever opens
// it), scanning a partner's QR with the camera, or a 5-digit code read out
// and typed in. The QR and scanner libraries load only when used.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useArenaAction, errorCode } from "./data.ts";
import type { ArenaT } from "./words.ts";

type Code = { code: string; expiresAt: string };
const JOIN = /[?&]join=(\d{12})\b/;

/** m:ss left until `expiresAt`, ticking; null once expired. */
function useCountdown(expiresAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const left = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  return left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : null;
}

export function inviteUrl(code: string): string {
  return `${window.location.origin}/arena?join=${code}`;
}

function CodeTiles({ code }: { code: string }) {
  return (
    <p className="code-tiles" aria-label={code.split("").join(" ")}>
      {code.split("").map((d, i) => (
        <span key={i} className={i === 2 ? "tile tile-gap" : "tile"} aria-hidden="true">{d}</span>
      ))}
    </p>
  );
}

function Invite({ t, onError }: { t: ArenaT; onError: (code: string) => void }) {
  const action = useArenaAction();
  const [code, setCode] = useState<Code | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const left = useCountdown(code?.expiresAt ?? null);
  const make = () =>
    action.mutate({ action: "pair_invite" }, {
      onSuccess: async (r) => {
        if (!r.code) return;
        setCode(r.code);
        const QR = await import("qrcode");
        setQr(await QR.toDataURL(inviteUrl(r.code.code), { margin: 1, width: 440, errorCorrectionLevel: "M" }));
      },
      onError: (e) => onError(errorCode(e)),
    });
  useEffect(make, []); // eslint-disable-line react-hooks/exhaustive-deps
  const url = code ? inviteUrl(code.code) : "";
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: t("invite_text"), url });
      else {
        await navigator.clipboard?.writeText(url);
        setCopied(true);
      }
    } catch {
      // Closed the share sheet.
    }
  };
  if (code && !left) {
    return (
      <div className="stack">
        <p className="muted">{t("code_expired")}</p>
        <div><button type="button" className="button" onClick={make}>{t("new_code")}</button></div>
      </div>
    );
  }
  return (
    <div className="stack invite">
      {qr ? <img className="qr" src={qr} width={220} height={220} alt={t("invite_btn")} /> : <div className="qr skeleton" aria-hidden="true" />}
      <p className="muted small">{t("invite_ready")}</p>
      {left && <p className="muted small" role="timer">{t("code_expires", { s: left })}</p>}
      {!link ? (
        <div><button type="button" className="button button-quiet" onClick={() => setLink(true)}>{t("invite_link_instead")}</button></div>
      ) : (
        <div className="actions">
          <label className="field grow">
            <span>{t("invite_link")}</span>
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" className="button" onClick={() => void share()}>{copied ? t("invite_copied") : t("invite_share")}</button>
        </div>
      )}
    </div>
  );
}

function Scan({ t, onError, onDone }: { t: ArenaT; onError: (code: string) => void; onDone: () => void }) {
  const action = useArenaAction();
  const video = useRef<HTMLVideoElement>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
        const [{ default: jsQR }, s] = await Promise.all([import("jsqr"), navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })]);
        stream = s;
        if (stopped || !video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        const tick = () => {
          if (stopped) return;
          const v = video.current;
          if (v && ctx && v.videoWidth) {
            const scale = Math.min(1, 640 / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            const m = found?.data.match(JOIN);
            if (m) {
              stopped = true;
              action.mutate({ action: "pair_join", code: m[1] }, { onSuccess: onDone, onError: (e) => onError(errorCode(e)) });
              return;
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        setDenied(true);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (denied) return <p className="notice notice-error" role="alert">{t("scan_denied")}</p>;
  return (
    <div className="stack">
      <video ref={video} className="scanner" playsInline muted aria-label={t("scan_hint")} />
      <p className="muted small">{t("scan_hint")}</p>
    </div>
  );
}

function ShowCode({ t, onError }: { t: ArenaT; onError: (code: string) => void }) {
  const action = useArenaAction();
  const [code, setCode] = useState<Code | null>(null);
  const left = useCountdown(code?.expiresAt ?? null);
  const make = () => action.mutate({ action: "pair_code" }, { onSuccess: (r) => r.code && setCode(r.code), onError: (e) => onError(errorCode(e)) });
  useEffect(make, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      {code && left ? (
        <>
          <CodeTiles code={code.code} />
          <p className="muted small" role="timer">{t("code_expires", { s: left })}</p>
        </>
      ) : (
        code && <p className="muted">{t("code_expired")}</p>
      )}
      <p className="muted small">{t("code_hint")}</p>
      <div><button type="button" className="button" disabled={action.isPending} onClick={make}>{t("new_code")}</button></div>
    </div>
  );
}

function EnterCode({ t, onError }: { t: ArenaT; onError: (code: string) => void }) {
  const action = useArenaAction();
  const [code, setCode] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    action.mutate({ action: "pair_enter", code }, { onError: (err) => onError(errorCode(err)) });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        <span>{t("code_label")}</span>
        <input className="code-input" inputMode="numeric" autoComplete="off" maxLength={5} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 5))} />
      </label>
      <div><button type="submit" className="button button-primary" disabled={code.length !== 5 || action.isPending}>{t("team_btn")}</button></div>
    </form>
  );
}

type Mode = "home" | "invite" | "scan" | "show" | "enter";

/** The "Team up" card for someone without a partner. */
export function TeamUp({ t, onError, onJoined }: { t: ArenaT; onError: (code: string) => void; onJoined: () => void }) {
  const [mode, setMode] = useState<Mode>("home");
  const [more, setMore] = useState(false);
  const fail = (code: string) => {
    onError(code);
    if (mode === "scan") setMode("home");
  };
  return (
    <section className="card stack arena-me" aria-labelledby="team-title" id="arena-me">
      <h2 id="team-title">{t("team_title")}</h2>
      <p className="muted">{t("team_body")}</p>
      {mode === "home" ? (
        <>
          <div className="actions">
            <button type="button" className="button button-primary" onClick={() => setMode("invite")}>{t("invite_btn")}</button>
            <button type="button" className="button" onClick={() => setMode("scan")}>{t("scan_btn")}</button>
          </div>
          {!more ? (
            <div><button type="button" className="button button-quiet" onClick={() => setMore(true)}>{t("other_ways")}</button></div>
          ) : (
            <div className="actions">
              <button type="button" className="button" onClick={() => setMode("show")}>{t("show_code")}</button>
              <button type="button" className="button" onClick={() => setMode("enter")}>{t("enter_code")}</button>
            </div>
          )}
        </>
      ) : (
        <>
          {mode === "invite" && <Invite t={t} onError={fail} />}
          {mode === "scan" && <Scan t={t} onError={fail} onDone={onJoined} />}
          {mode === "show" && <ShowCode t={t} onError={fail} />}
          {mode === "enter" && <EnterCode t={t} onError={fail} />}
          <div><button type="button" className="button button-quiet" onClick={() => setMode("home")}>{t("cancel")}</button></div>
        </>
      )}
    </section>
  );
}
