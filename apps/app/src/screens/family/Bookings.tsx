// A child's play days: book a place, or cancel one. The places are the same
// ones adults' casual bookings use, so "full" means full for everyone.
import { useState } from "react";
import { useLang } from "../../hooks.tsx";
import { CardPayment } from "../../components/CardPayment.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { money } from "../../lib/format.ts";
import { useBookChild, useCancelBooking, usePayForChild, useRefreshBookingsSoon, type FamilyBookings } from "./data.ts";
import { errorKey, type FamilyT } from "./words.ts";

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;

function dayLabel(dateKey: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${dateKey}T00:00:00Z`));
}

export function ChildBookings({ childId, data, ft }: { childId: number; data: FamilyBookings; ft: FamilyT }) {
  const lang = useLang();
  const book = useBookChild(childId);
  const cancel = useCancelBooking();
  const pay = usePayForChild(childId);
  const refreshSoon = useRefreshBookingsSoon();
  const [paying, setPaying] = useState<{ date: string; clientSecret: string; price: string } | null>(null);
  const [paid, setPaid] = useState(false);
  const price = data.payment === "card" ? money(data.priceMinor ?? 0, data.currency ?? "") : "";
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
      {data.days.length === 0 && <p className="muted small">{ft("book_none")}</p>}
      {data.days.map((day) => {
        const booking = mine.get(day.date);
        const working = busy === day.date;
        return (
          <div className="row" key={day.date} data-day={day.date} data-booked={booking ? "yes" : "no"}>
            <span className="row-text">
              <strong>{dayLabel(day.date, lang)}</strong>
              <span className="muted small">
                {booking ? ((booking.amountMinor ?? 0) > 0 ? ft("book_paid") : ft("book_booked")) : day.spotsLeft > 0 ? ft("book_spots", { n: day.spotsLeft }) : ft("book_full")}
                {day.location ? ` · ${day.location}` : ""}
              </span>
            </span>
            {booking ? (
              (booking.amountMinor ?? 0) > 0 ? null : (
                <button type="button" className="button button-quiet" disabled={working} onClick={() => act(day.date, () => cancel.mutateAsync(booking.id))}>
                  {working ? ft("book_cancelling") : ft("book_cancel")}
                </button>
              )
            ) : day.spotsLeft <= 0 ? null : data.payment === "none" ? (
              <button type="button" className="button button-primary" disabled={working} onClick={() => act(day.date, () => book.mutateAsync(day.date))}>
                {working ? ft("book_booking") : ft("book_btn")}
              </button>
            ) : (
              <button
                type="button"
                className="button button-primary"
                disabled={working}
                onClick={() => {
                  setPaid(false);
                  act(day.date, () => pay.mutateAsync(day.date).then((r) => setPaying({ date: day.date, clientSecret: r.clientSecret, price: money(r.amountMinor, r.currency) })));
                }}
              >
                {working ? ft("book_booking") : ft("book_pay_btn", { price })}
              </button>
            )}
          </div>
        );
      })}
      {paid && <p className="notice" role="status">{ft("book_pay_done")}</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {paying && (
        <Dialog label={ft("book_pay_title")} onClose={() => setPaying(null)}>
          <h2>{ft("book_pay_title")}</h2>
          <p className="muted">{ft("book_pay_for", { date: dayLabel(paying.date, lang), price: paying.price })}</p>
          <CardPayment
            clientSecret={paying.clientSecret}
            label={ft("book_pay_label", { price: paying.price })}
            returnPath="/family"
            onDone={() => {
              setPaying(null);
              setPaid(true);
              refreshSoon();
            }}
          />
          <div><button type="button" className="button button-quiet" onClick={() => setPaying(null)}>{ft("book_close")}</button></div>
        </Dialog>
      )}
    </fieldset>
  );
}
