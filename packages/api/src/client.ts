// The transport under the generated client (client.gen.ts): one fetch per
// call, the bearer token when there is one, errors as ApiError. Works in a
// browser, a Capacitor web view and Node.
// It imports only the generated route table (no zod), to keep the app small.
import { API_PREFIX, ROUTES, type RouteId as EndpointId } from "./routes.gen.ts";

export { fillPath } from "./path.ts";
import { fillPath } from "./path.ts";

export class ApiError extends Error {
  /** HTTP status; 0 when the request never got an answer (offline, DNS, CORS). */
  readonly status: number;
  /**
   * The server's stable error code ("unauthorized", "bad_request", …), or one
   * of the client's own: "network" (no answer), "timeout" (no answer in time),
   * "bad_response" (an answer that isn't the API's: a Wi-Fi sign-in page, a
   * proxy's error page).
   */
  readonly code: string;
  readonly endpoint: string;
  constructor(endpoint: string, status: number, code: string, message?: string) {
    super(message ?? `${endpoint}: ${code}`);
    this.name = "ApiError";
    this.endpoint = endpoint;
    this.status = status;
    this.code = code;
  }
  get offline(): boolean {
    return this.status === 0;
  }
  /** Worth sending again later as it is: no answer, not the API's answer, the server's own failure, or "slow down". */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 408 || this.status === 429 || this.code === "bad_response";
  }
}

export type TransportOptions = {
  /** The host, e.g. "https://api.luvallplay.com" (no trailing slash). "" for the same origin. */
  baseUrl: string;
  /** The session token, or null when signed out. Asked on every call. */
  getToken?: () => string | null | Promise<string | null>;
  /** Send the web's session cookie (same-site web use). The app uses the bearer token instead. */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  /**
   * Called on a 401 for an endpoint that needs a session, so the app can show
   * sign-in. `token` is the one that call was sent with: the app compares it
   * with the current one, so a late answer to an old session doesn't sign a
   * new one out.
   */
  onUnauthorized?: (token: string | null) => void;
  /** How long a call may take before it fails with "timeout" (default 30 seconds; 0 for no limit). */
  timeoutMs?: number;
  /**
   * Check answers against the contract (development and tests): pass
   * `contractValidator` from "@luvallplay/api/validate". Returns a description
   * of what is wrong, or null.
   */
  validate?: (id: EndpointId, data: unknown) => string | null;
};

export type CallInput = {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

export type Transport = { call: (id: EndpointId, input?: CallInput) => Promise<unknown>; url: (id: EndpointId, input?: CallInput) => string };

const DEFAULT_TIMEOUT_MS = 30_000;

export function createTransport(options: TransportOptions): Transport {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const url = (id: EndpointId, input: CallInput = {}): string => {
    const e = ROUTES[id];
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(input.query ?? {})) if (v !== undefined && v !== null) search.set(k, String(v));
    const qs = search.toString();
    return `${options.baseUrl}${API_PREFIX}${fillPath(e.path, input.params)}${qs ? `?${qs}` : ""}`;
  };
  return {
    url,
    async call(id, input = {}) {
      const e = ROUTES[id];
      const headers: Record<string, string> = { Accept: "application/json" };
      const token = await options.getToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
      const method: string = e.method;
      const hasBody = method !== "GET" && method !== "DELETE";
      if (hasBody) headers["Content-Type"] = "application/json";
      // One limit for the whole call (the answer's headers and its body), on
      // top of the caller's own signal.
      const limit = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      let timedOut = false;
      const timer = limit > 0 ? setTimeout(() => ((timedOut = true), controller.abort()), limit) : null;
      const onAbort = () => controller.abort();
      if (input.signal?.aborted) controller.abort();
      else input.signal?.addEventListener("abort", onAbort, { once: true });
      let res: Response;
      let data: unknown = null;
      let parsed = false;
      try {
        res = await doFetch(url(id, input), {
          method: e.method,
          headers,
          body: hasBody ? JSON.stringify(input.body ?? {}) : undefined,
          credentials: options.credentials ?? "omit",
          signal: controller.signal,
        });
        try {
          data = await res.json();
          parsed = true;
        } catch (err) {
          // Not JSON: a proxy's error page, a Wi-Fi sign-in page, or an empty body.
          if (timedOut || controller.signal.aborted) throw err;
        }
      } catch (err) {
        if (timedOut) throw new ApiError(id, 0, "timeout");
        if (input.signal?.aborted || (err as { name?: string })?.name === "AbortError") throw err;
        throw new ApiError(id, 0, "network", String((err as Error)?.message ?? err));
      } finally {
        if (timer) clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
      }
      if (!res.ok) {
        const body = (data ?? {}) as { error?: unknown; message?: unknown };
        // Only the API's own 401 counts: a proxy's or a sign-in page's isn't about this session.
        if (res.status === 401 && e.auth === "session" && typeof body.error === "string") options.onUnauthorized?.(token ?? null);
        throw new ApiError(id, res.status, typeof body.error === "string" ? body.error : `http_${res.status}`, typeof body.message === "string" ? body.message : undefined);
      }
      // "OK" with something that isn't the API's JSON (every endpoint answers
      // with an object): never handed on as data.
      if (!parsed || data === null || typeof data !== "object") throw new ApiError(id, res.status, "bad_response");
      const wrong = options.validate?.(id, data);
      if (wrong) throw new ApiError(id, res.status, "contract", wrong);
      return data;
    },
  };
}
