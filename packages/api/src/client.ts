// The transport under the generated client (client.gen.ts): one fetch per
// call, the bearer token when there is one, errors as ApiError. Works in a
// browser, a Capacitor web view and Node.
import { API_PREFIX, ENDPOINTS, fillPath, type EndpointId } from "./contract.ts";

export class ApiError extends Error {
  /** HTTP status; 0 when the request never got an answer (offline, DNS, CORS). */
  readonly status: number;
  /** The server's stable error code ("unauthorized", "bad_request", …) or "network". */
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
}

export type TransportOptions = {
  /** The host, e.g. "https://api.luvallplay.com" (no trailing slash). "" for the same origin. */
  baseUrl: string;
  /** The session token, or null when signed out. Asked on every call. */
  getToken?: () => string | null | Promise<string | null>;
  /** Send the web's session cookie (same-site web use). The app uses the bearer token instead. */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  /** Called on a 401 for an endpoint that needs a session, so the app can show sign-in. */
  onUnauthorized?: () => void;
  /** Check answers against the contract (development and tests). */
  validate?: boolean;
};

export type CallInput = {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

export type Transport = { call: (id: EndpointId, input?: CallInput) => Promise<unknown>; url: (id: EndpointId, input?: CallInput) => string };

export function createTransport(options: TransportOptions): Transport {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const url = (id: EndpointId, input: CallInput = {}): string => {
    const e = ENDPOINTS[id];
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(input.query ?? {})) if (v !== undefined && v !== null) search.set(k, String(v));
    const qs = search.toString();
    return `${options.baseUrl}${API_PREFIX}${fillPath(e.path, input.params)}${qs ? `?${qs}` : ""}`;
  };
  return {
    url,
    async call(id, input = {}) {
      const e = ENDPOINTS[id];
      const headers: Record<string, string> = { Accept: "application/json" };
      const token = await options.getToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
      const method: string = e.method;
      const hasBody = method !== "GET" && method !== "DELETE";
      if (hasBody) headers["Content-Type"] = "application/json";
      let res: Response;
      try {
        res = await doFetch(url(id, input), {
          method: e.method,
          headers,
          body: hasBody ? JSON.stringify(input.body ?? {}) : undefined,
          credentials: options.credentials ?? "omit",
          signal: input.signal,
        });
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") throw err;
        throw new ApiError(id, 0, "network", String((err as Error)?.message ?? err));
      }
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // Not JSON: a proxy's error page, or an empty body.
      }
      if (!res.ok) {
        const body = (data ?? {}) as { error?: unknown; message?: unknown };
        if (res.status === 401 && e.auth === "session") options.onUnauthorized?.();
        throw new ApiError(id, res.status, typeof body.error === "string" ? body.error : `http_${res.status}`, typeof body.message === "string" ? body.message : undefined);
      }
      if (options.validate) {
        const parsed = e.response.safeParse(data);
        if (!parsed.success) throw new ApiError(id, res.status, "contract", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      }
      return data;
    },
  };
}
