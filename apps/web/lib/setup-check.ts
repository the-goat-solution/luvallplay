import { JWT } from "google-auth-library";
import { list } from "@vercel/blob";
import { getStripe } from "./stripe";
import { getSmsUsage, lookupRecaptchaSiteKey } from "./sms";
import { PUBLIC_BLOB_SETUP_HINT, publicBlobAuth } from "./public-blob";
import { getSiteUrl } from "./email-layout";
import { sql } from "./database";
import journal from "@luvallplay/db/migrations/meta/_journal.json";

// Live checks behind Admin → Setup check: each piece the player accounts
// rely on, tested for real (no secrets are shown), with what to do if it
// isn't right. See docs/SETUP-player-accounts.md.

export type CheckStatus = "ok" | "warn" | "fail" | "off";
export type Check = { area: string; name: string; status: CheckStatus; detail: string; fix?: string };

const STRIPE_EVENTS = ["payment_intent.succeeded", "invoice.payment_succeeded", "customer.subscription.updated", "customer.subscription.deleted"];

async function safe(area: string, name: string, fn: () => Promise<Check>): Promise<Check> {
  try {
    return await fn();
  } catch (err) {
    return { area, name, status: "fail", detail: (err as Error).message.slice(0, 300) };
  }
}

export async function runSetupChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  // --- Basics -------------------------------------------------------------
  checks.push(
    process.env.PLAYER_SESSION_SECRET
      ? { area: "Basics", name: "Sign-in secret", status: "ok", detail: "PLAYER_SESSION_SECRET is set." }
      : {
          area: "Basics",
          name: "Sign-in secret",
          status: "fail",
          detail: "Not set: sign-in codes can't be checked, so nobody can sign in.",
          fix: "Add PLAYER_SESSION_SECRET (any long random string) in Vercel → Settings → Environment Variables, then redeploy.",
        },
  );
  const site = getSiteUrl();
  checks.push(
    process.env.NEXT_PUBLIC_SITE_URL && !site.includes("localhost")
      ? { area: "Basics", name: "Site address in emails", status: "ok", detail: site }
      : { area: "Basics", name: "Site address in emails", status: "warn", detail: `Emails link to ${site}.`, fix: "Set NEXT_PUBLIC_SITE_URL to https://threewolvesbadminton.org (no trailing slash)." },
  );
  checks.push(
    await safe("Basics", "Database schema", async () => {
      // Tables come from the versioned migrations (db/migrations), never
      // from a page load. Compare the newest one applied with the newest in
      // this build.
      const latest = journal.entries[journal.entries.length - 1];
      const { rows } = await sql.query(
        `SELECT max(created_at)::text AS at FROM drizzle.__drizzle_migrations`,
      ).catch(() => ({ rows: [{ at: null }] }));
      const applied = rows[0]?.at ? Number(rows[0].at) : null;
      if (applied === null) {
        return { area: "Basics", name: "Database schema", status: "warn", detail: "No migration history yet (the database predates versioned migrations).", fix: "Mark it as at the baseline: npm run db:migrate -- --baseline (see db/README.md)." };
      }
      if (applied < latest.when) {
        return { area: "Basics", name: "Database schema", status: "fail", detail: `Migrations waiting to run; this build expects ${latest.tag}.`, fix: "Run the pending migrations after their rehearsal (db/README.md, test plan §4.4)." };
      }
      return { area: "Basics", name: "Database schema", status: "ok", detail: `Up to date (${latest.tag}).` };
    }),
  );
  checks.push(
    process.env.RESEND_API_KEY && process.env.EMAIL_FROM
      ? { area: "Basics", name: "Email (Resend)", status: "ok", detail: `Sign-in codes and notices are sent from ${process.env.EMAIL_FROM}.` }
      : { area: "Basics", name: "Email (Resend)", status: "fail", detail: "Sign-in codes can't be emailed.", fix: "Set RESEND_API_KEY and EMAIL_FROM (already used by the roster email)." },
  );
  checks.push(
    process.env.ALERT_ADMIN_EMAILS
      ? { area: "Basics", name: "Admin alert recipients", status: "ok", detail: process.env.ALERT_ADMIN_EMAILS }
      : { area: "Basics", name: "Admin alert recipients", status: "warn", detail: "Alerts go to the club inbox (CLUB_ROSTER_EMAIL).", fix: "Optional: set ALERT_ADMIN_EMAILS (comma-separated)." },
  );

  // --- Stripe ---------------------------------------------------------------
  if (!process.env.STRIPE_SECRET_KEY) {
    checks.push({ area: "Stripe", name: "Stripe", status: "fail", detail: "STRIPE_SECRET_KEY is missing." });
  } else {
    const live = process.env.STRIPE_SECRET_KEY.startsWith("sk_live");
    checks.push({ area: "Stripe", name: "Mode", status: live ? "ok" : "warn", detail: live ? "Live keys." : "Test keys: no real money moves." });
    checks.push(
      await safe("Stripe", "Customer portal (Update card)", async () => {
        const stripe = getStripe();
        const id = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
        const config = id
          ? await stripe.billingPortal.configurations.retrieve(id)
          : (await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })).data[0];
        if (!config) {
          return {
            area: "Stripe",
            name: "Customer portal (Update card)",
            status: "fail",
            detail: "No customer portal settings saved yet, so “Update card” can't open.",
            fix: "Stripe Dashboard → Settings → Billing → Customer portal: turn on “Customers can update payment methods”, turn off cancellations and plan switching, then Save.",
          };
        }
        const problems: string[] = [];
        if (!config.features.payment_method_update.enabled) problems.push("payment method updates are off");
        if (config.features.subscription_cancel.enabled) problems.push("cancellations are on (players could skip the profile's cancel steps)");
        if (config.features.subscription_update.enabled) problems.push("plan switching is on (it would bypass change-at-renewal)");
        return problems.length
          ? { area: "Stripe", name: "Customer portal (Update card)", status: problems[0].startsWith("payment") ? "fail" : "warn", detail: `Portal settings: ${problems.join("; ")}.`, fix: "Stripe Dashboard → Settings → Billing → Customer portal: payment methods on, cancellations off, plan switching off. Save." }
          : { area: "Stripe", name: "Customer portal (Update card)", status: "ok", detail: "Players can update their card; cancelling stays in the profile." };
      }),
    );
    checks.push(
      await safe("Stripe", "Webhook events", async () => {
        const endpoints = await getStripe().webhookEndpoints.list({ limit: 100 });
        const ours = endpoints.data.filter((e) => e.url.includes("/api/stripe-webhook") && e.status === "enabled");
        if (ours.length === 0) {
          return { area: "Stripe", name: "Webhook events", status: "fail", detail: "No enabled webhook pointing at /api/stripe-webhook.", fix: `Stripe Dashboard → Developers → Webhooks → Add endpoint: ${site}/api/stripe-webhook with the events listed in the setup guide.` };
        }
        const events = new Set(ours.flatMap((e) => e.enabled_events));
        const missing = events.has("*") ? [] : STRIPE_EVENTS.filter((e) => !events.has(e));
        return missing.length
          ? { area: "Stripe", name: "Webhook events", status: "fail", detail: `Missing: ${missing.join(", ")}.`, fix: "Add those events to the /api/stripe-webhook endpoint in Stripe." }
          : { area: "Stripe", name: "Webhook events", status: "ok", detail: `${ours[0].url} receives all the events the site needs.` };
      }),
    );
  }

  // --- Photos ---------------------------------------------------------------
  const blobAuth = publicBlobAuth();
  checks.push(
    !blobAuth
      ? { area: "Photos", name: "Photo storage", status: "off", detail: "Photo sharing is switched off (players see “not set up yet”). Shop photo uploads need it too.", fix: PUBLIC_BLOB_SETUP_HINT }
      : await safe("Photos", "Photo storage", async () => {
          await list({ ...blobAuth, limit: 1 });
          const how = "token" in blobAuth ? "with PHOTO_BLOB_READ_WRITE_TOKEN" : "through the project connection (PHOTO_STORE_ID)";
          return { area: "Photos", name: "Photo storage", status: "ok", detail: `Connected to the photo Blob store ${how}. (It must be a Public store: a Private one fails on the first upload.)` };
        }),
  );
  checks.push(
    process.env.GOOGLE_VISION_ENABLED !== "1"
      ? { area: "Photos", name: "Safety check (SafeSearch)", status: "off", detail: "Off: every shared photo waits for an admin on Admin → Photos.", fix: "Enable the Cloud Vision API on the Google Cloud project and set GOOGLE_VISION_ENABLED=1 (setup guide, step 4)." }
      : await safe("Photos", "Safety check (SafeSearch)", async () => {
          const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
          const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
          if (!email || !key) return { area: "Photos", name: "Safety check (SafeSearch)", status: "fail", detail: "GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY are missing." };
          const jwt = new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/cloud-vision"] });
          // A 1×1 white PNG: proves the API is enabled and billing is attached.
          const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
          const res = await jwt.request<{ responses: { safeSearchAnnotation?: object; error?: { message: string } }[] }>({
            url: "https://vision.googleapis.com/v1/images:annotate",
            method: "POST",
            data: { requests: [{ image: { content: png }, features: [{ type: "SAFE_SEARCH_DETECTION" }] }] },
          });
          const r = res.data.responses?.[0];
          return r?.safeSearchAnnotation
            ? { area: "Photos", name: "Safety check (SafeSearch)", status: "ok", detail: "Google Cloud Vision answered. Photos are checked automatically." }
            : { area: "Photos", name: "Safety check (SafeSearch)", status: "fail", detail: r?.error?.message ?? "No answer from Vision." };
        }),
  );

  // --- SMS ------------------------------------------------------------------
  if (!process.env.FIREBASE_API_KEY) {
    checks.push({ area: "SMS", name: "Text-message codes", status: "off", detail: "Off: players sign in with email codes only.", fix: "Set up Firebase phone sign-in and FIREBASE_API_KEY (setup guide, step 5)." });
  } else {
    checks.push(
      await safe("SMS", "Firebase key and reCAPTCHA", async () => {
        const result = await lookupRecaptchaSiteKey();
        if (result.siteKey !== null) {
          return { area: "SMS", name: "Firebase key and reCAPTCHA", status: "ok", detail: "Google accepted the key and returned the reCAPTCHA site key." };
        }
        const r = result.reason.toLowerCase();
        const fix = r.includes("not valid") || r.includes("api_key_invalid")
          ? "The key in Vercel isn't a valid key. Copy the Web API Key again from Firebase → Project settings → General, update FIREBASE_API_KEY in Vercel, then redeploy."
          : r.includes("referer") || r.includes("referrer") || r.includes("ip address") || r.includes("android") || r.includes("ios")
            ? "The key has an application restriction. Google Cloud → APIs & Services → Credentials → the key → Application restrictions: None → Save (takes up to 5 minutes)."
            : r.includes("has not been used") || r.includes("disabled") || r.includes("service_disabled")
              ? "Enable the Identity Toolkit API: Google Cloud → APIs & Services → Library → “Identity Toolkit API” → Enable (on the same project as the key), wait a few minutes."
              : r.includes("blocked") || r.includes("api_key_service_blocked")
                ? "The key's API restrictions don't include Identity Toolkit. Credentials → the key → API restrictions → tick Identity Toolkit API → Save."
                : "Check the key (Firebase → Project settings → Web API Key), that Identity Toolkit API is allowed for it, and that Phone sign-in is enabled.";
        return { area: "SMS", name: "Firebase key and reCAPTCHA", status: "fail", detail: `Google said: ${result.reason}`, fix };
      }),
    );
    const usage = await getSmsUsage().catch(() => null);
    if (usage) {
      checks.push({
        area: "SMS",
        name: "Free-text cap",
        status: usage.switchedOn ? "ok" : "off",
        detail: `${usage.used} / ${usage.limit} texts in the last 24 hours${usage.switchedOn ? "" : " · switched off on Admin → Players"}.`,
      });
    }
  }

  // --- Cron -----------------------------------------------------------------
  checks.push(
    process.env.CRON_SECRET
      ? { area: "Basics", name: "Daily jobs", status: "ok", detail: "CRON_SECRET is set (shop reminders, releasing lapsed holds and webhook retries run with the daily reminders job)." }
      : { area: "Basics", name: "Daily jobs", status: "warn", detail: "CRON_SECRET isn't set.", fix: "Vercel sets it automatically for projects with cron jobs; check Settings → Environment Variables." },
  );

  return checks;
}
