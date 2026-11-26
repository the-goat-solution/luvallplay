// The Stripe SDK client: the one place it is made (Phase 6 Stage B, W1).
// Everything that talks to Stripe gets its client here, so the key check
// and the club's connected account can't be skipped.
//
// Stripe Connect (build plan §6.5): the platform's key acts ON a club's own
// Stripe account ("direct charges"), so the money, customers, subscriptions
// and payouts are the club's, never Luvallplay's. Naming the account once,
// here, puts it on every request the app makes.
//
//   STRIPE_CONNECT_ACCOUNT   the club's connected account (acct_…). Unset
//                            (today, Three Wolves): the key's own account,
//                            exactly as before Connect.
//   STRIPE_CONNECT_FEE_BPS   the platform's fee in basis points (100 = 1%).
//                            Unset or 0: no fee, and nothing about a fee is
//                            sent to Stripe (the plan's 0%).
//
// W1 is test mode only: a connected account with a live key is refused.
// (One club per deployment for now; the account moves to the club's own
// payment settings with the wizard, W2.)
import Stripe from "stripe";
import { assertStripeKeyAllowed } from "../side-effects.ts";

type Env = Record<string, string | undefined>;

/** The club's connected account, or null when the key's own account is used. */
export function connectedAccount(env: Env = process.env): string | null {
  const v = env.STRIPE_CONNECT_ACCOUNT?.trim();
  if (!v) return null;
  if (!/^acct_[A-Za-z0-9]{6,}$/.test(v)) throw new Error("STRIPE_CONNECT_ACCOUNT must be a Stripe account id (acct_…)");
  return v;
}

/** The platform's fee on a connected account's payments, in basis points. 0 unless set. */
export function applicationFeeBps(env: Env = process.env): number {
  const v = env.STRIPE_CONNECT_FEE_BPS?.trim();
  if (!v) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new Error("STRIPE_CONNECT_FEE_BPS must be a whole number of basis points from 0 to 10000");
  return n;
}

/** What the Stripe provider adds to each request: nothing without a connected account. */
export function connectSettings(env: Env = process.env): { account: string | null; feeBps: number } {
  const account = connectedAccount(env);
  return { account, feeBps: account ? applicationFeeBps(env) : 0 };
}

/** A connected account is only ever used with a test key (W1). */
export function assertConnectAllowed(secret: string, account: string | null): void {
  if (account && !/^(sk|rk)_test_/.test(secret)) {
    throw new Error("Stripe Connect is in test mode only: STRIPE_CONNECT_ACCOUNT can't be used with a live key");
  }
}

function secretKey(env: Env): string {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  // A live key is refused outside production; test keys work anywhere.
  assertStripeKeyAllowed(secret, env);
  return secret;
}

let override: Stripe | null = null;
const clients = new Map<string, Stripe>();

function clientFor(secret: string, account: string | null): Stripe {
  const key = `${secret}|${account ?? ""}`;
  let client = clients.get(key);
  if (!client) {
    client = account ? new Stripe(secret, { stripeAccount: account }) : new Stripe(secret);
    clients.set(key, client);
  }
  return client;
}

/** The client for the club's payments: on its connected account when it has one. */
export function getStripe(env: Env = process.env): Stripe {
  const secret = secretKey(env);
  const account = connectedAccount(env);
  assertConnectAllowed(secret, account);
  return override ?? clientFor(secret, account);
}

/** The platform's own client, for what is about the platform itself: creating and onboarding connected accounts. Never for a club's payments. */
export function getPlatformStripe(env: Env = process.env): Stripe {
  return override ?? clientFor(secretKey(env), null);
}

/** For tests: use this client instead of one made from the key (null: from the key again). */
export function setStripeForTests(client: Stripe | null): void {
  override = client;
}
