// The Vision tab (the club's match tracker), as the website's start screen:
// the challenge being tracked (from the Arena), the free trial or prices,
// filming live or analysing a video, how it works, and helping train it.
// The tracker itself is the next screen (/vision/track).
import { Link } from "@tanstack/react-router";
import { useCurrentClub, useT } from "../hooks.tsx";
import { money } from "../lib/format.ts";
import { usePlace } from "./me/parts.tsx";
import { useVisionChallenge, useVisionStatus, type VisionChallenge } from "./vision/data.ts";
import { LoadError } from "../components/LoadError.tsx";

const DAY = 86_400_000;

function Teams({ c, vs }: { c: VisionChallenge; vs: string }) {
  return (
    <div className="versus">
      {c.setup.teams.map((team, i) => (
        <div key={i} className="pair-block">
          <strong className="pair-name">{team.name}</strong>
          {team.players.map((p) => (
            <span key={p.id} className="person">
              <span className="avatar avatar-small" aria-hidden="true">{p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : p.name.slice(0, 1)}</span>
              <span>{p.name}</span>
            </span>
          ))}
        </div>
      )).flatMap((el, i) => (i === 0 ? [el, <span key="vs" className="vs" aria-hidden="true">{vs}</span>] : [el]))}
    </div>
  );
}

export default function VisionScreen() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const { locale, currency, timezone } = usePlace();
  const challengeId = Number(new URLSearchParams(window.location.search).get("challenge")) || null;
  const status = useVisionStatus();
  const challenge = useVisionChallenge(challengeId);
  const s = status.data;
  const ends = s ? Date.parse(s.trialEnds) : 0;
  const lastFree = s ? new Date(ends - 1).toLocaleDateString(locale, { timeZone: timezone, day: "numeric", month: "long", year: "numeric" }) : "";
  const paidFrom = s ? new Date(ends).toLocaleDateString(locale, { timeZone: timezone, day: "numeric", month: "long", year: "numeric" }) : "";
  const daysLeft = s ? Math.max(0, Math.ceil((ends - Date.now()) / DAY)) : 0;
  const live = s ? money(s.prices.live, currency) : "";
  const upload = s ? money(s.prices.upload, currency) : "";
  const search = (challengeId ? { challenge: challengeId } : {}) as never;

  const mode = (title: string, sub: string, price: string) => (
    <div className="card stack mode">
      <div className="card-head">
        <h3>{title}</h3>
        {s?.trial && <span className="tag">{t("vision_free_now")}</span>}
      </div>
      <p className="muted small">{sub}</p>
      <p className="small">{s?.trial ? t("vision_then", { price }) : price}</p>
      <div>
        <Link to="/vision/track" search={search} className="button button-primary">{title}</Link>
      </div>
    </div>
  );

  return (
    <div className="screen vision" data-screen="nav_vision" data-state={s ? "ready" : status.isError ? "error" : "loading"}>
      <header className="arena-hero stack-tight">
        <h1>{t("nav_vision")}</h1>
        <p className="lead">{t("vision_sub")}</p>
      </header>
      {challengeId && (
        <section className="card stack" aria-labelledby="vision-challenge">
          <h2 id="vision-challenge">{t("vision_challenge")}</h2>
          {challenge.isError ? (
            <p className="notice notice-error" role="alert">{t("vision_not_found")}</p>
          ) : challenge.data ? (
            <>
              <Teams c={challenge.data} vs="VS" />
              {challenge.data.stats && <p className="notice">{t("vision_saved_before", { name: challenge.data.stats.recordedBy.name })}</p>}
            </>
          ) : (
            <div className="skeleton skeleton-short" aria-busy="true" />
          )}
        </section>
      )}
      {!s ? (
        status.isError ? <LoadError onRetry={() => void status.refetch()} /> : <div className="skeleton skeleton-tall" aria-busy="true" />
      ) : (
        <>
          {s.trial && (
            <section className="card stack trial" aria-labelledby="vision-trial">
              <h2 id="vision-trial">{t("vision_trial_title", { date: lastFree })}</h2>
              <p>{t("vision_trial_text")}</p>
              <p className="small"><strong>{daysLeft <= 1 ? t("vision_trial_last") : t("vision_trial_days", { n: daysLeft })}</strong> · {t("vision_trial_after", { date: paidFrom, live, upload })}</p>
            </section>
          )}
          <div className="me-grid">
            {mode(t("vision_camera_title"), t("vision_camera_sub"), t("vision_price_live", { price: live }))}
            {mode(t("vision_video_title"), t("vision_video_sub"), t("vision_price_upload", { price: upload }))}
          </div>
        </>
      )}
      <section className="card stack" aria-labelledby="vision-about">
        <span className="tag">✦ {t("vision_ai_badge")}</span>
        <h2 id="vision-about" className="visually-hidden">{t("vision_ai_badge")}</h2>
        <p>{t("vision_intro")}</p>
        <p className="muted small">{t("vision_ai_layers")}</p>
        <p className="muted small">{t("vision_privacy")}</p>
      </section>
      <section className="card stack" aria-labelledby="vision-train">
        <h2 id="vision-train">{t("vision_train_title")}</h2>
        <p className="muted small">{t("vision_train_text")}</p>
        <div><Link to="/vision/label" className="button">{t("vision_train_btn")}</Link></div>
      </section>
    </div>
  );
}
