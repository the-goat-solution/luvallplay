"use client";

import { useClub } from "@/context/ClubContext";
import { useEffect, useMemo, useState } from "react";
import {
  MEMBERSHIP_DAY_TO_DOW,
  MEMBERSHIP_START_SEARCH_DAYS,
  type MembershipDay,
} from "@/lib/constants";
import { formatDateLong, getClubTodayDate, getDayName, toDateKey } from "@/lib/dates";
import { LoadingIcon } from "@/components/LoadingIcon";

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
const NO_SPOTS: Record<string, number> = {};
const NO_MINI_GAMES: Record<string, boolean> = {};

// Admin-side calendar for picking a cash membership's exact start date —
// modeled on components/modals/SessionCalendarPicker.tsx (reuses its
// sess-cal-*/sess-d* CSS in app/globals.css) but independent of AppContext
// and the public booking-window/cutoff rules, since an admin assigning a
// membership isn't a customer booking a casual session.
export function CashMembershipStartDatePicker({ day }: { day: MembershipDay }) {
  const now = useMemo(() => new Date(), []);
  const club = useClub();
  const today = useMemo(() => getClubTodayDate(now, club.clock), [now, club.clock]);
  const maxMonth = useMemo(() => {
    const max = new Date(today);
    max.setDate(max.getDate() + MEMBERSHIP_START_SEARCH_DAYS);
    return new Date(max.getFullYear(), max.getMonth(), 1);
  }, [today]);

  const [calDate, setCalDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selected, setSelected] = useState<string | null>(null);
  // The play days fetched for one (calDate, day) request. Results for any
  // other month/day are ignored, so sessionDates is null while this month's
  // play days are still loading — distinct from {} ("loaded, none this
  // month"), so the calendar never briefly claims a month has no available
  // dates just because the request hasn't returned.
  const [sessionResult, setSessionResult] = useState<{
    calDate: Date;
    day: MembershipDay;
    dates: Record<string, true>;
  } | null>(null);
  const sessionDates =
    sessionResult && sessionResult.calDate === calDate && sessionResult.day === day
      ? sessionResult.dates
      : null;
  // Open spots fetched for one sessionDates object. Mini game days report 0
  // casual spots, but members are always included.
  const [spotsResult, setSpotsResult] = useState<{
    dates: Record<string, true>;
    spots: Record<string, number>;
    miniGame: Record<string, boolean>;
  } | null>(null);
  const spotsReady = spotsResult !== null && spotsResult.dates === sessionDates;
  const spotsByDate = spotsReady ? spotsResult.spots : NO_SPOTS;
  const miniGameByDate = spotsReady ? spotsResult.miniGame : NO_MINI_GAMES;
  const spotsLoading =
    sessionDates !== null && Object.keys(sessionDates).length > 0 && !spotsReady;

  // A date picked for one weekday is never valid once switched to
  // another — drop it so a stale selection can't be
  // silently submitted.
  const [prevDay, setPrevDay] = useState(day);
  if (day !== prevDay) {
    setPrevDay(day);
    setSelected(null);
  }

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
        setSessionResult({ calDate, day, dates: map });
      })
      .catch(() => {
        if (!cancelled) setSessionResult({ calDate, day, dates: {} });
      });

    return () => {
      cancelled = true;
    };
  }, [calDate, day]);

  useEffect(() => {
    if (sessionDates === null) return;
    const keys = Object.keys(sessionDates);
    // No play days this month: nothing to load (spotsLoading is false).
    if (keys.length === 0) return;
    let cancelled = false;
    fetch(`/api/spots?dates=${keys.join(",")}`)
      .then((r) => r.json())
      .then((data: { spots?: Record<string, number>; miniGame?: Record<string, boolean> }) => {
        if (cancelled) return;
        setSpotsResult({ dates: sessionDates, spots: data.spots ?? {}, miniGame: data.miniGame ?? {} });
      })
      .catch(() => {
        if (cancelled) return;
        setSpotsResult({ dates: sessionDates, spots: {}, miniGame: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionDates]);

  // Until both the play days and their open spots are in, no day can be
  // judged open or full — show that rather than a misleading empty month.
  const loading = sessionDates === null || spotsLoading;

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
    const isSessionDay = Boolean(sessionDates?.[key]);
    const isPast = dateMs < todayMs;
    const spots = isSessionDay ? (spotsByDate[key] ?? 0) : 0;
    const isFull = isSessionDay && spots <= 0 && !miniGameByDate[key];
    const isOpen = isSessionDay && !isPast && !isFull && !loading;
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
    } else if (isSessionDay && isFull && !isPast && !loading) {
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
      <div style={{ position: "relative" }} aria-busy={loading}>
        <div
          className="sess-cal-grid"
          style={loading ? { opacity: 0.45, pointerEvents: "none" } : undefined}
        >
          {cells}
        </div>
        {loading ? (
          <div
            role="status"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontSize: 13,
              color: "#1a2a4a",
              fontWeight: 600,
            }}
          >
            <LoadingIcon size="sm" />
            Loading dates…
          </div>
        ) : null}
      </div>
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
