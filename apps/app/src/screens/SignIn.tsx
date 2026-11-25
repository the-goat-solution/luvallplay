// Sign-in: email, then the 6-digit code (the same codes as the web).
// Text-message sign-in plugs in here later (api.auth.smsStart / smsVerify).
import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, store } from "../app.ts";
import { signInErrorKey as errorKey } from "../lib/signin-errors.ts";
import type { AppKey } from "@luvallplay/i18n/app";
import { LuvallplayMark, Notice, OnLuvallplay, useLook } from "../Frame.tsx";
import { useLang, useT, type ClubConfig } from "../hooks.tsx";

/** The form itself; `club` is set on a club's invite link (the club to open after sign-in). */
export function SignInForm({ club }: { club?: string }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppKey | null>(null);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.auth.emailStart({ email, lang });
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
      await navigate({ to: session.needsDetails ? "/welcome" : "/me" });
    } catch (err) {
      setError(errorKey(err, "signin_err_code"));
      setBusy(false);
    }
  }

  if (step === "email") {
    return (
      <form className="card stack" onSubmit={sendCode} noValidate>
        <h2>{t("signin_title")}</h2>
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
      <h2>{t("signin_code_title")}</h2>
      <p className="muted">{t("signin_code_lead", { email: email.trim() })}</p>
      <label className="field">
        <span>{t("signin_code")}</span>
        <input className="code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      </label>
      {error && <Notice tone="error">{t(error)}</Notice>}
      <button className="button button-primary" type="submit" disabled={busy || code.length < 6}>
        {busy ? t("signin_verifying") : t("signin_verify")}
      </button>
      <button className="button button-quiet" type="button" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
        {t("signin_change_email")}
      </button>
    </form>
  );
}

/** A full-page frame for signed-out screens. With `club`, it wears that club's look and name. */
export function SignedOutPage({ club, children }: { club: ClubConfig | null; children: React.ReactNode }) {
  useLook(club);
  const t = useT(club);
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
            <LuvallplayMark size={56} />
            <h1>{t("brand")}</h1>
          </>
        )}
      </header>
      <main className="signed-out-main">{children}</main>
      <footer>{club ? <OnLuvallplay /> : null}</footer>
    </div>
  );
}

export function SignInScreen() {
  return (
    <SignedOutPage club={null}>
      <SignInForm />
    </SignedOutPage>
  );
}
