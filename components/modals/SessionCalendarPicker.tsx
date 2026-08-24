"use client";

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { SESSION_CAPACITY } from "@/lib/constants";
import {
  formatDateLong,
  getDayName,
  isBookable,
  isWithinBookingLock,
  startOfDay,
  toDateKey,
} from "@/lib/dates";

export function SessionCalendarPicker() {
  const { lang, tr } = useLanguage();
  const {
    selectedSession,
    setSelectedSession,
    spotsByDate,
    refreshSpots,
    sessionDates,
    refreshSessionDates,
  } = useApp();
  const today = useMemo(() => startOfDay(new Date()), []);
  const [calDate, setCalDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );

  useEffect(() => {
    const y = calDate.getFullYear();
    const m = calDate.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const from = toDateKey(new Date(y, m, 1));
    const to = toDateKey(new Date(y, m, daysInMonth));
    refreshSessionDates(from, to);
  }, [calDate, refreshSessionDates]);

  useEffect(() => {
    const y = calDate.getFullYear();
    const m = calDate.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const keys: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m, d);
      const key = toDateKey(date);
      if (date >= today && sessionDates[key]) keys.push(key);
    }
    if (keys.length > 0) refreshSpots(keys);
  }, [calDate, today, sessionDates, refreshSpots]);

  const monthNamesEn = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthNamesVi = [
    "Tháng 1",
    "Tháng 2",
    "Tháng 3",
    "Tháng 4",
    "Tháng 5",
    "Tháng 6",
    "Tháng 7",
    "Tháng 8",
    "Tháng 9",
    "Tháng 10",
    "Tháng 11",
    "Tháng 12",
  ];

  const y = calDate.getFullYear();
  const m = calDate.getMonth();
  const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const canPrev = calDate > minMonth;
  const dn =
    lang === "vi"
      ? ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]
      : ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayMs = today.getTime();
  const selMs = selectedSession
    ? startOfDay(selectedSession).getTime()
    : null;

  const cells: React.ReactNode[] = [];
  dn.forEach((d) => cells.push(<div key={d} className="sess-dn">{d}</div>));
  for (let i = 0; i < firstDay; i++)
    cells.push(<div key={`e${i}`} className="sess-d empty" />);

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d);
    const dateMs = startOfDay(date).getTime();
    const isSessionDay = Boolean(sessionDates[toDateKey(date)]);
    const isPast = dateMs < todayMs;
    const locked = isSessionDay && !isPast && isWithinBookingLock(date, today);
    const open = isSessionDay && !isPast && isBookable(date, today);
    const spots = isSessionDay
      ? (spotsByDate[toDateKey(date)] ?? SESSION_CAPACITY)
      : 0;
    const isFull = spots === 0;
    const isSel = isSessionDay && selMs === dateMs;

    if (open && !isFull) {
      cells.push(
        <div
          key={d}
          className={`sess-d game-open${isSel ? " sel" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => setSelectedSession(new Date(y, m, d))}
        >
          {d}
        </div>,
      );
    } else if (open && isFull) {
      cells.push(
        <div key={d} className="sess-d game-locked" title={tr("session_full")}>
          {d}
        </div>,
      );
    } else if (locked) {
      cells.push(
        <div key={d} className="sess-d game-locked" title={tr("sess_closed_legend")}>
          {d}
        </div>,
      );
    } else if (isPast) {
      cells.push(
        <div key={d} className="sess-d past">
          {d}
        </div>,
      );
    } else {
      cells.push(
        <div key={d} className="sess-d">
          {d}
        </div>,
      );
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 14 }}>
        {tr("sess_pick_hint")}
      </p>
      <div className="sess-cal-nav">
        <button
          type="button"
          className="sess-cal-nav-btn"
          disabled={!canPrev}
          style={!canPrev ? { opacity: 0.3, pointerEvents: "none" } : undefined}
          onClick={() =>
            setCalDate((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
          }
        >
          &#8249;
        </button>
        <div className="sess-cal-nav-month">
          {lang === "vi" ? monthNamesVi[m] : monthNamesEn[m]} {y}
        </div>
        <button
          type="button"
          className="sess-cal-nav-btn"
          onClick={() =>
            setCalDate((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
          }
        >
          &#8250;
        </button>
      </div>
      <div className="sess-cal-grid">{cells}</div>
      <div className="sess-cal-legend">
        <div className="sess-legend-item">
          <div
            className="sess-legend-dot"
            style={{ background: "var(--navy)", opacity: 0.7 }}
          />
          {tr("sess_avail_legend")}
        </div>
        <div className="sess-legend-item">
          <div
            className="sess-legend-dot"
            style={{ border: "2px dashed var(--steel)" }}
          />
          {tr("sess_closed_legend")}
        </div>
      </div>
      {selectedSession && (
        <div className="selected-session-box">
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "var(--bronze)",
                marginBottom: 3,
              }}
            >
              {tr("selected_session")}
            </div>
            <div className="selected-session-label">
              {getDayName(selectedSession, lang)},{" "}
              {formatDateLong(selectedSession, lang)} · {tr("ngc_time")}
            </div>
          </div>
          <div className="selected-session-spots">
            {spotsByDate[toDateKey(selectedSession)] ?? SESSION_CAPACITY}{" "}
            {tr("spots_left")}
          </div>
        </div>
      )}
    </div>
  );
}
