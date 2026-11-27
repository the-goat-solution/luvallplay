// What one endpoint of the players' app API declares (see contract.ts).
import type { z } from "zod";

export type Auth =
  /** Anyone. */
  | "public"
  /** A signed-in person: bearer token (the app) or the session cookie (the web). */
  | "session";

export type Endpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Relative to API_PREFIX; `{name}` marks a path parameter. */
  path: string;
  auth: Auth;
  /** "club": the path names a club and the answer is only ever about that club. */
  scope: "account" | "club";
  /** The module that owns it: with that module off for the club, the endpoint answers 404. */
  module?: string;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  response: z.ZodTypeAny;
  /**
   * Requests per window per caller (the signed-in person, else the address).
   * Server-side only: none of this is part of what apps are built against.
   */
  rateLimit: {
    limit: number;
    windowMs: number;
    /**
     * Count in the store every server instance shares (when the deployment
     * has one: RATE_LIMIT_STORE=database). Every non-GET endpoint already
     * does; this is for a GET whose limit has to hold across instances.
     */
    shared?: boolean;
    /**
     * When the shared store can't answer, refuse (503 rate_limit_unavailable)
     * instead of counting on the one instance. For writes where a limit that
     * quietly stops holding is worse than a refusal (Social, Marketplace).
     */
    failClosed?: boolean;
  };
};

export const MIN = 60_000;

/**
 * One module's endpoints. Every id starts with the module's own prefix
 * (`arena.state` lives in endpoints/arena.ts), so two files can't claim the same id.
 */
export function defineEndpoints<P extends string, T extends Record<`${P}.${string}`, Endpoint>>(prefix: P, endpoints: T): T {
  for (const id of Object.keys(endpoints)) {
    if (!id.startsWith(`${prefix}.`)) throw new Error(`endpoints/${prefix}.ts: "${id}" must start with "${prefix}."`);
  }
  return endpoints;
}
