"use client";

import { CLUB_TIME_ZONE } from "@/lib/constants";
import { useState } from "react";
import { useProfileT } from "@/lib/profile-i18n";
import type { CalDay } from "../membership/PlayCalendar";
import { fmtDate, postJson } from "../membership/format";
import { BusyLabel } from "../BusyLabel";
import styles from "../profile.module.css";
import m from "./me.module.css";

function timeRange(start: string | null, end: string | null, lang: string): string {
  if (!start) return "";
  const opts: Intl.DateTimeFormatOptions = { timeZone: CLUB_TIME_ZONE, hour: "numeric", minute: "2-digit" };
  const loc = lang === "vi" ? "vi-VN" : "en-NZ";
  const s = new Date(start).toLocaleTimeString(loc, opts);
  return end ? `${s} – ${new Date(end).toLocaleTimeString(loc, opts)}` : s;
}

/** "Next up": the next play day you're in, with the "I can't make it" toggle for membership days. */
export function NextUpCard({ day }: { day: CalDay | null }) {
  const { tr, lang } = useProfileT();
  const [absent, setAbsent] = useState(day?.absent ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const toggle = async () => {
    if (!day) return;
    setBusy(true);
    setError(false);
    const res = await postJson("/api/profile/absence", { date: day.date, absent: !absent });
    setBusy(false);
    if (res.ok) setAbsent(!absent);
    else setError(true);
  };

  return (
    <section className={`${styles.card} ${m.nextCard}`} aria-labelledby="next-up-title">
      <h2 id="next-up-title" className={styles.cardTitle}>
        {tr("me_next_up")}
      </h2>
      {!day ? (
        <p className={m.nextMeta} style={{ margin: 0 }}>
          {tr("me_next_none")}
        </p>
      ) : (
        <>
          <p className={m.nextDate}>{fmtDate(day.date, lang)}</p>
          <p className={m.nextMeta}>{[timeRange(day.startTime, day.endTime, lang), day.location].filter(Boolean).join(" · ")}</p>
          <span className={m.nextTag}>{day.booked ? tr("me_next_booked") : tr("me_next_included")}</span>
          {absent && <p className={m.nextMeta}>{tr("cal_absent")}</p>}
          {error && <div className={styles.error}>{tr("mem_err_generic")}</div>}
          {day.included && !day.booked && (
            <div>
              <button type="button" className={`${styles.btn} ${absent ? styles.primary : styles.secondary}`} onClick={toggle} disabled={busy} aria-busy={busy} aria-pressed={absent}>
                <BusyLabel busy={busy}>{absent ? tr("cal_undo_absence") : tr("cal_cant_make_it")}</BusyLabel>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
