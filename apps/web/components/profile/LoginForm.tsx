"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import { useRecaptcha } from "./useRecaptcha";
import { BusyLabel } from "./BusyLabel";
import { SMS_COUNTRIES, formatSmsNumber, smsNumberFromLocal } from "@/lib/phone";
import styles from "./profile.module.css";

type Method = "email" | "sms";
type Step = "enter" | "code";

const ERROR_KEY: Record<string, ProfileKey> = {
  invalid_email: "login_err_invalid_email",
  invalid_number: "login_err_invalid_number",
  invalid: "login_err_invalid",
  invalid_code: "login_err_invalid",
  expired: "login_err_expired",
  too_many: "login_err_too_many",
  too_many_attempts: "login_err_too_many",
  captcha: "login_err_captcha",
  captcha_failed: "login_err_captcha",
  too_many_for_number: "login_err_number_limit",
  region_not_allowed: "login_err_region",
  sms_setup: "login_err_sms_setup",
};

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
}

export function LoginForm({
  smsAvailable: smsInitiallyAvailable,
  recaptchaSiteKey,
  next,
  defaultEmail,
  notice,
}: {
  smsAvailable: boolean;
  recaptchaSiteKey: string | null;
  next: string;
  defaultEmail: string;
  notice: "expired" | "signed_out" | "stepup" | null;
}) {
  const { tr, lang } = useProfileT();
  const router = useRouter();
  const [smsAvailable, setSmsAvailable] = useState(smsInitiallyAvailable && Boolean(recaptchaSiteKey));
  const [method, setMethod] = useState<Method>("email");
  const [step, setStep] = useState<Step>("enter");
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sessionInfo, setSessionInfo] = useState<string | null>(null);
  const [phoneProof, setPhoneProof] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  // Turnstile tokens are single-use: remount the widget after each send so
  // "Send a new code" and retries get a fresh one.
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [working, setBusy] = useState(false);
  // Signing in navigates to the profile; keep the spinner until it has loaded.
  const [navigating, startNavigation] = useTransition();
  const busy = working || navigating;
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(
    notice === "expired" ? tr("login_expired_link") : notice === "signed_out" ? tr("login_signed_out") : notice === "stepup" ? tr("login_stepup") : null,
  );
  const codeRef = useRef<HTMLInputElement>(null);
  const { containerRef, getToken } = useRecaptcha(smsAvailable ? recaptchaSiteKey : null);
  const onTurnstile = useCallback((t: string) => setTurnstileToken(t), []);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const showError = (key: string | undefined) => {
    setError(tr(ERROR_KEY[key ?? ""] ?? "login_err_generic"));
  };

  const finish = (data: Record<string, unknown>) => {
    const target = typeof data.next === "string" ? data.next : next;
    if (data.phoneTaken) sessionStorage.setItem("tw_phone_taken", "1");
    startNavigation(() => {
      router.replace(data.needsDetails ? `/login/details?next=${encodeURIComponent(target)}` : target);
      router.refresh();
    });
  };

  const startEmail = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return showError("invalid_email");
    setBusy(true);
    const res = await postJson("/api/auth/email/start", { email: email.trim(), next, lang, turnstileToken });
    setBusy(false);
    setTurnstileToken("");
    setTurnstileKey((k) => k + 1);
    if (!res.ok) return showError(res.data.error as string);
    setMethod("email");
    setCode("");
    setStep("code");
  };

  const startSms = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    const e164 = smsNumberFromLocal(phone);
    if (!e164) {
      setError(tr("login_err_nz_mobile"));
      return;
    }
    setBusy(true);
    let token: string;
    try {
      token = await getToken();
    } catch {
      setBusy(false);
      return showError("captcha");
    }
    const res = await postJson("/api/auth/sms/start", { phone: e164, recaptchaToken: token, purpose: "login" });
    setBusy(false);
    if (!res.ok) {
      if (res.data.smsAvailable === false) {
        // The free texts ran out between loading the page and tapping:
        // fall back to email, keeping anything already typed.
        setSmsAvailable(false);
        setMethod("email");
        setStep("enter");
        setInfo(tr("login_sms_unavailable_switch"));
        return;
      }
      return showError(res.data.error as string);
    }
    setSessionInfo(res.data.sessionInfo as string);
    setCode("");
    setStep("code");
  };

  const verify = async (e?: React.FormEvent, typedCode: string = code) => {
    e?.preventDefault();
    setError(null);
    const digits = typedCode.replace(/\D/g, "");
    if (digits.length !== 6) return showError("invalid");
    setBusy(true);
    if (method === "email") {
      const res = await postJson("/api/auth/email/verify", { email: email.trim(), code: digits, next, ...(phoneProof ? { phoneProof } : {}) });
      setBusy(false);
      if (!res.ok) return showError(res.data.error as string);
      return finish(res.data);
    }
    const res = await postJson("/api/auth/sms/verify", { sessionInfo, code: digits, next, purpose: "login" });
    setBusy(false);
    if (!res.ok) return showError(res.data.error as string);
    if (res.data.needsEmail) {
      // New number: confirm an email next; the proof attaches the number.
      setPhoneProof(res.data.phoneProof as string);
      setMethod("email");
      setStep("enter");
      setInfo(tr("login_phone_needs_email"));
      return;
    }
    finish(res.data);
  };

  const onCodeChange = (value: string) => {
    const nextCode = value.replace(/[^\d]/g, "").slice(0, 6);
    setCode(nextCode);
    // Auto-submit once six digits are in (typed, pasted or autofilled) —
    // only when the code actually changed, as before.
    if (nextCode !== code && step === "code" && nextCode.replace(/\D/g, "").length === 6 && !busy) {
      void verify(undefined, nextCode);
    }
  };

  const resend = async () => {
    setCode("");
    if (method === "email") await startEmail();
    else await startSms();
  };

  const switchToEmail = () => {
    setMethod("email");
    setStep("enter");
    setError(null);
  };

  return (
    <div>
      <h1 className={styles.authTitle}>{tr("login_title")}</h1>
      <p className={styles.authSub}>{tr("login_sub")}</p>

      {info && <div className={styles.notice} role="status">{info}</div>}
      {error && <div className={styles.error} role="alert">{error}</div>}

      {step === "enter" && method === "email" && (
        <form onSubmit={startEmail} noValidate>
          <div className={styles.field}>
            <label htmlFor="login-email">{tr("login_email")}</label>
            <input
              id="login-email"
              className={styles.input}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <TurnstileWidget key={turnstileKey} onToken={onTurnstile} />
          <button type="submit" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={busy} aria-busy={busy}>
            <BusyLabel busy={busy} busyText={tr("sending")}>
              {tr("login_email_btn")}
            </BusyLabel>
          </button>
          {smsAvailable && !phoneProof && (
            <>
              <div className={styles.orRow}>{tr("login_or")}</div>
              <button
                type="button"
                className={`${styles.btn} ${styles.secondary} ${styles.btnBlock}`}
                onClick={() => {
                  setMethod("sms");
                  setError(null);
                  setInfo(null);
                }}
              >
                {tr("login_sms_btn")}
              </button>
            </>
          )}
        </form>
      )}

      {step === "enter" && method === "sms" && (
        <form onSubmit={startSms} noValidate>
          <div className={styles.field}>
            <label htmlFor="login-phone">{tr("login_phone")}</label>
            {/* New Zealand only for now (lib/phone.ts SMS_COUNTRIES). */}
            <div className={styles.phoneField}>
              <span className={styles.phonePrefix} aria-label={`${tr("login_phone_country")}: ${SMS_COUNTRIES[0].name} +${SMS_COUNTRIES[0].dial}`}>
                <span aria-hidden="true">{SMS_COUNTRIES[0].flag}</span> +{SMS_COUNTRIES[0].dial}
              </span>
              <input
                id="login-phone"
                className={styles.input}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={SMS_COUNTRIES[0].example}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
          </div>
          <button type="submit" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={busy} aria-busy={busy}>
            <BusyLabel busy={busy} busyText={tr("sending")}>
              {tr("login_sms_btn")}
            </BusyLabel>
          </button>
          <div style={{ textAlign: "center", marginTop: 10 }}>
            <button type="button" className={styles.linkBtn} onClick={switchToEmail}>
              {tr("login_use_email")}
            </button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verify} noValidate>
          <div className={styles.sentTo}>
            <span>
              {method === "email"
                ? tr("login_code_sent_email", { to: email.trim() })
                : tr("login_code_sent_sms", { to: formatSmsNumber(smsNumberFromLocal(phone) ?? phone) })}
            </span>
            <button type="button" className={styles.linkBtn} onClick={() => setStep("enter")} disabled={busy}>
              {tr("login_change")}
            </button>
          </div>
          <div className={styles.field}>
            <label htmlFor="login-code">{tr("login_code_label")}</label>
            <input
              id="login-code"
              ref={codeRef}
              className={`${styles.input} ${styles.codeInput}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              // Lets iOS and Android offer the code straight from Messages/Mail.
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              readOnly={busy}
              onChange={(e) => onCodeChange(e.target.value)}
            />
          </div>
          <button type="submit" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={busy} aria-busy={busy}>
            <BusyLabel busy={busy} busyText={navigating ? tr("signing_in") : tr("working")}>
              {tr("login_verify_btn")}
            </BusyLabel>
          </button>
          {method === "email" && (
            <div style={{ marginTop: 12 }}>
              <TurnstileWidget key={turnstileKey} onToken={onTurnstile} />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {method === "sms" && !smsAvailable ? null : (
              <button type="button" className={styles.linkBtn} onClick={resend} disabled={busy}>
                {tr("login_resend")}
              </button>
            )}
            {method === "sms" && (
              <button type="button" className={styles.linkBtn} onClick={switchToEmail} disabled={busy}>
                {tr("login_resend_email_instead")}
              </button>
            )}
          </div>
        </form>
      )}

      <p className={styles.small} style={{ textAlign: "center", marginTop: 18 }}>
        {tr("login_secure_note")}
      </p>
      {/* Invisible reCAPTCHA mounts here when texting a code. */}
      <div ref={containerRef} />
    </div>
  );
}
