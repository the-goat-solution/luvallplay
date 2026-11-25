// Permanent redirects for every URL that moved (build plan §2.2–2.3, test
// plan §4.5 "profile route merge"). Old bookmarks, home-screen shortcuts and
// links in emails already sent keep working. Next.js keeps the query string,
// so ?thread=12 (message emails) and ?source=…&period=… (old leaderboard
// links) still land in the right place.
//
// Plain data, so tests/redirects.test.ts checks it without starting Next.

export type Redirect = {
  source: string;
  destination: string;
  permanent: true;
  has?: { type: "cookie"; key: string }[];
  missing?: { type: "cookie"; key: string }[];
};

const SIGNED_IN = [{ type: "cookie" as const, key: "tw_player" }];

export const REDIRECTS: Redirect[] = [
  // The Sanity Studio is its own app since Phase 2 (apps/studio), hosted by
  // Sanity. Bookmarks to the old in-site Studio land there.
  { source: "/studio", destination: "https://threewolves.sanity.studio", permanent: true },
  { source: "/studio/:path*", destination: "https://threewolves.sanity.studio", permanent: true },
  // Wolf Vision lives in the profile app now (query kept, so old Arena links
  // and payment returns still land on the right match).
  { source: "/match-analyzer/label", destination: "/profile/wolf-vision/label", permanent: true },
  { source: "/match-analyzer", destination: "/profile/wolf-vision", permanent: true },
  // Account + Membership became the Me page.
  { source: "/profile/account", destination: "/profile", permanent: true },
  { source: "/profile/membership", destination: "/profile", permanent: true },
  { source: "/profile/me", destination: "/profile", permanent: true },
  // The full leaderboard lives in the Arena; the public page became a
  // first-names-only teaser on the club home page.
  { source: "/leaderboard", destination: "/profile/leaderboard", permanent: true, has: SIGNED_IN },
  { source: "/leaderboard", destination: "/#leaderboard", permanent: true, missing: SIGNED_IN },
];
