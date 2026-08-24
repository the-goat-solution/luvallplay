"use client";

import { useState } from "react";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";

export default function CancelMembershipPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/cancel-membership/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // Ignore — we show the same message either way.
    } finally {
      setSubmitting(false);
      setDone(true);
    }
  };

  return (
    <>
      <Navigation />
      <section className="section section-navy" style={{ minHeight: "70vh", display: "flex", alignItems: "center" }}>
        <div className="container" style={{ maxWidth: 520 }}>
          <div
            style={{
              background: "#fff",
              borderRadius: "var(--radius-lg)",
              padding: "40px 36px",
              textAlign: "center",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 28,
                color: "var(--navy)",
                marginBottom: 10,
                textTransform: "uppercase",
                letterSpacing: ".04em",
              }}
            >
              Cancel your membership
            </h1>

            {done ? (
              <p style={{ color: "var(--text-dark)", lineHeight: 1.7 }}>
                If that email has an active monthly or quarterly membership, we&apos;ve
                sent a link to confirm the cancellation. It expires in 24 hours —
                check your inbox (and spam folder).
              </p>
            ) : (
              <>
                <p style={{ color: "var(--text-light)", marginBottom: 24, lineHeight: 1.7 }}>
                  Enter the email your membership is under. We&apos;ll send you a link
                  to confirm — your membership stays active through the end of the
                  billing period you&apos;ve already paid for.
                </p>
                <form onSubmit={onSubmit}>
                  <div className="form-group" style={{ textAlign: "left" }}>
                    <label className="form-label" htmlFor="cancel-email">
                      Email
                    </label>
                    <input
                      id="cancel-email"
                      type="email"
                      required
                      className="form-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-navy btn-full"
                    disabled={submitting}
                  >
                    {submitting ? "Sending…" : "Send cancellation link"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
