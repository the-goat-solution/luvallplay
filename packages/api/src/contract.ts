// The players' app API, endpoint by endpoint (build plan §4.1).
//
// Served by apps/web under /api/v1/app/... . The older /api/v1/* routes
// (personal access keys, shared with the MCP server) are a different surface
// and are not described here; their shapes don't change.
//
// One file per module in ./endpoints/ (and its shapes in ./schemas/), so
// each build lane adds endpoints in its own file (build plan §9.4):
// additions only, then `pnpm --filter @luvallplay/api generate` and
// `snapshot`. A new module is a new file, listed below.
import type { z } from "zod";
import { authEndpoints } from "./endpoints/auth.ts";
import { clubsEndpoints } from "./endpoints/clubs.ts";
import { meEndpoints } from "./endpoints/me.ts";
import { messagesEndpoints } from "./endpoints/messages.ts";
import { accountEndpoints } from "./endpoints/account.ts";
import { integrationsEndpoints } from "./endpoints/integrations.ts";
import { arenaEndpoints } from "./endpoints/arena.ts";
import { leaderboardEndpoints } from "./endpoints/leaderboard.ts";
import { playerEndpoints } from "./endpoints/player.ts";
import { shopEndpoints } from "./endpoints/shop.ts";
import { membershipEndpoints } from "./endpoints/membership.ts";
import { playEndpoints } from "./endpoints/play.ts";
import { visionEndpoints } from "./endpoints/vision.ts";
import { photosEndpoints } from "./endpoints/photos.ts";

export type { Auth, Endpoint } from "./endpoint.ts";

/** Bump only for a breaking change; the old version keeps being served beside the new one. */
export const API_VERSION = "v1";
/** Path of this API on its host. */
export const API_PREFIX = `/api/${API_VERSION}/app`;

export const ENDPOINTS = {
  ...authEndpoints,
  ...clubsEndpoints,
  ...meEndpoints,
  ...messagesEndpoints,
  ...accountEndpoints,
  ...integrationsEndpoints,
  ...arenaEndpoints,
  ...leaderboardEndpoints,
  ...playerEndpoints,
  ...shopEndpoints,
  ...membershipEndpoints,
  ...playEndpoints,
  ...visionEndpoints,
  ...photosEndpoints,
};

export type EndpointId = keyof typeof ENDPOINTS;
type Def<K extends EndpointId> = (typeof ENDPOINTS)[K];
type Infer<T> = T extends z.ZodTypeAny ? z.input<T> : undefined;
type Out<T> = T extends z.ZodTypeAny ? z.output<T> : undefined;

export type ParamsOf<K extends EndpointId> = Def<K> extends { params: infer P } ? Infer<P> : undefined;
export type QueryOf<K extends EndpointId> = Def<K> extends { query: infer Q } ? Infer<Q> : undefined;
export type BodyOf<K extends EndpointId> = Def<K> extends { body: infer B } ? Infer<B> : undefined;
export type ResponseOf<K extends EndpointId> = Out<Def<K>["response"]>;

export { fillPath } from "./path.ts";
