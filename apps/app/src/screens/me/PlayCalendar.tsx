// The next five weeks of play days, by month, as on the website: their
// membership days (with "Can't make it"), booked spots, and the days with
// casual spots. Booking a spot is a card payment: it opens on the club's
// website until the payments step brings it into the app.
import { useState } from "react";
import type { PlayDay } from "./data.ts";
import { useAbsence } from "./data.ts";
import { byMonth, dayLabel, dayTile, money, monthLabel, timeRange } from "../../lib/format.ts";
import { usePlace, webHref, WebsiteLink } from "./parts.tsx";

function DayRow({ d, casualPrice }: { d: PlayDay; casualPrice: number }) {
  const { t, locale, timezone, currency, webUrl } = usePlace();
  const absence = useAbsence();
  const [saved, setSaved] = useState(false);
  const tile = dayTile(d.date, locale);
  const time = timeRange(d.startTime, d.endTime, locale, timezone);
  const yours = d.included || d.booked;
  const title = d.included ? (d.absent ? t("cal_absent") : `✓ ${t("cal_included")}`) : d.booked ? `✓ ${t("cal_booked")}` : time || dayLabel(d.date, locale);
  const detail = yours ? time : d.paused ? t("cal_paused") : d.closed ? t("cal_closed") : d.spots > 0 ? t("cal_spots", { n: d.spots }) : t("cal_full");
  const canBook = !yours && d.bookable && !d.paused && !d.closed && d.spots > 0;
  const book = canBook ? webHref(webUrl, "/profile") : null;
  return (
    <li className={`day${d.included && !d.absent ? " day-yours" : ""}`}>
      <div className="day-tile" aria-hidden="true">
        <span className="day-weekday">{tile.weekday}</span>
        <span className="day-number">{tile.day}</span>
      </div>
      <div className="day-text">
        <span className="visually-hidden">{dayLabel(d.date, locale, true)}: </span>
        <strong>{title}</strong>
        <span className="muted small day-detail">
          {detail}
          {d.location ? ` · ${d.location}` : ""}
        </span>
        {saved && d.absent && <span className="small" role="status">{t("cal_absence_saved")}</span>}
      </div>
      <div className="day-action">
        {d.included ? (
          <button
            type="button"
            className={`button button-small ${d.absent ? "button-primary" : ""}`}
            aria-pressed={d.absent}
            disabled={absence.isPending}
            onClick={() => {
              setSaved(!d.absent);
              absence.mutate({ date: d.date, absent: !d.absent });
            }}
          >
            {d.absent ? t("cal_undo_absence") : t("cal_cant_make_it")}
          </button>
        ) : d.booked ? null : book ? (
          <WebsiteLink href={book} className="button button-small button-primary">
            {t("cal_book", { price: money(casualPrice, currency) })}
          </WebsiteLink>
        ) : !d.bookable ? (
          <span className="muted small">{t("cal_not_open")}</span>
        ) : null}
      </div>
    </li>
  );
}

export function PlayCalendar({ days, casualPrice }: { days: PlayDay[]; casualPrice: number }) {
  const { t, locale } = usePlace();
  const absence = useAbsence();
  return (
    <section className="card stack" aria-labelledby="cal-title">
      <div className="stack-tight">
        <h2 id="cal-title">{t("cal_title")}</h2>
        <p className="muted small">{t("cal_sub")}</p>
      </div>
      {absence.isError && <p className="notice notice-error" role="alert">{t("mem_err_generic")}</p>}
      {days.length === 0 && <p className="muted">{t("cal_none")}</p>}
      {byMonth(days).map(([month, list]) => (
        <div key={month} className="stack-tight">
          <h3 className="month">{monthLabel(month, locale)}</h3>
          <ul className="days">
            {list.map((d) => (
              <DayRow key={d.date} d={d} casualPrice={casualPrice} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
