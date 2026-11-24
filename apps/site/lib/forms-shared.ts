// The parts of the forms that pages and the server both use (no database).
export const KINDS = ["waitlist", "walkthrough", "invite", "app", "contact"] as const;
export type Kind = (typeof KINDS)[number];

/** Which fields each form requires (besides email and consent). */
export const REQUIRED: Record<Kind, ("name" | "club" | "sport" | "city" | "role" | "message")[]> = {
  waitlist: ["name", "role"],
  walkthrough: ["name", "club"],
  invite: ["club"],
  app: [],
  contact: ["name", "message"],
};
