"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useApp } from "@/context/AppContext";
import { Trans } from "@/components/Trans";
import { LoadingIcon } from "@/components/LoadingIcon";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import { SESSION_CAPACITY } from "@/lib/constants";
import { pickLocale } from "@/lib/sanity";
import type { CmsScheduleSettings } from "@/lib/sanity-queries";
import {
  formatDateLong,
  formatEventTimeRange,
  getClubTodayDate,
  getDayName,
  isBookable,
  isMembershipDay,
  isWithinBookingLock,
  startOfDay,
  toDateKey,
} from "@/lib/dates";

export function Schedule({
  scheduleSettings,
  calendarSubscribe,
}: {
  scheduleSettings?: CmsScheduleSettings;
  calendarSubscribe?: { googleUrl: string; icsUrl: string };
}) {
  const { lang, tr } = useLanguage();
  const {
    schedulePick,
    setSchedulePick,
    spotsByDate,
    signedUpByDate,
    refreshSpots,
    sessionDates,
    sessionDatesLoading,
    refreshSessionDates,
    openWaitlistModal,
    setSelectedSession,
    setOpenModal,
  } = useApp();
  const showLoading = useDelayedLoading(sessionDatesLoading);

  // `now` is the real current instant — required by isBookable/
  // isWithinBookingLock so the 5pm NZ cutoff check reads the actual current
  // NZ hour. `today` is derived from it via the club's NZ calendar day (not
  // the browser's local midnight) for date-only comparisons below.
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => getClubTodayDate(now), [now]);
  const sortedUpcomingKeys = useMemo(() => {
    const todayKey = toDateKey(today);
    return Object.keys(sessionDates)
      .filter((key) => key >= todayKey)
      .sort();
  }, [sessionDates, today]);
  const nextSessionDate = useMemo(() => {
    const key = sortedUpcomingKeys[0];
    if (!key) return null;
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [sortedUpcomingKeys]);
  const displayDate = schedulePick ?? nextSessionDate;

  const [calDate, setCalDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );

  const venueLabel = scheduleSettings?.venueName
    ? pickLocale(scheduleSettings.venueName, lang)
    : "";
  const addressLabel = scheduleSettings?.address
    ? pickLocale(scheduleSettings.address, lang)
    : "";
  const timeLabel = scheduleSettings?.timeLabel
    ? pickLocale(scheduleSettings.timeLabel, lang)
    : "";

  const dateKey = displayDate ? toDateKey(displayDate) : null;
  const sessionInfo = dateKey ? sessionDates[dateKey] : undefined;
  const maxSpots = sessionInfo?.maxSpots ?? scheduleSettings?.maxCasualSpots ?? SESSION_CAPACITY;
  const displayTimeLabel = sessionInfo?.eventStartTime
    ? formatEventTimeRange(sessionInfo.eventStartTime, sessionInfo.eventEndTime)
    : timeLabel;
  const displayLocation = sessionInfo?.eventLocation || null;
  const spotsAvail =
    dateKey && spotsByDate[dateKey] !== undefined ? spotsByDate[dateKey] : maxSpots;
  const signedUp = dateKey && signedUpByDate[dateKey] !== undefined
    ? signedUpByDate[dateKey]
    : 0;

  const withinLock = displayDate ? isWithinBookingLock(displayDate, now) : false;
  const bookable = displayDate ? isBookable(displayDate, now) : false;
  const isFull = spotsAvail <= 0;
  const isNextGame =
    displayDate && nextSessionDate
      ? startOfDay(displayDate).getTime() === startOfDay(nextSessionDate).getTime()
      : false;

  useEffect(() => {
    const from = toDateKey(today);
    const to = toDateKey(new Date(today.getFullYear(), today.getMonth() + 4, 0));
    refreshSessionDates(from, to);
  }, [today, refreshSessionDates]);

  useEffect(() => {
    if (sortedUpcomingKeys.length > 0) refreshSpots(sortedUpcomingKeys);
  }, [sortedUpcomingKeys, refreshSpots]);

  const handleBook = useCallback(() => {
    if (!displayDate || !bookable) return;
    if (isFull) {
      openWaitlistModal(displayDate);
      return;
    }
    setSelectedSession(new Date(displayDate));
    setOpenModal("booking");
  }, [
    bookable,
    displayDate,
    isFull,
    openWaitlistModal,
    setOpenModal,
    setSelectedSession,
  ]);

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

  const renderCalendar = () => {
    const y = calDate.getFullYear();
    const m = calDate.getMonth();
    const dn = lang === "vi"
      ? ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]
      : ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: React.ReactNode[] = [];

    dn.forEach((name) => {
      cells.push(
        <div key={`h-${name}`} className="cal-dn">
          {name}
        </div>,
      );
    });

    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`e-${i}`} className="cal-d empty" />);
    }

    const todayMs = today.getTime();
    const nextGameMs = nextSessionDate ? startOfDay(nextSessionDate).getTime() : null;

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m, d);
      const dateMs = startOfDay(date).getTime();
      const isSessionDay = Boolean(sessionDates[toDateKey(date)]);
      const classes = ["cal-d"];

      if (dateMs < todayMs) classes.push("past");
      else if (dateMs === todayMs) classes.push("today");

      let clickable = false;

      if (isSessionDay && dateMs >= todayMs) {
        const isNext = dateMs === nextGameMs;
        const locked = isWithinBookingLock(date, now);
        const canBook = isBookable(date, now);
        const isSel =
          schedulePick &&
          startOfDay(schedulePick).getTime() === dateMs;

        if (isNext) {
          classes.push(isSel ? "game-sel" : "next-game");
          clickable = true;
        } else if (canBook) {
          classes.push(isSel ? "game-sel" : "game-open");
          clickable = true;
        } else if (locked) {
          classes.push(isSel ? "game-sel" : "game");
          clickable = true;
        }
      }

      const el = (
        <div
          key={`d-${d}`}
          className={classes.join(" ")}
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={
            clickable
              ? () => {
                  setSchedulePick(new Date(y, m, d));
                  if (window.innerWidth < 1024) {
                    const card = document.querySelector(".ngc");
                    if (card) {
                      const top =
                        card.getBoundingClientRect().top + window.scrollY - 90;
                      window.scrollTo({ top, behavior: "smooth" });
                    }
                  }
                }
              : undefined
          }
          onKeyDown={
            clickable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setSchedulePick(new Date(y, m, d));
                  }
                }
              : undefined
          }
        >
          {d}
        </div>
      );
      cells.push(el);
    }

    return cells;
  };

  const badgeLabel = schedulePick
    ? tr("ngc_selected")
    : tr("ngc_badge");

  let ctaLabel = tr("ngc_cta");
  let ctaDisabled = false;
  let showLocked = false;

  if (withinLock) {
    ctaLabel = isNextGame ? tr("ngc_view_only") : tr("reg_closed");
    ctaDisabled = true;
    showLocked = true;
  } else if (isFull) {
    ctaLabel = tr("ngc_full");
    ctaDisabled = false;
  }

  return (
    <section className="section section-cream" id="schedule" data-screen-label="Schedule">
      <div className="container">
        <div className="section-label">
          <Trans k="sched_lbl" />
        </div>
        <h2 className="section-title">
          <Trans k="sched_h" />
        </h2>
        <p className="section-sub">
          <Trans k="sched_sub" />
        </p>

        {calendarSubscribe && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
            <a
              href={calendarSubscribe.googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-bronze-outline"
            >
              {tr("sched_subscribe_google")}
            </a>
            <a
              href={calendarSubscribe.icsUrl}
              className="btn btn-bronze-outline"
            >
              {tr("sched_subscribe_ics")}
            </a>
          </div>
        )}

        <div className="schedule-grid">
          <div className="ngc animate-in">
            {!displayDate ? (
              <div className="ngc-body">
                {showLoading ? (
                  <div className="loading-center">
                    <LoadingIcon size="sm" />
                    {tr("loading")}
                  </div>
                ) : (
                  <p>{tr("ngc_no_sessions")}</p>
                )}
              </div>
            ) : (
              <>
            <div className="ngc-head">
              <span className="ngc-badge">{badgeLabel}</span>
              <span
                className="ngc-avail"
                dangerouslySetInnerHTML={{
                  __html: tr("avail_spots", { n: spotsAvail }).replace(
                    String(spotsAvail),
                    `<strong>${spotsAvail}</strong>`,
                  ),
                }}
              />
            </div>
            <div className="ngc-body">
              <div className="ngc-day">{getDayName(displayDate, lang)}</div>
              <div className="ngc-date">{formatDateLong(displayDate, lang)}</div>

              {!isMembershipDay(toDateKey(displayDate)) && (
                <div className="ngc-locked">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <Trans k="casual_only_badge" />
                </div>
              )}

              <div className="ngc-row">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="ngc-time-icon"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {displayTimeLabel || <Trans k="ngc_time" />}
              </div>
              <div className="ngc-row">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="ngc-pin-icon"
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                {displayLocation ? (
                  <div>{displayLocation}</div>
                ) : (
                  <div>
                    <div>
                      {venueLabel || <Trans k="ngc_venue" />}
                    </div>
                    <div className="ngc-addr">
                      {addressLabel || <Trans k="ngc_addr" />}
                    </div>
                  </div>
                )}
              </div>

              <div className="ngc-bar-wrap">
                <div
                  className="ngc-bar"
                  style={{
                    width: `${Math.min(100, (signedUp / maxSpots) * 100)}%`,
                  }}
                />
              </div>
              <div className="ngc-bar-lbl">
                {tr("session_signed_up", { n: signedUp })}
              </div>

              <button
                type="button"
                className="btn btn-primary btn-full"
                disabled={ctaDisabled}
                onClick={
                  ctaDisabled
                    ? undefined
                    : isFull
                      ? () => displayDate && openWaitlistModal(displayDate)
                      : handleBook
                }
              >
                {ctaLabel}
              </button>

              {showLocked && (
                <div className="ngc-locked" style={{ display: "flex" }}>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <Trans k="ngc_locked_msg" />
                </div>
              )}
            </div>
              </>
            )}
          </div>

          <div className="cal-wrap animate-in" style={{ animationDelay: ".1s" }}>
            <div className="cal-head">
              <button
                type="button"
                className="cal-nav-btn"
                onClick={() =>
                  setCalDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
                }
              >
                &#8249;
              </button>
              <div className="cal-month">
                {lang === "vi"
                  ? monthNamesVi[calDate.getMonth()]
                  : monthNamesEn[calDate.getMonth()]}{" "}
                {calDate.getFullYear()}
              </div>
              <button
                type="button"
                className="cal-nav-btn"
                onClick={() =>
                  setCalDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
                }
              >
                &#8250;
              </button>
            </div>
            <div className="cal-grid" id="cal-grid">
              {renderCalendar()}
            </div>
            <div className="cal-legend">
              <div className="cal-legend-item">
                <div
                  className="cal-legend-dot"
                  style={{ background: "var(--bronze)" }}
                />
                <Trans k="cal_legend_next" />
              </div>
              <div className="cal-legend-item">
                <div
                  className="cal-legend-dot"
                  style={{
                    background: "rgba(24,68,103,.2)",
                    border: "1.5px solid rgba(24,68,103,.3)",
                  }}
                />
                <Trans k="cal_legend_bookable" />
              </div>
              <div className="cal-legend-item">
                <div
                  className="cal-legend-dot"
                  style={{ background: "rgba(24,68,103,.05)" }}
                />
                <Trans k="cal_legend_closed" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
