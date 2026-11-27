// The Vision tab (the club's match tracker), as the website's start screen:
// the challenge being tracked (from the Arena), the free trial or prices,
// filming live or analysing a video, how it works, and helping train it.
// The tracker itself is the next screen (/vision/track).
import { Link } from "@tanstack/react-router";
import { useCurrentClub, useT } from "../hooks.tsx";
import { money } from "../lib/format.ts";
import { sellsPasses } from "../lib/native/platform.ts";
import { usePlace } from "./me/parts.tsx";
import { useVisionChallenge, useVisionStatus, type VisionChallenge } from "./vision/data.ts";
import { LoadError } from "../components/LoadError.tsx";
import { Icon } from "../components/Icon.tsx";
import { Duo, Stage, Sticker } from "../components/Stage.tsx";
import { MatchReport } from "../components/MatchReport.tsx";
import { useArenaT } from "./arena/words.ts";

const DAY = 86_400_000;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function Teams({ c, vs }: { c: VisionChallenge; vs: string }) {
  return (
    <div className="versus">
      {c.setup.teams.map((team, i) => (
        <div key={i} className="pair-block pair-compact">
          <Duo players={team.players.map((p) => ({ id: p.id, initials: initials(p.name), avatarUrl: p.avatarUrl }))} side={i === 0 ? "you" : "them"} size="sm" />
          <strong className="pair-name">{team.name}</strong>
          <span className="muted small">{team.players.map((p) => p.name).join(" & ")}</span>
        </div>
      )).flatMap((el, i) => (i === 0 ? [el, <span key="vs" className="vs vs-disc" aria-hidden="true">{vs}</span>] : [el]))}
    </div>
  );
}

/** The tracker at work, drawn: a court, two players ringed, a shot's path drawing itself once. A picture, not data. */
function TrackerArt() {
  return (
    <svg className="vision-art" viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      <path className="vision-court" d="M70 30 H250 L310 190 H10 Z M160 30 V190 M52 80 H268 M32 136 H288" />
      <path className="vision-net" d="M40 112 H280" />
      <ellipse className="vision-ring vision-ring-you" cx="96" cy="160" rx="22" ry="8" />
      <ellipse className="vision-ring vision-ring-them" cx="214" cy="62" rx="16" ry="6" />
      <path className="vision-shot" d="M100 150 Q 150 20 212 56" />
      <circle className="vision-ball" cx="212" cy="56" r="4.5" />
      <g className="vision-tag vision-tag-you"><rect x="62" y="168" width="68" height="16" rx="3" /></g>
      <g className="vision-tag vision-tag-them"><rect x="188" y="34" width="52" height="14" rx="3" /></g>
    </svg>
  );
}

export default function VisionScreen() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const { locale, currency, timezone } = usePlace();
  const { t: ta } = useArenaT();
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
  const sells = sellsPasses();
  const search = (challengeId ? { challenge: challengeId } : {}) as never;

  const mode = (title: string, sub: string, price: string, icon: "phone" | "image") => (
    <div className="card stack mode">
      <div className="mode-head">
        <span className="mode-icon"><Icon name={icon} size={28} /></span>
        <h3>{title}</h3>
        {s?.trial && <Sticker>{t("vision_free_now")}</Sticker>}
      </div>
      <p className="muted small">{sub}</p>
      {sells && <p className="small mode-price">{s?.trial ? t("vision_then", { price }) : price}</p>}
      <div>
        <Link to="/vision/track" search={search} className="button button-accent">{title}</Link>
      </div>
    </div>
  );

  return (
    <Stage>
    <div className="screen vision" data-screen="nav_vision" data-state={s ? "ready" : status.isError ? "error" : "loading"}>
      <header className="stage-hero vision-hero">
        <TrackerArt />
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
              {challenge.data.stats && (
                <>
                  <MatchReport stats={challenge.data.stats} names={challenge.data.setup.teams.flatMap((team) => team.players.map((p) => p.name))} t={ta} />
                  <p className="notice">{t("vision_saved_before", { name: challenge.data.stats.recordedBy.name })}</p>
                </>
              )}
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
              <Sticker className="trial-ribbon">{t("vision_free_now")}</Sticker>
              <h2 id="vision-trial">{t("vision_trial_title", { date: lastFree })}</h2>
              <p>{t("vision_trial_text")}</p>
              <p className="small"><strong>{daysLeft <= 1 ? t("vision_trial_last") : t("vision_trial_days", { n: daysLeft })}</strong>{sells && <> · {t("vision_trial_after", { date: paidFrom, live, upload })}</>}</p>
            </section>
          )}
          <div className="me-grid">
            {mode(t("vision_camera_title"), t("vision_camera_sub"), t("vision_price_live", { price: live }), "phone")}
            {mode(t("vision_video_title"), t("vision_video_sub"), t("vision_price_upload", { price: upload }), "image")}
          </div>
        </>
      )}
      <section className="card stack" aria-labelledby="vision-about">
        <span className="tag tag-bonus"><Icon name="sparkles" size={14} />{t("vision_ai_badge")}</span>
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
    </Stage>
  );
}
