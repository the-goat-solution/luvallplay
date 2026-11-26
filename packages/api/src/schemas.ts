// The shapes the players' app API sends and accepts (build plan §4.1,
// test plan §3.7). One source for the server (validation at the edge), the
// client (types) and the contract snapshot (backward compatibility).
//
// Rules for changing these while the version stays the same:
// - adding an optional request field or a response field is fine;
// - removing or renaming a field, changing its type, or making a request
//   field required is a breaking change: it needs a new API version.
// The snapshot test (apps/web/tests/api-contract.test.ts) enforces this.
//
// One file per module in ./schemas/ (build plan §9.4): add a module's shapes
// in its own file, and a new module as a new file exported here.
export * from "./schemas/common.ts";
export * from "./schemas/auth.ts";
export * from "./schemas/clubs.ts";
export * from "./schemas/me.ts";
export * from "./schemas/messages.ts";
export * from "./schemas/account.ts";
export * from "./schemas/integrations.ts";
export * from "./schemas/arena.ts";
export * from "./schemas/leaderboard.ts";
export * from "./schemas/player.ts";
export * from "./schemas/shop.ts";
export * from "./schemas/membership.ts";
export * from "./schemas/vision.ts";
export * from "./schemas/photos.ts";
export * from "./schemas/family.ts";
