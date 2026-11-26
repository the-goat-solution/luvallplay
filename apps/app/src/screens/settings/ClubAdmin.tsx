// "Club admin": asks the API for a single-use link (about a minute) and
// opens the club's admin with it, already signed in; the app's own token
// never leaves the app. Someone who signed in more than 12 hours ago
// confirms with an emailed code first, right here, and the new session
// replaces the old one on this device.
import { useId, useState, type FormEvent } from "react";
import { openOutside } from "../../lib/native/open.ts";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@luvallplay/api/client";
import type { AppKey } from "@luvallplay/i18n/app";
import { api, apiForClub, store } from "../../app.ts";
import { useLang, useT } from "../../hooks.tsx";
import { signInErrorKey } from "../../lib/signin-errors.ts";

type Step = "idle" | "opening" | "confirm" | "code";

/** `apiBase`: with several clubs, the club's own API opens its admin. */
export function ClubAdmin({ clubName, email, apiBase }: { clubName: string; email: string | undefined; apiBase?: string }) {
  const t = useT();
  const lang = useLang();
  const queryClient = useQueryClient();
  const titleId = useId();
  const [step, setStep] = useState<Step>("idle");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppKey | null>(null);

  const open = async () => {
    setError(null);
    setStep("opening");
    try {
      const { url } = await (apiBase ? apiForClub(apiBase) : api).account.adminHandoff({});
      openOutside(url);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === "step_up") return setStep("confirm");
      setError(code === "forbidden" ? "admin_forbidden" : err instanceof ApiError && err.offline ? "offline" : "error_generic");
      setStep("idle");
    }
  };

  const sendCode = async () => {
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.emailStart({ email, lang });
      setStep("code");
    } catch (err) {
      setError(signInErrorKey(err, "signin_err_send"));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.auth.emailVerify({ email, code: code.trim() });
      store.set({ token: session.token });
      void queryClient.invalidateQueries();
      setCode("");
      await open();
    } catch (err) {
      setError(signInErrorKey(err, "signin_err_code"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby={titleId}>
      <h2 className="title" id={titleId}>{clubName}</h2>
      {step === "confirm" || step === "code" ? (
        <>
          <p>{t("admin_step_up", { email: email ?? "" })}</p>
          {step === "confirm" ? (
            <div className="actions">
              <button className="button button-primary" type="button" disabled={busy || !email} onClick={() => void sendCode()}>
                {busy ? t("signin_sending") : t("admin_send_code")}
              </button>
              <button className="button button-quiet" type="button" onClick={() => setStep("idle")}>
                {t("cancel")}
              </button>
            </div>
          ) : (
            <form className="stack" onSubmit={confirm}>
              <label className="field">
                <span>{t("signin_code")}</span>
                <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              </label>
              <div className="actions">
                <button className="button button-primary" type="submit" disabled={busy || code.length !== 6}>
                  {busy ? t("signin_verifying") : t("admin_confirm")}
                </button>
                <button className="button button-quiet" type="button" onClick={() => { setStep("idle"); setCode(""); }}>
                  {t("cancel")}
                </button>
              </div>
            </form>
          )}
        </>
      ) : (
        <>
          <div>
            <button className="button" type="button" disabled={step === "opening"} aria-describedby="club-admin-hint" onClick={() => void open()}>
              {step === "opening" ? t("admin_opening") : t("settings_club_admin")}
            </button>
          </div>
          <p className="muted small" id="club-admin-hint">{t("settings_club_admin_hint")}</p>
        </>
      )}
      {error && <p className="notice notice-error" role="alert">{t(error)}</p>}
    </section>
  );
}
