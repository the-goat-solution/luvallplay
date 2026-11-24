import { hasAdminAccess } from "@luvallplay/auth";
import { getAccess } from "@/lib/admin-roles";
import { apiBaseForRegion, appRoute, deploymentClub, fail } from "@/lib/app-api";
import { sql } from "@/lib/database";
import { listClubsForPlayer } from "@/lib/repos/clubs";

const ROLES = new Set(["owner", "admin", "coach", "member", "guest"]);

// The clubs the signed-in person belongs to, each with where its API lives.
// The app shows a club switcher when there is more than one.
const route = appRoute("clubs.list", async ({ player, request }) => {
  const here = await deploymentClub();
  if (!here) return fail(503, "unavailable");
  const access = await getAccess(sql, player.id, player.email);
  const rows = await listClubsForPlayer(player.id).catch((err) => {
    console.error("[app-api] could not list clubs:", err);
    return [];
  });
  const clubs = rows.flatMap((r) => {
    const apiBase = apiBaseForRegion(r.region, request);
    if (!apiBase) return []; // A club in a region this deployment can't point to.
    const mine = r.slug === here.slug;
    return [{
      slug: r.slug,
      name: r.name,
      // club_roles is still the source for this club's roles (Phase 3 step 11 switches reads).
      role: (mine && access.role ? access.role : ROLES.has(r.role) ? r.role : "member") as "owner" | "admin" | "coach" | "member" | "guest",
      status: (r.status === "disabled" ? "disabled" : "active") as "active" | "disabled",
      region: r.region,
      apiBase,
      canOpenAdmin: mine && hasAdminAccess(access),
    }];
  });
  // Every account on this deployment belongs to its club, even before the
  // club_members mirror has caught up.
  if (!clubs.some((c) => c.slug === here.slug)) {
    clubs.unshift({
      slug: here.slug,
      name: here.name,
      role: access.role ?? "member",
      status: "active",
      region: here.region,
      apiBase: apiBaseForRegion(here.region, request) ?? `${new URL(request.url).origin}/api/v1/app`,
      canOpenAdmin: hasAdminAccess(access),
    });
  }
  return { clubs };
});

export const GET = route.handle;
export const OPTIONS = route.preflight;
