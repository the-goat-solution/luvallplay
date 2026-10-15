import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { BankDetails } from "@/components/jersey/BankDetails";
import { JerseyForm } from "@/components/jersey/JerseyForm";
import { JerseyHero } from "@/components/jersey/JerseyHero";
import {
  EARLY_BIRD_LIMIT,
  JERSEY_SIZES,
  SPONSOR_NAME,
  SPONSOR_URL,
  jerseyOpensAt,
} from "@/lib/jersey";
import { earlyBirdsLeft } from "@/lib/jersey-db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Club Jersey — Three Wolves Badminton Club",
  description:
    "Register for the official Three Wolves Badminton Club Yonex jersey. First 10 pay $15. Sponsored by House of Barber.",
};

// Swap these two for the real images (design + supplier size chart) when
// they're added to public/uploads/jersey/.
const DESIGN_IMG = "/uploads/jersey/design-placeholder.svg";
const SIZE_CHART_IMG = "/uploads/jersey/size-chart-placeholder.svg";

export default async function JerseyPage() {
  let left = EARLY_BIRD_LIMIT;
  if (process.env.POSTGRES_URL) {
    try {
      left = await earlyBirdsLeft();
    } catch (err) {
      console.error("Jersey page status failed", err);
    }
  }
  const opensAt = jerseyOpensAt().toISOString();
  const serverNow = new Date().toISOString();

  return (
    <>
      <Navigation />
      <JerseyHero opensAt={opensAt} serverNow={serverNow} earlyBirdsLeft={left} />

      <section className="section">
        <div className="container jersey-two">
          <div>
            <div className="section-label">The Jersey</div>
            <h2 className="section-title">Authentic Yonex</h2>
            <p className="section-sub">
              Our official club jersey is made by Yonex, printed in Vietnam and shipped to New Zealand. Delivery is expected around
              early November. Jerseys will be handed out at a play day, to be announced.
            </p>
            <ul className="jersey-list">
              <li><strong>$15</strong> for the first {EARLY_BIRD_LIMIT} registrations, <strong>$30</strong> after that</li>
              <li>Optional name &amp; number on the back for <strong>+$5</strong></li>
              <li>One jersey per person</li>
            </ul>
          </div>
          <img src={DESIGN_IMG} alt="Three Wolves club jersey design" className="jersey-img" />
        </div>
      </section>

      <section className="section section-cream">
        <div className="container jersey-two">
          <img src={SIZE_CHART_IMG} alt="Jersey size chart" className="jersey-img" />
          <div>
            <div className="section-label">Sizing</div>
            <h2 className="section-title">Find your size</h2>
            <p className="section-sub">
              Available sizes: {JERSEY_SIZES.join(", ")}. Measure a shirt that fits you well and compare it with the chart. Between sizes?
              Size up.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-label">How it works</div>
          <h2 className="section-title">Three quick steps</h2>
          <ol className="jersey-steps">
            <li><span>1</span><div><strong>Register</strong><br />Fill in the form below. You&apos;ll get a personal 5-digit reference code.</div></li>
            <li><span>2</span><div><strong>Pay by bank transfer</strong><br />Send the amount to the club account and put your code in the <em>reference</em> field.</div></li>
            <li><span>3</span><div><strong>We match it automatically</strong><br />Your payment is matched by your code and you&apos;ll get a confirmation email.</div></li>
          </ol>
          <div className="jersey-card" style={{ maxWidth: 560, margin: "28px auto 0" }}>
            <h3 className="jersey-card-title">Club bank account</h3>
            <BankDetails />
          </div>
        </div>
      </section>

      <section className="section section-navy" id="register">
        <div className="container" style={{ maxWidth: 680 }}>
          <div className="section-label" style={{ justifyContent: "center", display: "flex" }}>Registration</div>
          <h2 className="section-title section-title-white" style={{ textAlign: "center", marginBottom: 28 }}>Get your jersey</h2>
          <JerseyForm opensAt={opensAt} serverNow={serverNow} earlyBirdsLeft={left} />
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ maxWidth: 760 }}>
          <div className="section-label">Good to know</div>
          <h2 className="section-title">The rules</h2>
          <ul className="jersey-list" style={{ marginTop: 24 }}>
            <li><strong>First come, first served.</strong> One jersey per person; duplicate registrations are cancelled.</li>
            <li><strong>Always include your reference code</strong> when you pay. Without it we may not find your transfer and you could lose your spot.</li>
            <li><strong>Early-bird spots are held for 48 hours.</strong> If your payment hasn&apos;t arrived by then, the spot goes to the next person.</li>
            <li><strong>Paying more than the price?</strong> The difference goes to the club&apos;s funds — thank you! We can&apos;t offer refunds.</li>
            <li><strong>Pick-up</strong> is at a play day, which will be announced once the jerseys arrive.</li>
          </ul>
        </div>
      </section>

      <section className="section section-cream">
        <div className="container" style={{ maxWidth: 760, textAlign: "center" }}>
          <div className="section-label" style={{ justifyContent: "center", display: "flex" }}>Our sponsor</div>
          <h2 className="section-title">{SPONSOR_NAME}</h2>
          <p className="section-sub" style={{ margin: "16px auto 0" }}>
            Proudly sponsored by {SPONSOR_NAME}. Owner Jason Nguyen offers <strong>10% off a haircut</strong> to anyone wearing the Three
            Wolves jersey.
          </p>
          <div style={{ marginTop: 24 }}>
            <a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer" className="btn btn-navy">Visit {SPONSOR_NAME}</a>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
