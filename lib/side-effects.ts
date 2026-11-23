// Outbound side effects (email, SMS, push, live payments, calendar writes,
// bank calls) only happen on the production deployment.
//
// Everywhere else (previews, local, CI) they default to OFF or CAPTURED, so a
// preview can never email a member, text a phone, charge a real card or pull
// the club's bank feed. That holds even though previews have some of the same
// secrets as production (RESEND_API_KEY, for example): the check is on the
// environment, not on whether a key happens to be set.
//
// Test plan §2: one test per side effect proves it's off outside production
// (tests/side-effects.test.ts).

export type SideEffect = "email" | "sms" | "push" | "stripe_live" | "calendar_write" | "akahu";

type Env = Record<string, string | undefined>;

/** True only on the production Vercel deployment. */
export function isProductionDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/** May this side effect really happen here? Production only. */
export function sideEffectAllowed(_kind: SideEffect, env: Env = process.env): boolean {
  return isProductionDeployment(env);
}

// ---------------------------------------------------------------------------
// Captured email. Outside production every email lands in this in-memory
// outbox instead of going to Resend. Playwright journeys read sign-in codes
// from it through /api/dev/outbox (only served when E2E_OUTBOX=1 and never on
// production).

export type CapturedEmail = {
  id: string;
  to: string[];
  from: string;
  subject: string;
  text: string;
  html: string;
  at: string;
};

const OUTBOX_KEY = Symbol.for("tw.captured-outbox");
type GlobalWithOutbox = typeof globalThis & { [OUTBOX_KEY]?: CapturedEmail[] };

export function capturedOutbox(): CapturedEmail[] {
  const g = globalThis as GlobalWithOutbox;
  if (!g[OUTBOX_KEY]) g[OUTBOX_KEY] = [];
  return g[OUTBOX_KEY];
}

export function clearCapturedOutbox(): void {
  capturedOutbox().length = 0;
}

type SendInput = {
  from?: string;
  to?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  [extra: string]: unknown;
};

let seq = 0;

function capture(input: SendInput): { data: { id: string }; error: null } {
  const id = `captured_${Date.now().toString(36)}_${(seq++).toString(36)}`;
  const to = Array.isArray(input.to) ? input.to : input.to ? [input.to] : [];
  const outbox = capturedOutbox();
  outbox.push({
    id,
    to,
    from: input.from ?? "",
    subject: input.subject ?? "",
    text: typeof input.text === "string" ? input.text : "",
    html: typeof input.html === "string" ? input.html : "",
    at: new Date().toISOString(),
  });
  // Keep memory bounded on a long-running preview.
  if (outbox.length > 200) outbox.splice(0, outbox.length - 200);
  return { data: { id }, error: null };
}

/**
 * Stand-in for the Resend client outside production. Covers the calls this
 * codebase makes (emails.send, batch.send); anything else fails loudly rather
 * than silently reaching the network.
 */
export function capturingResend(): {
  emails: { send: (input: SendInput) => Promise<{ data: { id: string }; error: null }> };
  batch: { send: (inputs: SendInput[]) => Promise<{ data: { data: { id: string }[] }; error: null }> };
} {
  return {
    emails: { send: async (input) => capture(input) },
    batch: {
      send: async (inputs) => ({ data: { data: inputs.map((i) => capture(i).data) }, error: null }),
    },
  };
}

// ---------------------------------------------------------------------------
// Stripe: test keys work anywhere; a LIVE key is refused outside production,
// so a mis-scoped environment variable can't take real money from a preview.

export function assertStripeKeyAllowed(secret: string, env: Env = process.env): void {
  const live = /^(sk|rk)_live_/.test(secret);
  if (live && !sideEffectAllowed("stripe_live", env)) {
    throw new Error("A live Stripe key is only used on the production deployment");
  }
}
