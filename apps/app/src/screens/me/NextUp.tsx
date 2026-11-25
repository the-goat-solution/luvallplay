// "Next up": the next play day they're in, with "Can't make it" on a
// membership day.
import type { PlayDay } from "./data.ts";
import { useAbsence } from "./data.ts";
import { dayLabel, timeRange } from "../../lib/format.ts";
import { usePlace } from "./parts.tsx";

export function NextUp({ day }: { day: PlayDay | null }) {
  const { t, locale, timezone } = usePlace();
  const absence = useAbsence();
  return (
    <section className="card stack" aria-labelledby="next-up-title">
      <h2 id="next-up-title">{t("me_next_up")}</h2>
      {!day ? (
        <p className="muted">{t("me_next_none")}</p>
      ) : (
        <>
          <p className="next-date">{dayLabel(day.date, locale)}</p>
          <p className="muted">{[timeRange(day.startTime, day.endTime, locale, timezone), day.location].filter(Boolean).join(" · ")}</p>
          <p><span className="tag">{day.booked ? t("me_next_booked") : t("me_next_included")}</span></p>
          {day.absent && <p className="muted">{t("cal_absent")}</p>}
          {absence.isError && <p className="notice notice-error" role="alert">{t("mem_err_generic")}</p>}
          {absence.data?.queued && <p className="muted small" role="status">{t("cal_queued")}</p>}
          {day.included && !day.booked && (
            <div>
              <button
                type="button"
                className={`button ${day.absent ? "button-primary" : ""}`}
                aria-pressed={day.absent}
                disabled={absence.isPending}
                onClick={() => absence.mutate({ date: day.date, absent: !day.absent })}
              >
                {day.absent ? t("cal_undo_absence") : t("cal_cant_make_it")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
