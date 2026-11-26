// "Next up": the next play day they're in, with "Can't make it" on a
// membership day.
import type { PlayDay } from "./data.ts";
import { useAbsence } from "./data.ts";
import { dayLabel, timeRange } from "../../lib/format.ts";
import { usePlace } from "./parts.tsx";
import { ScopeTag } from "../../components/ClubTag.tsx";

export function NextUp({ day }: { day: PlayDay | null }) {
  const { t, locale, timezone } = usePlace();
  const absence = useAbsence();
  return (
    <section className="card stack hero next-up" aria-labelledby="next-up-title">
      <div className="hero-head">
        <h2 id="next-up-title">{t("me_next_up")}</h2>
        <ScopeTag />
      </div>
      {!day ? (
        <p className="muted">{t("me_next_none")}</p>
      ) : (
        <>
          <p className="next-date">{dayLabel(day.date, locale)}</p>
          <p className="muted">{[timeRange(day.startTime, day.endTime, locale, timezone), day.location].filter(Boolean).join(" · ")}</p>
          <p><span className="tag">{day.booked ? t("me_next_booked") : t("me_next_included")}</span></p>
          {day.absent && <p className="muted">{t("cal_absent")}</p>}
          {absence.waits(day.date) && <p className="muted small" role="status">{t("cal_queued")}</p>}
          {day.included && !day.booked && (
            <div>
              <button
                type="button"
                className={`button ${day.absent ? "button-primary" : ""}`}
                aria-pressed={day.absent}
                onClick={() => absence.change({ date: day.date, absent: !day.absent })}
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
