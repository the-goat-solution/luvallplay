"use client";

import { useEffect, useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import {
  EARLY_BIRD_CENTS,
  JERSEY_SIZES,
  PRINT_CENTS,
  PRINT_NAME_MAX,
  STANDARD_CENTS,
  formatDollars,
} from "@/lib/jersey";
import { useJerseyT } from "@/lib/jersey-i18n";
import { BankDetails } from "./BankDetails";
import { useJerseyClock } from "./useJerseyClock";

type Done = { refCode: string; priceCents: number; earlyBird: boolean; expiresAt: string | null };

function deviceId(): string {
  try {
    const k = "tw-jersey-device";
    let id = localStorage.getItem(k);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(k, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function JerseyForm({
  opensAt,
  serverNow,
  earlyBirdsLeft,
}: {
  opensAt: string;
  serverNow: string;
  earlyBirdsLeft: number;
}) {
  const { tr, lang } = useJerseyT();
  const { open } = useJerseyClock(opensAt, serverNow);
  const [left, setLeft] = useState(earlyBirdsLeft);
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", size: "", website: "" });
  const [addPrint, setAddPrint] = useState(false);
  const [printName, setPrintName] = useState("");
  const [printNumber, setPrintNumber] = useState("");
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    if (!open || done) return;
    const load = () =>
      fetch("/api/jersey", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => typeof d.earlyBirdsLeft === "number" && setLeft(d.earlyBirdsLeft))
        .catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [open, done]);

  const base = left > 0 ? EARLY_BIRD_CENTS : STANDARD_CENTS;
  const total = base + (addPrint ? PRINT_CENTS : 0);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!f.size) return setError(tr("err_size"));
    if (addPrint && (!printName.trim() || printNumber === "")) {
      return setError(tr("err_print"));
    }
    if (!consent) return setError(tr("err_consent"));
    setBusy(true);
    try {
      const res = await fetch("/api/jersey", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-jersey-lang": lang },
        body: JSON.stringify({
          ...f,
          addPrint,
          printName: addPrint ? printName : undefined,
          printNumber: addPrint ? Number(printNumber) : undefined,
          deviceId: deviceId(),
          turnstileToken: token || undefined,
          consent: true,
          lang,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? tr("err_generic"));
      setDone(data as Done);
      window.scrollTo({ top: document.getElementById("register")?.offsetTop ?? 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("err_generic"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const deadline = done.expiresAt
      ? new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "full", timeStyle: "short" }).format(new Date(done.expiresAt))
      : null;
    return (
      <div className="jersey-card" role="status">
        <h3 className="jersey-card-title">{tr("done_h")}</h3>
        <p>{tr("done_p", { price: formatDollars(done.priceCents) })}</p>
        <div className="jersey-code">
          <div className="jersey-code-lbl">{tr("code_lbl")}</div>
          <div className="jersey-code-num">{done.refCode}</div>
        </div>
        <BankDetails refCode={done.refCode} />
        <p className="jersey-warn">{tr("done_warn", { code: done.refCode })}</p>
        {done.earlyBird && deadline ? <p style={{ fontSize: 14 }}>{tr("done_hold", { deadline })}</p> : null}
      </div>
    );
  }

  return (
    <form className="jersey-card" onSubmit={submit} noValidate={false}>
      <fieldset disabled={!open || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {!open ? <p className="jersey-warn">{tr("not_open")}</p> : null}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="j-first">{tr("first")} <span className="form-required">*</span></label>
            <input id="j-first" className="form-input" required maxLength={80} autoComplete="given-name" value={f.firstName} onChange={set("firstName")} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="j-last">{tr("last")} <span className="form-required">*</span></label>
            <input id="j-last" className="form-input" required maxLength={80} autoComplete="family-name" value={f.lastName} onChange={set("lastName")} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="j-email">{tr("email")} <span className="form-required">*</span></label>
          <input id="j-email" type="email" className="form-input" required maxLength={200} autoComplete="email" value={f.email} onChange={set("email")} />
          <div className="form-hint">{tr("email_hint")}</div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="j-phone">{tr("phone")} <span className="form-required">*</span></label>
            <input id="j-phone" type="tel" className="form-input" required minLength={6} maxLength={30} autoComplete="tel" value={f.phone} onChange={set("phone")} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="j-size">{tr("size_f")} <span className="form-required">*</span></label>
            <select id="j-size" className="form-input" required value={f.size} onChange={set("size")}>
              <option value="" disabled>{tr("choose_size")}</option>
              {JERSEY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="form-hint">{tr("size_hint")}</div>
          </div>
        </div>

        <label className="jersey-check">
          <input type="checkbox" checked={addPrint} onChange={(e) => setAddPrint(e.target.checked)} />
          <span>{tr("add_print", { price: `+${formatDollars(PRINT_CENTS)}` })}</span>
        </label>
        {addPrint ? (
          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="j-pname">{tr("print_name")}</label>
              <input id="j-pname" className="form-input" maxLength={PRINT_NAME_MAX} value={printName} onChange={(e) => setPrintName(e.target.value.toUpperCase())} />
              <div className="form-hint">{tr("print_name_hint", { n: PRINT_NAME_MAX })}</div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="j-pnum">{tr("number")}</label>
              <input id="j-pnum" type="number" min={0} max={99} className="form-input" value={printNumber} onChange={(e) => setPrintNumber(e.target.value)} />
              <div className="form-hint">{tr("number_hint")}</div>
            </div>
          </div>
        ) : null}

        {/* Honeypot: people never see or fill this. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}>
          <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></label>
        </div>

        <label className="jersey-check" style={{ marginTop: 18 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            {tr("consent")}
            {left > 0 ? tr("consent_hold") : ""}
          </span>
        </label>

        {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? <div style={{ marginTop: 16 }}><TurnstileWidget onToken={setToken} /></div> : null}

        <div className="jersey-total">
          <span>{tr("total")}</span>
          <strong>{formatDollars(total)}</strong>
        </div>
        {error ? <div className="form-error" role="alert" style={{ fontSize: 14, marginBottom: 12 }}>{error}</div> : null}
        <button type="submit" className="btn btn-primary btn-full">{busy ? tr("submitting") : tr("submit")}</button>
      </fieldset>
    </form>
  );
}
