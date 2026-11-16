"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProfileT } from "@/lib/profile-i18n";
import styles from "./profile.module.css";

export function DetailsForm({ next, email, phone: initialPhone, lang: initialLang }: { next: string; email: string; phone: string; lang: "en" | "vi" }) {
  const { tr, lang } = useProfileT();
  const router = useRouter();
  const [firstName, setFirst] = useState("");
  const [lastName, setLast] = useState("");
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/profile/details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, phone: phone || null, lang: lang ?? initialLang }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(tr(data.error === "invalid_number" ? "login_err_invalid_number" : "login_err_generic"));
      return;
    }
    router.replace(next);
    router.refresh();
  };

  return (
    <form onSubmit={submit}>
      <h1 className={styles.authTitle}>{tr("details_title")}</h1>
      <p className={styles.authSub}>{tr("details_sub")}</p>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.field}>
        <label htmlFor="d-email">{tr("acc_email")}</label>
        <input id="d-email" className={styles.input} value={email} readOnly />
      </div>
      <div className={styles.field}>
        <label htmlFor="d-first">{tr("first_name")}</label>
        <input id="d-first" className={styles.input} autoComplete="given-name" value={firstName} onChange={(e) => setFirst(e.target.value)} required />
      </div>
      <div className={styles.field}>
        <label htmlFor="d-last">{tr("last_name")}</label>
        <input id="d-last" className={styles.input} autoComplete="family-name" value={lastName} onChange={(e) => setLast(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="d-phone">{tr("phone")}</label>
        <input id="d-phone" className={styles.input} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="021 123 4567" />
      </div>
      <button type="submit" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={busy || !firstName.trim()}>
        {busy ? tr("saving") : tr("continue")}
      </button>
    </form>
  );
}
