"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useArenaT } from "@/lib/arena-i18n";
import { LADDER, rankName } from "@/lib/ranks";
import type { PlayerCard } from "@/lib/player-card";
import { Sheet } from "@/components/profile/Sheet";
import { BusyLabel, Spinner } from "@/components/profile/BusyLabel";
import { RankIcon } from "./RankIcon";
import styles from "@/components/profile/profile.module.css";
import c from "./playercard.module.css";

/**
 * A player's card, opened from a Leaderboard row: rank art, Wolf Points,
 * recent form, and "Challenge". Challenges are pair against pair, posted
 * openly: if this player's pair has an open challenge, the button accepts
 * it; otherwise it takes you to the Challenges segment to post one they can
 * accept.
 */
export function PlayerCardSheet({ playerId, onClose }: { playerId: number | null; onClose: () => void }) {
  const { t, lang } = useArenaT();
  const router = useRouter();
  const [card, setCard] = useState<PlayerCard | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening a (different) player starts from a clean loading state.
  const [prevPlayerId, setPrevPlayerId] = useState(playerId);
  if (playerId !== prevPlayerId) {
    setPrevPlayerId(playerId);
    if (playerId !== null) {
      setState("loading");
      setCard(null);
      setError(null);
    }
  }

  useEffect(() => {
    if (playerId === null) return;
    let cancelled = false;
    fetch(`/api/arena/player/${playerId}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) return setState("hidden");
        if (!res.ok) return setState("error");
        setCard(((await res.json()) as { card: PlayerCard }).card);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const challenge = async () => {
    if (!card) return;
    if (!card.openChallengeId) {
      router.push(`/profile/arena?tab=challenges&vs=${card.id}`);
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/arena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept", id: card.openChallengeId }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const json = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      let text = t("err_generic");
      try {
        const key = `err_${json?.error ?? "generic"}` as Parameters<typeof t>[0];
        const found = t(key);
        if (found && found !== key) text = found;
      } catch {
        // unknown error code: keep the generic message
      }
      setError(text);
      return;
    }
    router.push("/profile/arena?tab=challenges");
    onClose();
  };

  return (
    <Sheet open={playerId !== null} onClose={onClose} title={card?.name ?? " "}>
      {state === "loading" && (
        <div className={styles.loadingLine}>
          <Spinner label="…" />
        </div>
      )}
      {state === "hidden" && <p className={styles.muted}>{t("card_hidden")}</p>}
      {state === "error" && <div className={styles.error}>{t("err_generic")}</div>}
      {state === "ready" && card && (
        <div className={c.card}>
          <div className={c.top}>
            <span className={c.face}>{card.avatarUrl ? <img src={card.avatarUrl} alt="" /> : card.initials}</span>
            <span className={c.art}>
              <RankIcon index={card.rankIndex} seat={card.seat} tarnished={card.tarnishing} px={64} />
            </span>
          </div>
          <p className={c.rank}>{rankName(LADDER[Math.min(card.rankIndex, LADDER.length - 1)], lang)}</p>
          <p className={c.points}>
            {t("card_wp_total", { n: card.wpTotal })}
            <br />
            <small>{t("card_wp_90", { n: card.wp90 })}</small>
          </p>
          <h3 className={c.h3}>{t("card_form")}</h3>
          {card.form.length === 0 ? (
            <p className={styles.small}>{t("card_form_none")}</p>
          ) : (
            <ol className={c.form} aria-label={t("card_form")}>
              {card.form.map((f, i) => (
                <li key={i} className={f === "W" ? c.win : c.loss}>
                  {f}
                </li>
              ))}
            </ol>
          )}
          {error && <div className={styles.error}>{error}</div>}
          {card.isMe ? (
            <p className={styles.small}>{t("card_you")}</p>
          ) : card.partner ? (
            <p className={styles.small}>{t("card_partner")}</p>
          ) : (
            <>
              {!card.openChallengeId && <p className={styles.small}>{t("card_post_hint", { name: card.name })}</p>}
              <button type="button" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} onClick={challenge} disabled={busy} aria-busy={busy}>
                <BusyLabel busy={busy}>{card.openChallengeId ? t("card_accept_open") : t("card_challenge")}</BusyLabel>
              </button>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
