"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { useProfileT, type ProfileKey } from "@/lib/profile-i18n";
import { useRecaptcha } from "./useRecaptcha";
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
  notice: "expired" | "signed_out" | null;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(
    notice === "expired" ? tr("login_expired_link") : notice === "signed_out" ? tr("login_signed_out") : null,
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
    if (data.needsDetails) {
      router.replace(`/login/details?next=${encodeURIComponent(target)}`);
    } else {
      router.replace(target);
    }
    router.refresh();
  };

  const startEmail = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return showError("invalid_email");
    setBusy(true);
    const res = await postJson("/api/auth/email/start", { email: email.trim(), next, lang, turnstileToken });
    setBusy(false);
    if (!res.ok) return showError(res.data.error as string);
    setMethod("email");
    setCode("");
    setStep("code");
  };

  const startSms = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    if (phone.replace(/\D/g, "").length < 7) return showError("invalid_number");
    setBusy(true);
    let token: string;
    try {
      token = await getToken();
    } catch {
      setBusy(false);
      return showError("captcha");
    }
    const res = await postJson("/api/auth/sms/start", { phone, recaptchaToken: token, purpose: "login" });
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

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) return showError("invalid");
    setBusy(true);
    if (method === "email") {
      const res = await postJson("/api/auth/email/verify", { email: email.trim(), code: digits, next, phoneProof });
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

  // Auto-submit once six digits are in (typed, pasted or autofilled).
  useEffect(() => {
    if (step === "code" && code.replace(/\D/g, "").length === 6 && !busy) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

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
          <TurnstileWidget onToken={onTurnstile} />
          <button type="submit" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={busy}>
            {busy ? "…" : tr("login_email_btn")}
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
            <input
              id="login-phone"
              className={styles.input}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="021 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <button type="submit" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={busy}>
            {busy ? "…" : tr("login_sms_btn")}
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
                : tr("login_code_sent_sms", { to: phone })}
            </span>
            <button type="button" className={styles.linkBtn} onClick={() => setStep("enter")}>
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
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
            />
          </div>
          <button type="submit" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={busy}>
            {busy ? "…" : tr("login_verify_btn")}
          </button>
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {method === "sms" && !smsAvailable ? null : (
              <button type="button" className={styles.linkBtn} onClick={resend} disabled={busy}>
                {tr("login_resend")}
              </button>
            )}
            {method === "sms" && (
              <button type="button" className={styles.linkBtn} onClick={switchToEmail}>
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
