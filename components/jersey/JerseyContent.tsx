"use client";

import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { useJerseyT } from "@/lib/jersey-i18n";
import {
  JERSEY_SIZES,
  SPONSOR_NAME,
  SPONSOR_URL,
} from "@/lib/jersey";
import { BankDetails } from "./BankDetails";
import { JerseyForm } from "./JerseyForm";
import { JerseyHero } from "./JerseyHero";

const DESIGN_IMG = "/uploads/jersey/design.webp";
const SIZE_CHART_IMG = "/uploads/jersey/size-chart.jpg";

// From the supplier's chart (height / weight), per size.
const SIZE_ROWS: { size: string; men: [string, string]; women: [string, string] }[] = [
  { size: "S", men: ["160–165 cm", "55–60 kg"], women: ["148–153 cm", "38–43 kg"] },
  { size: "M", men: ["164–169 cm", "60–65 kg"], women: ["153–155 cm", "43–46 kg"] },
  { size: "L", men: ["170–174 cm", "66–70 kg"], women: ["153–158 cm", "46–53 kg"] },
  { size: "XL", men: ["174–176 cm", "70–76 kg"], women: ["155–162 cm", "53–57 kg"] },
  { size: "XXL", men: ["165–177 cm", "76–80 kg"], women: ["155–166 cm", "57–66 kg"] },
];

// "**bold**" in a dictionary string renders as <strong>.
function rich(text: string) {
  return text.split("**").map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

export function JerseyContent({ opensAt, serverNow, left }: { opensAt: string; serverNow: string; left: number }) {
  const { tr } = useJerseyT();
  return (
    <>
      <Navigation />
      <JerseyHero opensAt={opensAt} serverNow={serverNow} earlyBirdsLeft={left} />

      <section className="section">
        <div className="container">
          <div className="jersey-two" style={{ alignItems: "start" }}>
            <div>
              <div className="section-label">{tr("jersey_label")}</div>
              <h2 className="section-title">{tr("jersey_h")}</h2>
              <p className="section-sub">{tr("jersey_p")}</p>
            </div>
            <ul className="jersey-list">
              <li>{rich(tr("price_li1"))}</li>
              <li>{rich(tr("price_li2"))}</li>
              <li>{tr("price_li3")}</li>
            </ul>
          </div>
          <img src={DESIGN_IMG} alt={tr("design_alt")} className="jersey-img" style={{ marginTop: 36 }} />
        </div>
      </section>

      <section className="section section-cream">
        <div className="container jersey-two">
          <img src={SIZE_CHART_IMG} alt={tr("size_alt")} className="jersey-img" />
          <div>
            <div className="section-label">{tr("size_label")}</div>
            <h2 className="section-title">{tr("size_h")}</h2>
            <p className="section-sub">{tr("size_p", { sizes: JERSEY_SIZES.join(", ") })}</p>
            <div className="jersey-table-wrap">
              <table className="jersey-table">
                <thead>
                  <tr><th rowSpan={2}>{tr("size")}</th><th colSpan={2}>{tr("men")}</th><th colSpan={2}>{tr("women")}</th></tr>
                  <tr><th>{tr("height")}</th><th>{tr("weight")}</th><th>{tr("height")}</th><th>{tr("weight")}</th></tr>
                </thead>
                <tbody>
                  {SIZE_ROWS.map((r) => (
                    <tr key={r.size}><th scope="row">{r.size}</th><td>{r.men[0]}</td><td>{r.men[1]}</td><td>{r.women[0]}</td><td>{r.women[1]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-label">{tr("how_label")}</div>
          <h2 className="section-title">{tr("how_h")}</h2>
          <ol className="jersey-steps">
            {([1, 2, 3] as const).map((n) => (
              <li key={n}>
                <span>{n}</span>
                <div><strong>{tr(`step${n}_t`)}</strong><br />{tr(`step${n}_d`)}</div>
              </li>
            ))}
          </ol>
          <div className="jersey-card" style={{ maxWidth: 560, margin: "28px auto 0" }}>
            <h3 className="jersey-card-title">{tr("bank_h")}</h3>
            <BankDetails />
          </div>
        </div>
      </section>

      <section className="section section-navy" id="register">
        <div className="container" style={{ maxWidth: 680 }}>
          <div className="section-label" style={{ justifyContent: "center", display: "flex" }}>{tr("reg_label")}</div>
          <h2 className="section-title section-title-white" style={{ textAlign: "center", marginBottom: 28 }}>{tr("reg_h")}</h2>
          <JerseyForm opensAt={opensAt} serverNow={serverNow} earlyBirdsLeft={left} />
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ maxWidth: 760 }}>
          <div className="section-label">{tr("rules_label")}</div>
          <h2 className="section-title">{tr("rules_h")}</h2>
          <ul className="jersey-list" style={{ marginTop: 24 }}>
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <li key={n}><strong>{tr(`r${n}`)}</strong> {tr(`r${n}d`)}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section section-cream">
        <div className="container" style={{ maxWidth: 760, textAlign: "center" }}>
          <div className="section-label" style={{ justifyContent: "center", display: "flex" }}>{tr("sponsor_label")}</div>
          <h2 className="section-title">{SPONSOR_NAME}</h2>
          <p className="section-sub" style={{ margin: "16px auto 0" }}>{rich(tr("sponsor_p"))}</p>
          <div style={{ marginTop: 24 }}>
            <a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer" className="btn btn-navy">{tr("visit")}</a>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
