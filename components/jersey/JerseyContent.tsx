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
const SIZE_CHART_IMG = "/uploads/jersey/shirt-measurements.jpg";

// Men's/unisex fit guide from the supplier's chart (height / weight), plus an
// approximate women's NZ/AU size, estimated from the shirt's chest width.
const FIT_ROWS: { size: string; height: string; weight: string; women: string }[] = [
  { size: "S", height: "160–165 cm", weight: "55–60 kg", women: "8–10" },
  { size: "M", height: "164–169 cm", weight: "60–65 kg", women: "10–12" },
  { size: "L", height: "170–174 cm", weight: "66–70 kg", women: "12–14" },
  { size: "XL", height: "174–176 cm", weight: "70–76 kg", women: "14–16" },
  { size: "XXL", height: "165–177 cm", weight: "76–80 kg", women: "16–18" },
];

// Real garment measurements, from the Yonex tee size chart (XXL = 2XL).
const SHIRT_ROWS: { size: string; length: string; width: string }[] = [
  { size: "S", length: "67 cm · 26.4\"", width: "47 cm · 18.5\"" },
  { size: "M", length: "70 cm · 27.6\"", width: "50 cm · 19.7\"" },
  { size: "L", length: "72 cm · 28.3\"", width: "53 cm · 20.9\"" },
  { size: "XL", length: "74 cm · 29.1\"", width: "56 cm · 22.0\"" },
  { size: "XXL", length: "76 cm · 29.9\"", width: "59 cm · 23.2\"" },
];

// "**bold**" in a dictionary string renders as <strong>.
function rich(text: string) {
  return text.split("**").map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

export function JerseyContent({
  opensAt,
  closesAt,
  serverNow,
  left,
}: {
  opensAt: string;
  closesAt: string;
  serverNow: string;
  left: number;
}) {
  const { tr } = useJerseyT();
  return (
    <>
      <Navigation />
      <JerseyHero opensAt={opensAt} closesAt={closesAt} serverNow={serverNow} earlyBirdsLeft={left} />

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
            <h3 className="jersey-table-title">{tr("fit_h")}</h3>
            <div className="jersey-table-wrap">
              <table className="jersey-table">
                <thead>
                  <tr><th>{tr("size")}</th><th>{tr("height")}</th><th>{tr("weight")}</th><th>{tr("women_eq")}</th></tr>
                </thead>
                <tbody>
                  {FIT_ROWS.map((r) => (
                    <tr key={r.size}><th scope="row">{r.size}</th><td>{r.height}</td><td>{r.weight}</td><td>{r.women}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="jersey-table-title">{tr("shirt_h")}</h3>
            <div className="jersey-table-wrap">
              <table className="jersey-table">
                <thead>
                  <tr><th>{tr("size")}</th><th>{tr("length")}</th><th>{tr("width")}</th></tr>
                </thead>
                <tbody>
                  {SHIRT_ROWS.map((r) => (
                    <tr key={r.size}><th scope="row">{r.size}</th><td>{r.length}</td><td>{r.width}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="form-hint" style={{ marginTop: 12 }}>{tr("size_note")}</p>
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
          <JerseyForm opensAt={opensAt} closesAt={closesAt} serverNow={serverNow} earlyBirdsLeft={left} />
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
          <a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer" aria-label={SPONSOR_NAME} className="jersey-sponsor-logo">
            <img src="/uploads/jersey/house-of-barber-logo.svg" alt={`${SPONSOR_NAME} logo`} width={220} height={220} />
          </a>
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
