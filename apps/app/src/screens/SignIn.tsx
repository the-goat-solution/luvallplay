// Sign-in: email, then the 6-digit code (the same codes as the web).
// Text-message sign-in plugs in here later (api.auth.smsStart / smsVerify).
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, store } from "../app.ts";
import { appNext } from "../lib/next-path.ts";
import { signInErrorKey as errorKey } from "../lib/signin-errors.ts";
import type { AppKey } from "@luvallplay/i18n/app";
import { LuvallplayMark, Notice, OnLuvallplay, useLook } from "../Frame.tsx";
import { useLang, useT, type ClubConfig } from "../hooks.tsx";

const RESEND_WAIT_S = 30;

/**
 * The form itself; `club` is set on a club's invite link (the club to open
 * after sign-in), `next` is the screen asked for before sign-in (Home if none).
 */
export function SignInForm({ club, next }: { club?: string; next?: string }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppKey | null>(null);
  // "Send a new code": after a pause (the email may just be slow), and said when sent.
  const [resendAt, setResendAt] = useState(0);
  const [wait, setWait] = useState(0);
  const [resent, setResent] = useState(false);
  useEffect(() => {
    // By the clock, not by counting ticks: right again after the phone slept or the tab was away.
    const tick = () => setWait(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    if (resendAt <= Date.now()) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  async function resend() {
    setBusy(true);
    setError(null);
    setResent(false);
    try {
      await api.auth.emailStart({ email, lang });
      setCode("");
      setResent(true);
      setResendAt(Date.now() + RESEND_WAIT_S * 1000);
    } catch (err) {
      setError(errorKey(err, "signin_err_send"));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.auth.emailStart({ email, lang });
      setResent(false);
      setResendAt(Date.now() + RESEND_WAIT_S * 1000);
      setStep("code");
    } catch (err) {
      setError(errorKey(err, "signin_err_invalid_email"));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.auth.emailVerify({ email, code });
      queryClient.clear();
      store.set({ token: session.token, needsDetails: session.needsDetails, ...(club ? { club } : {}) });
      // A brand-new account gives its name first, then goes on to the screen asked for.
      if (session.needsDetails) await navigate({ to: "/welcome", search: next ? { next } : {} });
      else router.history.push(appNext(next));
    } catch (err) {
      setError(errorKey(err, "signin_err_code"));
      setBusy(false);
    }
  }

  if (step === "email") {
    return (
      <form className="card stack" onSubmit={sendCode} noValidate>
        <h2 className="title">{t("signin_title")}</h2>
        <p className="muted">{t("signin_lead")}</p>
        <label className="field">
          <span>{t("signin_email")}</span>
          <input type="email" name="email" autoComplete="email" inputMode="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && <Notice tone="error">{t(error)}</Notice>}
        <button className="button button-primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? t("signin_sending") : t("signin_send")}
        </button>
      </form>
    );
  }
  return (
    <form className="card stack" onSubmit={verify} noValidate>
      <h2 className="title">{t("signin_code_title")}</h2>
      <p className="muted">{t("signin_code_lead", { email: email.trim() })}</p>
      <label className="field">
        <span>{t("signin_code")}</span>
        <input className="code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      </label>
      {error && <Notice tone="error">{t(error)}</Notice>}
      {resent && !error && <Notice>{t("signin_resent", { email: email.trim() })}</Notice>}
      <button className="button button-primary" type="submit" disabled={busy || code.length < 6}>
        {busy ? t("signin_verifying") : t("signin_verify")}
      </button>
      <button className="button button-quiet" type="button" disabled={busy || wait > 0} onClick={() => void resend()}>
        {wait > 0 ? t("signin_resend_wait", { s: wait }) : t("signin_resend")}
      </button>
      <button className="button button-quiet" type="button" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
        {t("signin_change_email")}
      </button>
    </form>
  );
}

/** A full-page frame for signed-out screens. With `club`, it wears that club's look and name. */
export function SignedOutPage({ club, children }: { club: ClubConfig | null; children: React.ReactNode }) {
  const t = useT(club);
  useLook(club, t("signin_title"));
  return (
    <div className="signed-out">
      <header className="signed-out-head">
        {club ? (
          <>
            {club.theme.logoUrl && <img className="club-logo" src={club.theme.logoUrl} alt="" width={72} height={72} />}
            <h1>{club.club.name}</h1>
          </>
        ) : (
          <>
            <LuvallplayMark size={88} brand />
            <h1>{t("brand")}</h1>
            <p className="tagline">{t("brand_tagline")}</p>
          </>
        )}
      </header>
      <main className="signed-out-main">{children}</main>
      <footer className="signed-out-foot">{club ? <OnLuvallplay /> : null}</footer>
    </div>
  );
}

export function SignInScreen() {
  const { next } = useSearch({ from: "/signin" });
  return (
    <SignedOutPage club={null}>
      <SignInForm next={next} />
    </SignedOutPage>
  );
}
