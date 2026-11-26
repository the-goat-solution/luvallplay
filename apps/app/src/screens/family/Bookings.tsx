// A child's play days: book a place, or cancel one. The places are the same
// ones adults' casual bookings use, so "full" means full for everyone.
import { useState } from "react";
import { useLang } from "../../hooks.tsx";
import { useBookChild, useCancelBooking, type FamilyBookings } from "./data.ts";
import { errorKey, type FamilyT } from "./words.ts";

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;

function dayLabel(dateKey: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${dateKey}T00:00:00Z`));
}

export function ChildBookings({ childId, data, ft }: { childId: number; data: FamilyBookings; ft: FamilyT }) {
  const lang = useLang();
  const book = useBookChild(childId);
  const cancel = useCancelBooking();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mine = new Map(data.bookings.filter((b) => b.childId === childId).map((b) => [b.date, b]));
  const act = (date: string, run: () => Promise<unknown>) => {
    setError(null);
    setBusy(date);
    run()
      .catch((e) => setError(ft(errorKey(codeOf(e)))))
      .finally(() => setBusy(null));
  };
  return (
    <fieldset className="stack" data-bookings={childId}>
      <legend className="label-title">{ft("book_title")}</legend>
      {data.payment === "card" && <p className="notice">{ft("book_pay_soon")}</p>}
      {data.days.length === 0 && <p className="muted small">{ft("book_none")}</p>}
      {data.days.map((day) => {
        const booking = mine.get(day.date);
        const working = busy === day.date;
        return (
          <div className="row" key={day.date} data-day={day.date} data-booked={booking ? "yes" : "no"}>
            <span className="row-text">
              <strong>{dayLabel(day.date, lang)}</strong>
              <span className="muted small">
                {booking ? ft("book_booked") : day.spotsLeft > 0 ? ft("book_spots", { n: day.spotsLeft }) : ft("book_full")}
                {day.location ? ` · ${day.location}` : ""}
              </span>
            </span>
            {booking ? (
              <button type="button" className="button button-quiet" disabled={working} onClick={() => act(day.date, () => cancel.mutateAsync(booking.id))}>
                {working ? ft("book_cancelling") : ft("book_cancel")}
              </button>
            ) : (
              data.payment === "none" &&
              day.spotsLeft > 0 && (
                <button type="button" className="button button-primary" disabled={working} onClick={() => act(day.date, () => book.mutateAsync(day.date))}>
                  {working ? ft("book_booking") : ft("book_btn")}
                </button>
              )
            )}
          </div>
        );
      })}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </fieldset>
  );
}
