// The next five weeks of play days, by month, as on the website: their
// membership days (with "Can't make it"), booked spots, and the days with
// casual spots. Booking a spot is a card payment (Stripe), in a dialog; the
// webhook books it once paid.
//
// With several clubs (Home), one calendar holds every club's days, each
// row labelled with its club and acting on that club.
import { useState } from "react";
import { ClubScopeProvider, type Club } from "../../hooks.tsx";
import { ScopeTag } from "../../components/ClubTag.tsx";
import type { PlayDay } from "./data.ts";
import { useAbsence, useQueue } from "./data.ts";
import { storage } from "../../app.ts";
import { forgetDropped } from "../../lib/offline.ts";
import { byMonth, dayLabel, dayTile, money, monthLabel, timeRange } from "../../lib/format.ts";
import { usePlace } from "./parts.tsx";
import { CardPayment } from "../../components/CardPayment.tsx";
import { Dialog } from "../arena/Dialogs.tsx";
import { useBook, useRefreshSoon } from "../membership/data.ts";
import { Icon } from "../../components/Icon.tsx";

function DayRow({ d, casualPrice }: { d: PlayDay; casualPrice: number }) {
  const { t, locale, timezone, currency } = usePlace();
  const absence = useAbsence();
  const book = useBook();
  const refreshSoon = useRefreshSoon();
  const [saved, setSaved] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const tile = dayTile(d.date, locale);
  const time = timeRange(d.startTime, d.endTime, locale, timezone);
  const yours = d.included || d.booked;
  const title = d.included ? (d.absent ? t("cal_absent") : t("cal_included")) : d.booked ? t("cal_booked") : time || dayLabel(d.date, locale);
  const ticked = (d.included && !d.absent) || d.booked;
  const detail = yours ? time : d.paused ? t("cal_paused") : d.closed ? t("cal_closed") : d.spots > 0 ? t("cal_spots", { n: d.spots }) : t("cal_full");
  const canBook = !yours && d.bookable && !d.paused && !d.closed && d.spots > 0;
  const price = money(casualPrice, currency);
  const start = () => {
    setMessage(null);
    book.mutate(d.date, { onSuccess: (r) => setPaying(r.clientSecret), onError: () => setMessage({ ok: false, text: t("cal_booking_failed") }) });
  };
  return (
    <li className={`day${d.included && !d.absent ? " day-yours" : ""}`}>
      <div className="day-tile" aria-hidden="true">
        <span className="day-weekday">{tile.weekday}</span>
        <span className="day-number">{tile.day}</span>
      </div>
      <div className="day-text">
        <span className="visually-hidden">{dayLabel(d.date, locale, true)}: </span>
        <strong className={ticked ? "icon-line" : undefined}>{ticked && <Icon name="check" size={16} />}{title}</strong>
        <ScopeTag quiet />
        <span className="muted small day-detail">
          {detail}
          {d.location ? ` · ${d.location}` : ""}
        </span>
        {saved && d.absent && !absence.waits(d.date) && <span className="small" role="status">{t("cal_absence_saved")}</span>}
        {absence.waits(d.date) && <span className="small muted" role="status">{t("cal_queued")}</span>}
        {message && <span className={`small${message.ok ? "" : " notice-error"}`} role={message.ok ? "status" : "alert"}>{message.text}</span>}
      </div>
      <div className="day-action">
        {d.included ? (
          <button
            type="button"
            className={`button button-small ${d.absent ? "button-primary" : ""}`}
            aria-pressed={d.absent}
            onClick={() => {
              setSaved(!d.absent);
              absence.change({ date: d.date, absent: !d.absent });
            }}
          >
            {d.absent ? t("cal_undo_absence") : t("cal_cant_make_it")}
          </button>
        ) : d.booked ? null : canBook ? (
          <button type="button" className="button button-small button-primary" disabled={book.isPending} onClick={start}>
            {t("cal_book", { price })}
          </button>
        ) : !d.bookable ? (
          <span className="muted small">{t("cal_not_open")}</span>
        ) : null}
      </div>
      {paying && (
        <Dialog label={t("cal_book_title")} onClose={() => setPaying(null)}>
          <h2>{t("cal_book_title")}</h2>
          <p className="muted">{t("cal_book_for", { date: dayLabel(d.date, locale, true), price })}</p>
          <CardPayment
            clientSecret={paying}
            label={t("mem_pay", { amount: price })}
            returnPath="/home"
            onDone={() => {
              setPaying(null);
              setMessage({ ok: true, text: t("cal_booked_done", { date: dayLabel(d.date, locale) }) });
              refreshSoon();
            }}
          />
          <div><button type="button" className="button button-quiet" onClick={() => setPaying(null)}>{t("cancel")}</button></div>
        </Dialog>
      )}
    </li>
  );
}

/** One row of the calendar: a day, and with several clubs, whose it is. */
export type CalendarRow = { club: Club | null; day: PlayDay; casualPrice: number };

export function PlayCalendar({ days, casualPrice }: { days: PlayDay[]; casualPrice: number }) {
  return <CalendarCard rows={days.map((day) => ({ club: null, day, casualPrice }))} />;
}

export function CalendarCard({ rows, sub }: { rows: CalendarRow[]; sub?: string }) {
  const { t, locale } = usePlace();
  const months = byMonth(rows.map((r) => ({ ...r, date: r.day.date })));
  // A "Can't make it" (or its undo) the club's server refused: said, not silently put back.
  const { dropped } = useQueue();
  return (
    <section className="card stack" aria-labelledby="cal-title">
      <div className="stack-tight">
        <h2 id="cal-title">{t("cal_title")}</h2>
        <p className="muted small">{sub ?? t("cal_sub")}</p>
      </div>
      {dropped.map((d) => (
        <div key={`${d.club}:${d.date}`} className="notice notice-error stack-tight" role="alert" data-testid="absence-dropped">
          <p>{t("cal_dropped", { date: dayLabel(d.date, locale) })}</p>
          <div>
            <button type="button" className="button button-small" onClick={() => forgetDropped(storage, d)}>{t("close")}</button>
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">{t("cal_none")}</p>}
      {months.map(([month, list]) => (
        <div key={month} className="stack-tight">
          <h3 className="month">{monthLabel(month, locale)}</h3>
          <ul className="days">
            {list.map((r) =>
              r.club ? (
                <ClubScopeProvider key={`${r.club.slug}:${r.day.date}`} club={r.club}>
                  <DayRow d={r.day} casualPrice={r.casualPrice} />
                </ClubScopeProvider>
              ) : (
                <DayRow key={r.day.date} d={r.day} casualPrice={r.casualPrice} />
              ),
            )}
          </ul>
        </div>
      ))}
    </section>
  );
}
