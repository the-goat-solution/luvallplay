import { test } from "node:test";
import assert from "node:assert/strict";
import { renderWelcomeEmail, WELCOME_SUBJECT } from "../lib/welcome-email-template.ts";

const siteUrl = "https://threewolvesbadminton.org";

test("welcome email is personalised and keeps the one-click opt-out", () => {
  const optOutUrl = "https://threewolvesbadminton.org/api/profile/leaderboard-optout?token=abc123";
  const { subject, html, text } = renderWelcomeEmail({ to: "mai+tw@example.com", firstName: "Mai", optOutUrl, siteUrl });
  assert.equal(subject, WELCOME_SUBJECT);
  assert.match(html, /Kia ora Mai,/);
  assert.ok(html.includes("https://threewolvesbadminton.org/login?email=mai%2Btw%40example.com"));
  assert.ok(html.includes(optOutUrl));
  assert.ok(html.includes("https://threewolvesbadminton.org/uploads/Three%20wolves%20logo.png"));
  assert.ok(!html.includes("${"), "no unfilled placeholders");
  assert.ok(text.includes(optOutUrl) && text.includes("Kia ora Mai,"));
});

test("welcome email escapes names and handles a missing name", () => {
  const { html } = renderWelcomeEmail({ to: "a@b.co", firstName: "<b>Kim</b>", optOutUrl: "https://x.test/o?t=1&u=2", siteUrl });
  assert.ok(html.includes("Kia ora &lt;b&gt;Kim&lt;/b&gt;,"));
  assert.ok(html.includes("https://x.test/o?t=1&amp;u=2"));
  assert.match(renderWelcomeEmail({ to: "a@b.co", firstName: " ", optOutUrl: "https://x.test", siteUrl }).html, /Kia ora,</);
});
