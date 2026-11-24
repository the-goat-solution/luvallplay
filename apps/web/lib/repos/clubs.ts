import { and, eq } from "drizzle-orm";
import { orm, schema } from "../database.ts";

const { tenants, club_members } = schema;

export type ClubMembershipRow = { slug: string; name: string; region: string; role: string; status: string };

/**
 * The clubs a person belongs to, from club_members. With the club scope
 * enforced (TENANT_SCOPE=enforce) the database itself only shows this
 * deployment's club, which is the right answer for one region.
 */
export async function listClubsForPlayer(playerId: number): Promise<ClubMembershipRow[]> {
  return orm()
    .select({ slug: tenants.slug, name: tenants.name, region: tenants.region, role: club_members.role, status: club_members.status })
    .from(club_members)
    .innerJoin(tenants, eq(tenants.id, club_members.tenant_id))
    .where(and(eq(club_members.user_id, playerId), eq(tenants.status, "active")))
    .orderBy(tenants.name);
}

export type ClubPresentationRow = { slug: string; name: string; region: string; status: string; paymentMode: string; sports: string[]; theme: unknown };

/** What the app needs to dress itself as a club, beyond the settings in lib/club-config.ts. */
export async function getClubPresentation(slug: string): Promise<ClubPresentationRow | null> {
  const rows = await orm()
    .select({ slug: tenants.slug, name: tenants.name, region: tenants.region, status: tenants.status, paymentMode: tenants.payment_mode, sports: tenants.sports, theme: tenants.theme })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}
