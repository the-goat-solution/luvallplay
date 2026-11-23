"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useProfileT } from "@/lib/profile-i18n";
import type { Lang } from "@/lib/i18n";
import { isMobileDevice } from "@/lib/device";
import { OPEN_INSTALL_GUIDE_EVENT } from "./InstallGuide";
import { Sheet } from "./Sheet";
import { useRecaptcha } from "./useRecaptcha";
import { BusyLabel, Spinner } from "./BusyLabel";
import { useBusyAction } from "./useBusyAction";
import { SignOutForm } from "./SignOutForm";
import { isSmsNumberAllowed, toE164 } from "@/lib/phone";
import styles from "./profile.module.css";

export type AccountPlayer = {
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  customDisplayName: boolean;
  phone: string | null;
  phoneVerified: boolean;
  lang: Lang;
  leaderboardVisible: boolean;
};

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

export function WelcomeCard({ firstName, onDone }: { firstName: string; onDone?: () => void }) {
  const { tr } = useProfileT();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    void postJson("/api/profile/event", { event: "welcome_dismissed" });
    onDone?.();
  };
  return (
    <section className={styles.card} style={{ background: "var(--navy)", color: "var(--cream)" }} aria-labelledby="welcome-title">
      <h2 id="welcome-title" className={styles.sheetTitle} style={{ color: "var(--cream)", margin: "0 0 6px" }}>
        {tr("welcome_title", { name: firstName || "👋" })}
      </h2>
      <p style={{ margin: "0 0 12px", opacity: 0.85, fontSize: 14.5 }}>{tr("welcome_body")}</p>
      <ol style={{ margin: "0 0 16px", paddingLeft: 20, lineHeight: 1.8, fontSize: 14.5 }}>
        <li>{tr("welcome_check_name")}</li>
        <li>{tr("welcome_confirm_phone")}</li>
        <li>{tr("welcome_leaderboard")}</li>
      </ol>
      <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={dismiss}>
        {tr("welcome_dismiss")}
      </button>
    </section>
  );
}

export function DetailsCard({ player }: { player: AccountPlayer }) {
  const { tr } = useProfileT();
  const { setLang } = useLanguage();
  const { refresh, refreshing } = useBusyAction();
  const [form, setForm] = useState({
    firstName: player.firstName,
    lastName: player.lastName,
    displayName: player.customDisplayName ? player.displayName : "",
    phone: player.phone ?? "",
    lang: player.lang,
  });
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty =
    form.firstName !== player.firstName ||
    form.lastName !== player.lastName ||
    form.displayName !== (player.customDisplayName ? player.displayName : "") ||
    form.phone !== (player.phone ?? "") ||
    form.lang !== player.lang;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("saving");
    setError(null);
    const { ok, data } = await postJson("/api/profile/details", {
      ...form,
      displayName: form.displayName || null,
      phone: form.phone || null,
    });
    if (!ok) {
      setState("idle");
      setError(tr(data.error === "invalid_number" ? "login_err_invalid_number" : "login_err_generic"));
      return;
    }
    setLang(form.lang);
    try {
      localStorage.setItem("tw_lang", form.lang);
    } catch {}
    setState("saved");
    refresh();
    window.setTimeout(() => setState("idle"), 2000);
  };

  const defaultName = `${form.firstName.trim()}${form.lastName.trim() ? ` ${form.lastName.trim()[0].toUpperCase()}.` : ""}`;

  return (
    <section className={styles.card} aria-labelledby="details-title">
      <h2 id="details-title" className={styles.cardTitle}>
        {tr("acc_details")}
      </h2>
      {error && <div className={styles.error}>{error}</div>}
      <form onSubmit={save}>
        <div className={styles.field}>
          <label htmlFor="acc-email">{tr("acc_email")}</label>
          <input id="acc-email" className={styles.input} value={player.email} readOnly aria-describedby="acc-email-hint" />
          <span id="acc-email-hint" className={styles.hint}>
            🔒 {tr("acc_email_locked")}
          </span>
        </div>
        <div className={styles.split} style={{ gap: 12, columnGap: 12 }}>
          <div className={styles.field}>
            <label htmlFor="acc-first">{tr("first_name")}</label>
            <input
              id="acc-first"
              className={styles.input}
              autoComplete="given-name"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="acc-last">{tr("last_name")}</label>
            <input
              id="acc-last"
              className={styles.input}
              autoComplete="family-name"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </div>
        </div>
        <div className={styles.field}>
          <label htmlFor="acc-display">{tr("display_name")}</label>
          <input
            id="acc-display"
            className={styles.input}
            maxLength={40}
            placeholder={defaultName}
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <span className={styles.hint}>{tr("display_name_hint", { name: defaultName || "—" })}</span>
        </div>
        <div className={styles.field}>
          <label htmlFor="acc-phone">{tr("phone")}</label>
          <input
            id="acc-phone"
            className={styles.input}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="acc-lang">{tr("language")}</label>
          <select
            id="acc-lang"
            className={styles.select}
            value={form.lang}
            onChange={(e) => setForm({ ...form, lang: e.target.value === "vi" ? "vi" : "en" })}
          >
            <option value="en">English</option>
            <option value="vi">Tiếng Việt</option>
          </select>
        </div>
        <button type="submit" className={`${styles.btn} ${styles.navy} ${styles.btnBlock}`} disabled={!dirty || state === "saving" || refreshing} aria-busy={state === "saving" || refreshing}>
          <BusyLabel busy={state === "saving" || (refreshing && state !== "saved")} busyText={tr("saving")}>
            {state === "saved" ? `✓ ${tr("saved")}` : tr("save")}
          </BusyLabel>
        </button>
      </form>
    </section>
  );
}

