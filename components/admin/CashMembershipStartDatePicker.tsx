"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MEMBERSHIP_DAY_TO_DOW,
  MEMBERSHIP_START_SEARCH_DAYS,
  type MembershipDay,
} from "@/lib/constants";
import { formatDateLong, getClubTodayDate, getDayName, toDateKey } from "@/lib/dates";

const MONTH_NAMES = [
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
const DOW_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// Admin-side calendar for picking a cash membership's exact start date —
// modeled on components/modals/SessionCalendarPicker.tsx (reuses its
// sess-cal-*/sess-d* CSS in app/globals.css) but independent of AppContext
// and the public booking-window/cutoff rules, since an admin assigning a
// membership isn't a customer booking a casual session.
export function CashMembershipStartDatePicker({ day }: { day: MembershipDay }) {
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => getClubTodayDate(now), [now]);
  const maxMonth = useMemo(() => {
    const max = new Date(today);
    max.setDate(max.getDate() + MEMBERSHIP_START_SEARCH_DAYS);
    return new Date(max.getFullYear(), max.getMonth(), 1);
  }, [today]);

  const [calDate, setCalDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [sessionDates, setSessionDates] = useState<Record<string, true>>({});
  const [spotsByDate, setSpotsByDate] = useState<Record<string, number>>({});

  // A date picked while on "friday" is never valid once switched to
  // "wednesday" (or vice versa) — drop it so a stale selection can't be
  // silently submitted.
  useEffect(() => {
    setSelected(null);
  }, [day]);

  useEffect(() => {
    const y = calDate.getFullYear();
    const m = calDate.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const from = toDateKey(new Date(y, m, 1));
    const to = toDateKey(new Date(y, m, daysInMonth));
    const dow = MEMBERSHIP_DAY_TO_DOW[day];
    let cancelled = false;

    fetch(`/api/sessions?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((data: { sessions?: { date: string }[] }) => {
        if (cancelled) return;
        const map: Record<string, true> = {};
        for (const s of data.sessions ?? []) {
          const [yy, mm, dd] = s.date.split("-").map(Number);
          if (new Date(yy, mm - 1, dd).getDay() === dow) map[s.date] = true;
        }
        setSessionDates(map);
      })
      .catch(() => {
        if (!cancelled) setSessionDates({});
      });

    return () => {
      cancelled = true;
    };
  }, [calDate, day]);

  useEffect(() => {
    const keys = Object.keys(sessionDates);
    if (keys.length === 0) {
      setSpotsByDate({});
      return;
    }
    let cancelled = false;
    fetch(`/api/spots?dates=${keys.join(",")}`)
      .then((r) => r.json())
      .then((data: { spots?: Record<string, number> }) => {
        if (!cancelled) setSpotsByDate(data.spots ?? {});
      })
      .catch(() => {
        if (!cancelled) setSpotsByDate({});
      });
    return () => {
      cancelled = true;
    };
  }, [sessionDates]);

  const y = calDate.getFullYear();
  const m = calDate.getMonth();
  const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const canPrev = calDate > minMonth;
  const canNext = calDate < maxMonth;
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayMs = today.getTime();

  const cells: React.ReactNode[] = [];
  DOW_NAMES.forEach((d) => cells.push(<div key={d} className="sess-dn">{d}</div>));
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`e${i}`} className="sess-d empty" />);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d);
    const dateMs = date.getTime();
    const key = toDateKey(date);
    const isSessionDay = Boolean(sessionDates[key]);
    const isPast = dateMs < todayMs;
    const spots = isSessionDay ? (spotsByDate[key] ?? 0) : 0;
    const isFull = isSessionDay && spots <= 0;
    const isOpen = isSessionDay && !isPast && !isFull;
    const isSel = key === selected;

    if (isOpen) {
      cells.push(
        <div
          key={d}
          className={`sess-d game-open${isSel ? " sel" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => setSelected(isSel ? null : key)}
        >
          {d}
        </div>,
      );
    } else if (isSessionDay && isFull && !isPast) {
      cells.push(
        <div key={d} className="sess-d game-locked" title="Full — no room for another member">
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

  const selectedDateObj = selected
    ? (() => {
        const [yy, mm, dd] = selected.split("-").map(Number);
        return new Date(yy, mm - 1, dd);
      })()
    : null;

  return (
    <div>
      <input type="hidden" name="startDate" value={selected ?? ""} />
      <div className="sess-cal-nav">
        <button
          type="button"
          className="sess-cal-nav-btn"
          disabled={!canPrev}
          style={!canPrev ? { opacity: 0.3, pointerEvents: "none" } : undefined}
          onClick={() => setCalDate((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
        >
          &#8249;
        </button>
        <div className="sess-cal-nav-month">
          {MONTH_NAMES[m]} {y}
        </div>
        <button
          type="button"
          className="sess-cal-nav-btn"
          disabled={!canNext}
          style={!canNext ? { opacity: 0.3, pointerEvents: "none" } : undefined}
          onClick={() => setCalDate((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
        >
          &#8250;
        </button>
      </div>
      <div className="sess-cal-grid">{cells}</div>
      <div className="sess-cal-legend">
        <div className="sess-legend-item">
          <div className="sess-legend-dot" style={{ background: "var(--navy)", opacity: 0.7 }} />
          Open
        </div>
        <div className="sess-legend-item">
          <div className="sess-legend-dot" style={{ border: "2px dashed var(--steel)" }} />
          Full
        </div>
      </div>
      {selectedDateObj && (
        <div className="selected-session-box">
          <div className="selected-session-label">
            {getDayName(selectedDateObj, "en")}, {formatDateLong(selectedDateObj, "en")}
          </div>
          <button
            type="button"
            onClick={() => setSelected(null)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #1a2a4a",
              background: "#fff",
              color: "#1a2a4a",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
