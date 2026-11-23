"use client";

import { CLUB_TIME_ZONE } from "@/lib/constants";
import { useMemo, useState } from "react";
import { useProfileT } from "@/lib/profile-i18n";
import { StripeCardForm } from "../LazyStripeCardForm";
import { Sheet } from "../Sheet";
import { BusyLabel, Spinner } from "../BusyLabel";
import { useBusyAction } from "../useBusyAction";
import styles from "../profile.module.css";
import { fmtDate, postJson } from "./format";

export type CalDay = {
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  spots: number;
  closed: boolean;
  paused: boolean;
  bookable: boolean;
  included: boolean;
  absent: boolean;
  booked: boolean;
};

function timeRange(start: string | null, end: string | null, lang: string): string {
  if (!start) return "";
  const opts: Intl.DateTimeFormatOptions = { timeZone: CLUB_TIME_ZONE, hour: "numeric", minute: "2-digit" };
  const loc = lang === "vi" ? "vi-VN" : "en-NZ";
  const s = new Date(start).toLocaleTimeString(loc, opts);
  return end ? `${s} – ${new Date(end).toLocaleTimeString(loc, opts)}` : s;
}

export function PlayCalendar({
  days,
  player,
  casualPriceNzd,
}: {
  days: CalDay[];
  player: { firstName: string; lastName: string; email: string; phone: string };
  casualPriceNzd: number;
}) {
  const { tr, lang } = useProfileT();
  const { refresh } = useBusyAction();
  const [state, setState] = useState(days);
  const [booking, setBooking] = useState<CalDay | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const byMonth = useMemo(() => {
    const groups = new Map<string, CalDay[]>();
    for (const d of state) {
      const key = d.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    return [...groups.entries()];
  }, [state]);

  const toggleAbsence = async (d: CalDay) => {
    setBusyDate(d.date);
    setMessage(null);
    const res = await postJson("/api/profile/absence", { date: d.date, absent: !d.absent });
    setBusyDate(null);
    if (!res.ok) {
      setMessage({ kind: "error", text: tr("mem_err_generic") });
      return;
    }
    setState((s) => s.map((x) => (x.date === d.date ? { ...x, absent: !d.absent } : x)));
    if (!d.absent) setMessage({ kind: "success", text: tr("cal_absence_saved") });
  };

  const startBooking = async (d: CalDay) => {
    setBusyDate(d.date);
    setBooking(d);
    setClientSecret(null);
    setMessage(null);
    const res = await postJson("/api/create-payment-intent", {
      sessionDate: d.date,
      firstName: player.firstName || "Player",
      lastName: player.lastName || "-",
      email: player.email,
      phone: player.phone || undefined,
    });
    setBusyDate(null);
    if (!res.ok) {
      setBooking(null);
      setMessage({ kind: "error", text: tr("cal_booking_failed") });
      return;
    }
    setClientSecret(res.data.clientSecret as string);
  };

  const onPaid = () => {
    if (!booking) return;
    const date = booking.date;
    setState((s) => s.map((x) => (x.date === date ? { ...x, booked: true, spots: Math.max(0, x.spots - 1) } : x)));
    setMessage({ kind: "success", text: tr("cal_booked_done", { date: fmtDate(date, lang) }) });
    setBooking(null);
    setClientSecret(null);
    window.setTimeout(() => refresh(), 2500);
  };

  return (
    <section className={styles.card} aria-labelledby="cal-title">
      <h2 id="cal-title" className={styles.cardTitle}>
        {tr("cal_title")}
      </h2>
      <p className={styles.small} style={{ marginBottom: 12 }}>
        {tr("cal_sub")}
      </p>
      {message && <div className={message.kind === "error" ? styles.error : styles.success}>{message.text}</div>}
      {state.length === 0 && <p className={styles.muted}>{tr("cal_none")}</p>}

      {byMonth.map(([month, list]) => (
        <div key={month} style={{ marginBottom: 8 }}>
          <div className={styles.label} style={{ margin: "10px 0 6px", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 11 }}>
            {new Date(`${month}-01T00:00:00Z`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", { timeZone: "UTC", month: "long", year: "numeric" })}
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
            {list.map((d) => {
              const dt = new Date(`${d.date}T00:00:00Z`);
              return (
                <li key={d.date} className={styles.row} style={{ background: "var(--cream)", borderRadius: 14, padding: "8px 10px", alignItems: "center" }}>
                  <div
                    aria-hidden="true"
                    style={{
                      width: 50,
                      flexShrink: 0,
                      textAlign: "center",
                      background: d.included && !d.absent ? "var(--navy)" : "#fff",
                      color: d.included && !d.absent ? "#fff" : "var(--navy)",
                      borderRadius: 12,
                      padding: "6px 0",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.8 }}>
                      {dt.toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", { timeZone: "UTC", weekday: "short" })}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>{dt.getUTCDate()}</div>
                  </div>
                  <div className={styles.rowText}>
                    <strong style={{ fontSize: 14.5 }}>
                      {d.included ? (d.absent ? tr("cal_absent") : `✓ ${tr("cal_included")}`) : d.booked ? `✓ ${tr("cal_booked")}` : timeRange(d.startTime, d.endTime, lang) || fmtDate(d.date, lang)}
                    </strong>
                    <span className={styles.small} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {(d.included || d.booked) && timeRange(d.startTime, d.endTime, lang)}
                      {!(d.included || d.booked) && (d.paused ? tr("cal_paused") : d.closed ? tr("cal_closed") : d.spots > 0 ? tr("cal_spots", { n: d.spots }) : tr("cal_full"))}
                      {d.location ? ` · ${d.location}` : ""}
                    </span>
                  </div>
                  {d.included ? (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.ghost}`}
                      style={{ fontSize: 13, padding: "0 10px" }}
                      disabled={busyDate === d.date}
                      aria-busy={busyDate === d.date}
                      onClick={() => toggleAbsence(d)}
                    >
                      <BusyLabel busy={busyDate === d.date}>{d.absent ? tr("cal_undo_absence") : tr("cal_cant_make_it")}</BusyLabel>
                    </button>
                  ) : d.booked ? null : d.bookable && !d.paused && !d.closed && d.spots > 0 ? (
                    <button type="button" className={`${styles.btn} ${styles.primary}`} style={{ minHeight: 44, padding: "0 14px", fontSize: 14 }} disabled={busyDate === d.date} aria-busy={busyDate === d.date} onClick={() => startBooking(d)}>
                      <BusyLabel busy={busyDate === d.date}>{tr("cal_book")}</BusyLabel>
                    </button>
                  ) : (
                    <span className={styles.small} style={{ whiteSpace: "nowrap" }}>
                      {!d.bookable ? tr("cal_not_open") : ""}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <Sheet
        open={Boolean(booking)}
        onClose={() => {
          setBooking(null);
          setClientSecret(null);
        }}
        title={tr("cal_book_title")}
      >
        {booking && (
          <>
            <p className={styles.muted} style={{ marginBottom: 14 }}>
              {tr("cal_book_for", { date: fmtDate(booking.date, lang, true), price: casualPriceNzd })}
              {booking.startTime ? ` · ${timeRange(booking.startTime, booking.endTime, lang)}` : ""}
            </p>
            {clientSecret ? (
              <StripeCardForm clientSecret={clientSecret} amountLabel={tr("mem_pay", { amount: casualPriceNzd })} onSuccess={onPaid} returnPath="/profile" />
            ) : (
              <div className={styles.loadingLine}>
                <Spinner label={tr("loading")} /> {tr("loading")}
              </div>
            )}
          </>
        )}
      </Sheet>
    </section>
  );
}