export function PhoneCard({
  phone,
  verified,
  smsAvailable,
  smsConfigured,
  recaptchaSiteKey,
}: {
  phone: string | null;
  verified: boolean;
  smsAvailable: boolean;
  smsConfigured: boolean;
  recaptchaSiteKey: string | null;
}) {
  const { tr } = useProfileT();
  const { refresh, refreshing } = useBusyAction();
  const canText = smsAvailable && Boolean(recaptchaSiteKey);
  const { containerRef, getToken } = useRecaptcha(canText ? recaptchaSiteKey : null);
  const [step, setStep] = useState<"idle" | "code" | "done">(verified ? "done" : "idle");
  const [sessionInfo, setSessionInfo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "notice"; text: string } | null>(null);
  const [unavailable, setUnavailable] = useState(!canText);

  if (!phone) return null;
  const textable = isSmsNumberAllowed(toE164(phone));

  const send = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const token = await getToken();
      const { ok, data } = await postJson("/api/auth/sms/start", { phone, recaptchaToken: token, purpose: "phone_confirm" });
      if (!ok) {
        if (data.smsAvailable === false) setUnavailable(true);
        else setMessage({ kind: "error", text: tr(data.error === "invalid_number" ? "login_err_invalid_number" : data.error === "too_many_for_number" ? "login_err_number_limit" : data.error === "region_not_allowed" ? "login_err_region" : data.error === "sms_setup" ? "login_err_sms_setup" : "login_err_generic") });
        return;
      }
      setSessionInfo(data.sessionInfo as string);
      setStep("code");
    } catch {
      setMessage({ kind: "error", text: tr("login_err_captcha") });
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { ok, data } = await postJson("/api/auth/sms/verify", { sessionInfo, code, purpose: "phone_confirm" });
    setBusy(false);
    if (!ok) {
      setMessage({
        kind: "error",
        text: tr(data.error === "phone_taken" ? "acc_phone_taken" : data.error === "expired" ? "login_err_expired" : "login_err_invalid"),
      });
      return;
    }
    setStep("done");
    setMessage({ kind: "notice", text: tr("acc_phone_confirmed_now") });
    refresh();
  };

  return (
    <section className={styles.card}>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <strong>{phone}</strong>
          <span className={styles.small}>{step === "done" ? `✓ ${tr("acc_phone_confirmed")}` : tr("acc_phone_unconfirmed")}</span>
        </div>
        {step === "idle" && !unavailable && textable && (
          <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={send} disabled={busy} aria-busy={busy}>
            <BusyLabel busy={busy} busyText={tr("sending")}>
              {tr("acc_confirm_phone")}
            </BusyLabel>
          </button>
        )}
      </div>
      {step === "idle" && unavailable && smsConfigured && textable && <p className={styles.small}>{tr("acc_confirm_phone_later")}</p>}
      {step === "idle" && !textable && smsConfigured && <p className={styles.small}>{tr("acc_phone_nz_only")}</p>}
      {message && <div className={message.kind === "error" ? styles.error : styles.success} style={{ marginTop: 12 }}>{message.text}</div>}
      {step === "code" && (
        <form onSubmit={verify} style={{ marginTop: 12 }}>
          <p className={styles.small} style={{ marginBottom: 8 }}>
            {tr("acc_phone_confirm_sent", { to: phone })}
          </p>
          <div className={styles.btnRow}>
            <input
              className={`${styles.input} ${styles.codeInput}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-label={tr("login_code_label")}
            />
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy || refreshing || code.length !== 6} aria-busy={busy || refreshing}>
              <BusyLabel busy={busy || refreshing}>{tr("continue")}</BusyLabel>
            </button>
          </div>
        </form>
      )}
      <div ref={containerRef} />
    </section>
  );
}

export function PrivacyCard({ leaderboardVisible }: { leaderboardVisible: boolean }) {
  const { tr } = useProfileT();
  const { replace, refreshing: leaving } = useBusyAction();
  const [visible, setVisible] = useState(leaderboardVisible);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const toggle = async (next: boolean) => {
    setVisible(next);
    setToggling(true);
    const { ok } = await postJson("/api/profile/privacy", { leaderboardVisible: next });
    setToggling(false);
    if (!ok) setVisible(!next);
  };

  const deleteAccount = async () => {
    setBusy(true);
    setDeleteError(null);
    const { ok, data } = await postJson("/api/profile/delete", { confirm: confirmText });
    setBusy(false);
    if (ok) replace("/login?signed_out=1");
    else setDeleteError(tr(data.error === "last_owner" ? "acc_delete_last_owner" : "login_err_generic"));
  };

  return (
    <section className={styles.card} aria-labelledby="privacy-title">
      <h2 id="privacy-title" className={styles.cardTitle}>
        {tr("acc_privacy")}
      </h2>
      <label className={styles.row} style={{ cursor: "pointer" }}>
        <span className={styles.rowText}>
          <strong>{tr("acc_leaderboard_toggle")}</strong>
          <span className={styles.small}>{tr("acc_leaderboard_hint")}</span>
        </span>
        {toggling && <Spinner />}
        <span className={styles.switch}>
          <input type="checkbox" role="switch" checked={visible} disabled={toggling} aria-busy={toggling} onChange={(e) => toggle(e.target.checked)} />
          <span className={styles.switchTrack} />
        </span>
      </label>
      <hr className={styles.divider} />
      <div className={styles.btnRow}>
        <a className={`${styles.btn} ${styles.secondary}`} href="/api/profile/export">
          {tr("acc_download")}
        </a>
        <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={() => setDeleteOpen(true)}>
          {tr("acc_delete")}
        </button>
      </div>
      <Sheet open={deleteOpen} onClose={() => setDeleteOpen(false)} title={tr("acc_delete")}>
        <p className={styles.muted} style={{ marginBottom: 14 }}>
          {tr("acc_delete_confirm")}
        </p>
        {deleteError && <div className={styles.error}>{deleteError}</div>}
        <div className={styles.field}>
          <label htmlFor="delete-confirm">{tr("acc_delete_type")}</label>
          <input
            id="delete-confirm"
            className={styles.input}
            autoCapitalize="characters"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </div>
        <div className={styles.btnRow}>
          <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={() => setDeleteOpen(false)}>
            {tr("cancel")}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.danger}`}
            disabled={confirmText.trim().toUpperCase() !== "DELETE" || busy || leaving}
            aria-busy={busy || leaving}
            onClick={deleteAccount}
          >
            <BusyLabel busy={busy || leaving}>{tr("acc_delete")}</BusyLabel>
          </button>
        </div>
      </Sheet>
    </section>
  );
}

export function AppCard() {
  const { tr } = useProfileT();
  // "Add to Home Screen" is for phones and tablets only. Known after mount
  // (the server can't tell), so it never flashes on desktop.
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(isMobileDevice()), []);
  return (
    <section className={styles.card}>
      {mobile && (
        <>
          <div className={styles.row}>
            <img src="/icons/icon-192.png" alt="" width={48} height={48} style={{ borderRadius: 12 }} />
            <div className={styles.rowText}>
              <strong>{tr("acc_install")}</strong>
              <span className={styles.small}>{tr("acc_install_hint")}</span>
            </div>
          </div>
          <button
            type="button"
            className={`${styles.btn} ${styles.secondary} ${styles.btnBlock}`}
            style={{ marginTop: 10 }}
            onClick={() => window.dispatchEvent(new Event(OPEN_INSTALL_GUIDE_EVENT))}
          >
            {tr("acc_install")}
          </button>
          <hr className={styles.divider} />
        </>
      )}
      <div className={styles.rowText} style={{ marginBottom: 10 }}>
        <strong>{tr("acc_devices")}</strong>
        <span className={styles.small}>{tr("acc_devices_hint")}</span>
      </div>
      <div className={styles.btnRow}>
        <SignOutForm action="/api/auth/logout" className={`${styles.btn} ${styles.secondary} ${styles.btnBlock}`}>
          {tr("sign_out")}
        </SignOutForm>
        <SignOutForm action="/api/auth/logout?all=1" className={`${styles.btn} ${styles.danger} ${styles.btnBlock}`}>
          {tr("sign_out_all")}
        </SignOutForm>
      </div>
    </section>
  );
}
