"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { RankIcon } from "@/components/arena/RankIcon";
import { isTrial } from "@/lib/wolf-vision-trial";
import s from "./appFeatures.module.css";

// Home page showcase of the members' app: the leaderboard and ranks, and
// Wolf Vision. The screenshots in /public/features are the real app screens
// (leaderboard and rank card rendered with sample players; Wolf Vision on a
// real match).

// A walk up the ladder: Plastic Shuttle … Diamond Racket with the full kit.
const LADDER_STEPS = [0, 1, 3, 6, 12, 18, 22, 26, 30, 34];

const COPY = {
  en: {
    label: "The Wolf App",
    title: "Every rally counts",
    sub: "Members get the club in their pocket: points, ranks, challenges and AI match stats.",
    lbKicker: "Leaderboard & ranks",
    lbTitle: "Climb from Plastic Shuttle to Diamond Racket",
    lbBody:
      "Every play day, round robin win and Arena challenge earns Wolf Points. Rise through 35 ranks, fill your kit bag, and fight for the Alpha Wolf seat.",
    lbStats: [
      ["35", "ranks"],
      ["4", "leagues"],
      ["1", "Alpha Wolf"],
    ],
    lbCta: "See the leaderboard",
    ladderAlt: "Rank ladder",
    wvKicker: "Wolf Vision",
    wvBeta: "Beta",
    wvTitle: "AI that watches your match",
    wvBody:
      "Prop a phone on a tripod and Wolf Vision tracks all four players by itself: every hit, shot speed, distance covered and a live court map. The video never leaves your phone.",
    wvStats: [
      ["4", "players tracked"],
      ["Every", "hit counted"],
      ["0", "taps mid-game"],
    ],
    wvFree: "Free until 28 Feb 2027",
    live: "Live",
    join: "Become a Member",
    signIn: "Member? Sign in",
    sample: "Sample players",
  },
  vi: {
    label: "Ứng Dụng Wolf",
    title: "Mỗi pha cầu đều có giá trị",
    sub: "Hội viên có cả câu lạc bộ trong túi: điểm, hạng, thách đấu và thống kê trận đấu bằng AI.",
    lbKicker: "Bảng xếp hạng & cấp bậc",
    lbTitle: "Leo từ Cầu Nhựa lên Vợt Kim Cương",
    lbBody:
      "Mỗi buổi chơi, mỗi trận thắng vòng tròn và thách đấu Arena đều mang về Wolf Points. Vượt qua 35 cấp bậc, sưu tầm đủ bộ đồ nghề và tranh ghế Alpha Wolf.",
    lbStats: [
      ["35", "cấp bậc"],
      ["4", "giải đấu"],
      ["1", "Alpha Wolf"],
    ],
    lbCta: "Xem bảng xếp hạng",
    ladderAlt: "Các cấp bậc",
    wvKicker: "Wolf Vision",
    wvBeta: "Beta",
    wvTitle: "AI theo dõi trận đấu của bạn",
    wvBody:
      "Đặt điện thoại lên giá đỡ và Wolf Vision tự theo dõi cả bốn người chơi: từng cú đánh, tốc độ cầu, quãng đường di chuyển và sơ đồ sân trực tiếp. Video không bao giờ rời khỏi điện thoại của bạn.",
    wvStats: [
      ["4", "người chơi"],
      ["Mọi", "cú đánh"],
      ["0", "lần chạm khi chơi"],
    ],
    wvFree: "Miễn phí đến 28/02/2027",
    live: "Trực tiếp",
    join: "Trở Thành Hội Viên",
    signIn: "Đã là hội viên? Đăng nhập",
    sample: "Người chơi mẫu",
  },
} as const;

export function AppFeatures() {
  const { lang } = useLanguage();
  const t = COPY[lang === "vi" ? "vi" : "en"];
  // Decided after mount so the cached page never shows the badge after the trial.
  const [free, setFree] = useState(false);
  useEffect(() => setFree(isTrial()), []);

  return (
    <section className={`section ${s.section}`} id="app" data-screen-label="App">
      <div className={s.glow} aria-hidden />
      <div className="container">
        <div className={`${s.head} animate-in`}>
          <div className="section-label">{t.label}</div>
          <h2 className="section-title section-title-white">{t.title}</h2>
          <p className="section-sub section-sub-light">{t.sub}</p>
        </div>

        {/* ── Leaderboard & ranks ─────────────────────────── */}
        <div className={s.feature}>
          <div className={`${s.copy} animate-in`}>
            <div className={s.kicker}>{t.lbKicker}</div>
            <h3 className={s.title}>{t.lbTitle}</h3>
            <p className={s.body}>{t.lbBody}</p>
            <div className={s.stats}>
              {t.lbStats.map(([v, l]) => (
                <div key={l}>
                  <b>{v}</b>
                  <span>{l}</span>
                </div>
              ))}
            </div>
            <div className={s.ladder} role="img" aria-label={t.ladderAlt}>
              {LADDER_STEPS.map((i, n) => (
                <span key={i} className={s.rung} style={{ animationDelay: `${n * 0.08}s` }}>
                  <RankIcon index={i} px={40} color="#fcfbf2" />
                </span>
              ))}
              <span className={`${s.rung} ${s.alpha}`} style={{ animationDelay: `${LADDER_STEPS.length * 0.08}s` }}>
                <RankIcon index={0} seat="alpha" px={48} color="#fcfbf2" />
              </span>
            </div>
            <a href="#leaderboard" className={s.link}>
              {t.lbCta} <span aria-hidden>→</span>
            </a>
          </div>
          <div className={`${s.phones} animate-in`} style={{ animationDelay: ".15s" }}>
            <figure className={`${s.phone} ${s.phoneBack}`}>
              <img src="/features/rank-card.webp" alt="" width={400} height={420} loading="lazy" />
            </figure>
            <figure className={`${s.phone} ${s.phoneFront}`}>
              <img src="/features/leaderboard.webp" alt="Three Wolves leaderboard" width={400} height={760} loading="lazy" />
            </figure>
            <span className={s.sample}>{t.sample}</span>
          </div>
        </div>

        {/* ── Wolf Vision ─────────────────────────────────── */}
        <div className={s.wv}>
          <div className={`${s.wvHead} animate-in`}>
            <div>
              <div className={s.kicker}>
                {t.wvKicker} <span className={s.beta}>{t.wvBeta}</span>
              </div>
              <h3 className={s.title}>{t.wvTitle}</h3>
              <p className={s.body}>{t.wvBody}</p>
            </div>
            <div>
              <div className={s.stats}>
                {t.wvStats.map(([v, l]) => (
                  <div key={l}>
                    <b>{v}</b>
                    <span>{l}</span>
                  </div>
                ))}
              </div>
              {free && <div className={s.free}>{t.wvFree}</div>}
            </div>
          </div>
          <div className={`${s.screen} animate-in`} style={{ animationDelay: ".15s" }}>
            <div className={s.frame}>
              <img src="/features/wolf-vision-live.webp" alt="Wolf Vision tracking a doubles match" width={1600} height={1094} loading="lazy" />
              <span className={s.live}>
                <i />
                {t.live}
              </span>
            </div>
          </div>
        </div>

        <div className={`${s.ctas} animate-in`}>
          <a href="#membership" className="btn btn-primary">
            {t.join}
          </a>
          <a href="/login" className="btn btn-outline-white">
            {t.signIn}
          </a>
        </div>
      </div>
    </section>
  );
}
