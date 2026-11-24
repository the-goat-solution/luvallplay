// The contract as data: one entry per endpoint. The committed copy
// (contract.snapshot.json) is what released apps were built against.
import { API_VERSION, ENDPOINTS, type Endpoint } from "./contract.ts";
import { shapeOf, breakingChanges, type Shape } from "./shape.ts";

export type EndpointSnapshot = {
  method: string;
  path: string;
  auth: string;
  params?: Shape;
  query?: Shape;
  body?: Shape;
  response: Shape;
};
export type ContractSnapshot = { version: string; endpoints: Record<string, EndpointSnapshot> };

export function currentSnapshot(): ContractSnapshot {
  const endpoints: Record<string, EndpointSnapshot> = {};
  for (const id of Object.keys(ENDPOINTS).sort()) {
    const e: Endpoint = ENDPOINTS[id as keyof typeof ENDPOINTS];
    endpoints[id] = {
      method: e.method,
      path: e.path,
      auth: e.auth,
      ...(e.params ? { params: shapeOf(e.params) } : {}),
      ...(e.query ? { query: shapeOf(e.query) } : {}),
      ...(e.body ? { body: shapeOf(e.body) } : {}),
      response: shapeOf(e.response),
    };
  }
  return { version: API_VERSION, endpoints };
}

/** Everything in `after` that would break an app built against `before`. Empty when the version changed. */
export function contractBreaks(before: ContractSnapshot, after: ContractSnapshot): string[] {
  if (before.version !== after.version) return [];
  const out: string[] = [];
  for (const [id, was] of Object.entries(before.endpoints)) {
    const now = after.endpoints[id];
    if (!now) {
      out.push(`${id}: endpoint removed`);
      continue;
    }
    if (was.method !== now.method || was.path !== now.path) out.push(`${id}: ${was.method} ${was.path} → ${now.method} ${now.path}`);
    if (was.auth === "public" && now.auth !== "public") out.push(`${id}: now needs sign-in`);
    for (const part of ["params", "query", "body"] as const) {
      out.push(...breakingChanges(was[part], now[part], "request").map((m) => `${id} ${part}${m}`));
      if (!was[part] && now[part]) out.push(...breakingChanges({ t: "object", fields: {} }, now[part], "request").map((m) => `${id} ${part}${m}`));
    }
    out.push(...breakingChanges(was.response, now.response, "response").map((m) => `${id} response${m}`));
  }
  return out;
}
