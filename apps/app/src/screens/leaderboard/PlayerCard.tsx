// A player's card from the Leaderboard: rank, points, recent form, and
// "Challenge" (accepts their pair's open challenge, or opens the Arena).
import { useNavigate } from "@tanstack/react-router";
import { useArenaAction, errorCode } from "../arena/data.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { useArenaT } from "../arena/words.ts";
import { useCurrentClub, useT } from "../../hooks.tsx";
import { usePlayerCard } from "./data.ts";
import { useState } from "react";
import { RankIcon } from "../../components/RankIcon.tsx";

export function PlayerCard({ id, onClose }: { id: number; onClose: () => void }) {
  const { config } = useCurrentClub();
  const tl = useT(config);
  const { t, rank } = useArenaT();
  const card = usePlayerCard(id);
  const action = useArenaAction();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const c = card.data?.card;
  const challenge = () => {
    if (!c) return;
    if (c.openChallengeId) {
      action.mutate(
        { action: "accept", id: c.openChallengeId },
        {
          onSuccess: () => void navigate({ to: "/arena" }),
          onError: (e) => {
            const key = `err_${errorCode(e)}` as Parameters<typeof t>[0];
            const text = t(key);
            setError(text === key ? t("err_generic") : text);
          },
        },
      );
    } else void navigate({ to: "/arena", search: { vs: c.id } as never });
  };
  return (
    <Dialog label={c?.name ?? t("card_close")} onClose={onClose} className="player-card">
      {card.isError ? (
        <p>{(card.error as { status?: number }).status === 404 ? t("card_hidden") : t("err_generic")}</p>
      ) : !c ? (
        <div className="skeleton skeleton-short" aria-busy="true" />
      ) : (
        <>
          <div className="card-face">
            <div className="card-art">
              <RankIcon index={c.rankIndex} seat={c.seat} tarnished={c.tarnishing} px={96} />
              <div className="avatar card-avatar" aria-hidden="true">{c.avatarUrl ? <img src={c.avatarUrl} alt="" width={64} height={64} /> : c.initials}</div>
            </div>
            <h2 className="title card-name">{c.name}</h2>
            <p className="card-rank">{rank(c.rankIndex)}</p>
            {c.seat && <span className="sticker sticker-flood">{tl(c.seat === "alpha" ? "lb_alpha" : "lb_silver")}</span>}
          </div>
          <dl className="stats">
            <div className="stat"><dt>{t("card_wp_total", { n: "" }).trim()}</dt><dd className="stat-value">{c.wpTotal}</dd></div>
            <div className="stat"><dt>{t("card_wp_90", { n: "" }).trim()}</dt><dd className="stat-value">{c.wp90}</dd></div>
          </dl>
          <div className="stack-tight">
            <strong>{t("card_form")}</strong>
            {c.form.length ? (
              <p className="chips form" aria-label={c.form.join(" ")}>
                {c.form.map((f, i) => <span key={i} className={f === "W" ? "form-pip form-w" : "form-pip form-l"} aria-hidden="true">{f}</span>)}
              </p>
            ) : (
              <p className="muted small">{t("card_form_none")}</p>
            )}
          </div>
          {c.isMe ? (
            <p className="muted">{t("card_you")}</p>
          ) : c.partner ? (
            <p className="muted">{t("card_partner")}</p>
          ) : (
            <>
              {!c.openChallengeId && <p className="muted small">{t("card_post_hint", { name: c.name })}</p>}
              <div>
                <button type="button" className="button button-accent" disabled={action.isPending} onClick={challenge}>
                  {c.openChallengeId ? t("card_accept_open") : t("card_challenge")}
                </button>
              </div>
            </>
          )}
          {error && <p className="notice notice-error" role="alert">{error}</p>}
        </>
      )}
      <div><button type="button" className="button button-quiet" onClick={onClose}>{t("card_close")}</button></div>
    </Dialog>
  );
}
