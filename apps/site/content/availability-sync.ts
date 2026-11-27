// Keeps the website's availability list in step with the platform.
//
// Every module in the platform's registry (packages/modules/src/registry.ts)
// is named here, with the availability line(s) on the website that describe
// it. tests/availability-sync.test.ts then checks, both ways:
//
//   - a module the platform hides is "soon" on the website;
//   - a line the website calls "live" or "limited" has at least one module
//     behind it that the platform hasn't hidden, and none of them in beta
//     if the line says "live";
//   - a line the website calls "soon" while its module is already switched
//     on says why here (`soonBecause`), so it is a decision, not a slip.
//
// A new module fails the test until it is added here, so the website can't
// miss a feature the platform has, or advertise one it has hidden.

export type ModuleLines = { lines: readonly string[]; soonBecause?: string };

export const MODULE_LINES: Readonly<Record<string, ModuleLines>> = {
  // Core: every club has these.
  home: { lines: ["sessions"] },
  "play-days": { lines: ["sessions"] },
  people: { lines: ["admin"] },
  messages: { lines: ["messages"] },
  website: {
    lines: ["clubWebsites"],
    soonBecause: "The first club's own website runs on this module; a site editor and own domains for every club come with club set-up.",
  },
  settings: { lines: ["modules", "brand"] },
  // Optional modules.
  "calendar-sync": { lines: ["calendarSync"] },
  "casual-play": { lines: ["sessions"] },
  "court-board": { lines: ["matchDay"] },
  "round-robin": { lines: ["matchDay"] },
  "day-requests": { lines: ["sessions"] },
  memberships: { lines: ["memberships"] },
  "payments-to-check": { lines: ["fees", "finance"] },
  "bank-matching": { lines: ["finance"] },
  "card-payments": { lines: ["fees"] },
  finance: { lines: ["finance"] },
  shop: { lines: ["shop"] },
  donations: { lines: ["donations"] },
  arena: { lines: ["challenges", "rankings"] },
  vision: { lines: ["vision"] },
  gallery: { lines: ["photos"] },
  integrations: { lines: ["integrations"] },
  "forms-waivers": { lines: ["forms"] },
  juniors: { lines: ["juniors"] },
  // Global modules, built hidden (decision AQ): both lines stay "soon".
  // Moderation is the report queue Social and the Marketplace share.
  moderation: { lines: ["social", "marketplace"] },
  social: { lines: ["social"] },
};

/**
 * Lines that describe something outside the module registry (the apps, the
 * club finder, set-up, sports, languages). They are checked by hand.
 */
export const NOT_A_MODULE: readonly string[] = [
  "finder", "playersApp", "storeApps",
  "newClubs", "setupWizard", "badminton", "otherSports", "languages",
];
