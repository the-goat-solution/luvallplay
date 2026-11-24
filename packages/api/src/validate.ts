// Checks an answer against the contract. Kept out of client.ts so only
// callers that want it (development, tests) bundle zod.
import { ENDPOINTS, type EndpointId } from "./contract.ts";

export function contractValidator(id: EndpointId, data: unknown): string | null {
  const parsed = ENDPOINTS[id].response.safeParse(data);
  return parsed.success ? null : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}
