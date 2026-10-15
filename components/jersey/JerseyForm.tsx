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
    if (!f.size) return setError("Please choose your size.");
    if (addPrint && (!printName.trim() || printNumber === "")) {
      return setError("Add a print name and number, or untick the printing option.");
    }
    if (!consent) return setError("Please tick the box to confirm you understand the payment rules.");
    setBusy(true);
    try {
      const res = await fetch("/api/jersey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          addPrint,
          printName: addPrint ? printName : undefined,
          printNumber: addPrint ? Number(printNumber) : undefined,
          deviceId: deviceId(),
          turnstileToken: token || undefined,
          consent: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      setDone(data as Done);
      window.scrollTo({ top: document.getElementById("register")?.offsetTop ?? 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const deadline = done.expiresAt
      ? new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "full", timeStyle: "short" }).format(new Date(done.expiresAt))
      : null;
    return (
      <div className="jersey-card" role="status">
        <h3 className="jersey-card-title">You&apos;re registered! 🎉</h3>
        <p>
          Transfer <strong>{formatDollars(done.priceCents)}</strong> to secure your jersey. We&apos;ve also emailed these details.
        </p>
        <div className="jersey-code">
          <div className="jersey-code-lbl">Your reference code</div>
          <div className="jersey-code-num">{done.refCode}</div>
        </div>
        <BankDetails refCode={done.refCode} />
        <p className="jersey-warn">
          Please put <strong>{done.refCode}</strong> in the <strong>reference</strong> field of your bank transfer. It&apos;s how we match your
          payment to you automatically — without it we may not be able to find your transfer and you could lose your spot. Thank you! 🙏
        </p>
        {done.earlyBird && deadline ? (
          <p style={{ fontSize: 14 }}>
            Your $15 early-bird price is held until <strong>{deadline}</strong>. After that, an unpaid spot is released to the next person.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form className="jersey-card" onSubmit={submit} noValidate={false}>
      <fieldset disabled={!open || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {!open ? <p className="jersey-warn">Registration isn&apos;t open yet — the form unlocks when the countdown ends.</p> : null}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="j-first">First name <span className="form-required">*</span></label>
            <input id="j-first" className="form-input" required maxLength={80} autoComplete="given-name" value={f.firstName} onChange={set("firstName")} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="j-last">Last name <span className="form-required">*</span></label>
            <input id="j-last" className="form-input" required maxLength={80} autoComplete="family-name" value={f.lastName} onChange={set("lastName")} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="j-email">Email <span className="form-required">*</span></label>
          <input id="j-email" type="email" className="form-input" required maxLength={200} autoComplete="email" value={f.email} onChange={set("email")} />
          <div className="form-hint">One jersey per person, one registration per email. Your reference code is sent here.</div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="j-phone">Phone <span className="form-required">*</span></label>
            <input id="j-phone" type="tel" className="form-input" required minLength={6} maxLength={30} autoComplete="tel" value={f.phone} onChange={set("phone")} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="j-size">Size <span className="form-required">*</span></label>
            <select id="j-size" className="form-input" required value={f.size} onChange={set("size")}>
              <option value="" disabled>Choose a size</option>
              {JERSEY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="form-hint">Check the size chart above. Between sizes? Size up.</div>
          </div>
        </div>

        <label className="jersey-check">
          <input type="checkbox" checked={addPrint} onChange={(e) => setAddPrint(e.target.checked)} />
          <span>Add my name &amp; number on the back <strong>(+{formatDollars(PRINT_CENTS)})</strong></span>
        </label>
        {addPrint ? (
          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="j-pname">Name on back</label>
              <input id="j-pname" className="form-input" maxLength={PRINT_NAME_MAX} value={printName} onChange={(e) => setPrintName(e.target.value.toUpperCase())} />
              <div className="form-hint">Up to {PRINT_NAME_MAX} characters.</div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="j-pnum">Number</label>
              <input id="j-pnum" type="number" min={0} max={99} className="form-input" value={printNumber} onChange={(e) => setPrintNumber(e.target.value)} />
              <div className="form-hint">0–99.</div>
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
            I&apos;ll pay by bank transfer using my reference code. I understand any amount over the price goes to club funds and there are
            no refunds{left > 0 ? ", and that my $15 spot is released if unpaid after 48 hours" : ""}.
          </span>
        </label>

        {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? <div style={{ marginTop: 16 }}><TurnstileWidget onToken={setToken} /></div> : null}

        <div className="jersey-total">
          <span>Total to pay</span>
          <strong>{formatDollars(total)}</strong>
        </div>
        {error ? <div className="form-error" role="alert" style={{ fontSize: 14, marginBottom: 12 }}>{error}</div> : null}
        <button type="submit" className="btn btn-primary btn-full">{busy ? "Registering…" : "Register & get my code"}</button>
      </fieldset>
    </form>
  );
}
