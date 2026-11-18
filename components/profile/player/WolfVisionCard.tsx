"use client";

import { useEffect, useState } from "react";
import { useProfileT } from "@/lib/profile-i18n";
import type { PlayerMatchStats } from "@/lib/wolf-vision-db";
import styles from "../profile.module.css";

// Player tab → Wolf Vision: start tracking your own game (players the club has
// switched it on for), and every game Wolf Vision tracked you in: your line
// and the match totals, delivered automatically after Arena challenges.

type Item = PlayerMatchStats & { sessionId: number; unseen: boolean };

const T = {
  en: {
    title: "Wolf Vision",
    sub: "AI match tracking: hits, distance and speed for every player.",
    track: "Track a game",
    none: "No tracked games yet. When a game you play is tracked with Wolf Vision (in the Arena or here), your stats land here automatically.",
    hits: "hits",
    covered: "covered",
    top: "top speed",
    rallies: "rallies",
    longest: "longest rally",
    fastest: "fastest shot",
    withPartner: (n: string) => `with ${n}`,
    vs: (n: string) => `vs ${n}`,
    live: "live",
    upload: "video",
    newBadge: "New",
    everyone: "Everyone",
    quality: (q: number) => `capture quality ${Math.round(q * 100)}%`,
  },
  vi: {
    title: "Wolf Vision",
    sub: "Theo dõi trận đấu bằng AI: cú đánh, quãng đường và tốc độ của từng người.",
    track: "Theo dõi một trận",
    none: "Chưa có trận nào được theo dõi. Khi trận bạn chơi được theo dõi bằng Wolf Vision (ở Đấu Trường hoặc tại đây), thống kê sẽ tự động có ở đây.",
    hits: "cú đánh",
    covered: "di chuyển",
    top: "tốc độ cao nhất",
    rallies: "pha bóng",
    longest: "pha dài nhất",
    fastest: "cú nhanh nhất",
    withPartner: (n: string) => `cùng ${n}`,
    vs: (n: string) => `gặp ${n}`,
    live: "trực tiếp",
    upload: "video",
    newBadge: "Mới",
    everyone: "Mọi người",
    quality: (q: number) => `chất lượng ghi hình ${Math.round(q * 100)}%`,
  },
};

const km = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`);

export function WolfVisionCard({ items, canTrack }: { items: Item[]; canTrack: boolean }) {
  const { lang } = useProfileT();
  const t = T[lang === "vi" ? "vi" : "en"];
  const [open, setOpen] = useState<number | null>(null);
  const unseen = items.some((i) => i.unseen);
  useEffect(() => {
    // Seen once the card has been shown.
    if (unseen) fetch("/api/wolf-vision/seen", { method: "POST" }).catch(() => {});
  }, [unseen]);

  return (
    <section className={styles.card} id="wolf-vision" data-testid="wolf-vision-card">
      <h2 className={styles.cardTitle}>
        🐺 {t.title}
        {canTrack ? (
          <span>
            <a href="/match-analyzer?own=1" className={styles.btn} data-testid="wolf-vision-track">
              {t.track} →
            </a>
          </span>
        ) : null}
      </h2>
      <p style={{ margin: "0 0 10px", color: "var(--text-light)", fontSize: 14 }}>{t.sub}</p>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14 }}>{t.none}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {items.map((it) => {
            const when = new Date(it.date).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", { weekday: "short", day: "numeric", month: "short" });
            const isOpen = open === it.sessionId;
            return (
              <li key={it.sessionId} style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 12 }}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : it.sessionId)}
                  aria-expanded={isOpen}
                  style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <strong style={{ fontSize: 15 }}>
                      {it.title}
                      {it.score && it.score.mine !== null ? ` · ${it.score.mine}–${it.score.theirs}` : ""}
                    </strong>
                    <small style={{ color: "var(--text-light)", whiteSpace: "nowrap" }}>
                      {it.unseen ? <b style={{ color: "#c2410c", marginRight: 6 }}>{t.newBadge}</b> : null}
                      {when} · {it.mode === "live" ? t.live : t.upload}
                    </small>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-light)", marginTop: 2 }}>
                    {[it.partner ? t.withPartner(it.partner) : null, it.opponents.length ? t.vs(it.opponents.join(" & ")) : null].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10, textAlign: "center" }}>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 900 }}>{it.me.hits}</div>
                      <div style={{ fontSize: 12, color: "var(--text-light)" }}>{t.hits}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 900 }}>{km(it.me.distance)}</div>
                      <div style={{ fontSize: 12, color: "var(--text-light)" }}>{t.covered}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 900 }}>{it.me.topSpeed.toFixed(1)}</div>
                      <div style={{ fontSize: 12, color: "var(--text-light)" }}>m/s · {t.top}</div>
                    </div>
                  </div>
                </button>
                {isOpen ? (
                  <div style={{ marginTop: 10, fontSize: 13 }}>
                    <p style={{ margin: "0 0 6px" }}>
                      {it.match.rallies} {t.rallies} · {t.longest} {it.match.longestRally}
                      {it.match.fastestShotKmh != null ? ` · ${t.fastest} ${it.match.fastestShotKmh} km/h` : ""} · {t.quality(it.match.quality)}
                    </p>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "var(--text-light)" }}>
                          <th>{t.everyone}</th>
                          <th>{t.hits}</th>
                          <th>{t.covered}</th>
                          <th>m/s</th>
                        </tr>
                      </thead>
                      <tbody>
                        {it.everyone.map((p, k) => (
                          <tr key={k} style={{ borderTop: "1px solid var(--border, #eee)" }}>
                            <td>{p.name}</td>
                            <td>{p.hits}</td>
                            <td>{km(p.distance)}</td>
                            <td>{p.topSpeed.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
