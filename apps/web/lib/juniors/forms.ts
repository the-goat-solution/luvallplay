// A club's forms and waivers for juniors, and a guardian's signatures
// (Phase 3b step 4; the Forms & waivers module, which Juniors switches on).
//
// - The club's owners and admins PUBLISH a form. Its words are never edited:
//   new wording is a new version, and the older version stops being asked
//   for. A signature therefore always points at the exact words signed.
// - A child's GUARDIAN signs the current version, for that child, by typing
//   their own name. Signing twice changes nothing. A signature is never
//   edited; it goes only when the child's information is deleted (step 7).
// - A new version asks every guardian again: the older signature is kept as
//   a record but no longer counts as signed.
import type { Access } from "@luvallplay/auth";
import { isGuardianOf, type Db } from "./family.ts";

export const FORM_KINDS = ["waiver", "consent"] as const;
export type FormKind = (typeof FORM_KINDS)[number];
export const FORM_TITLE_MAX = 120;
export const FORM_BODY_MAX = 20000;
export const SIGNED_NAME_MAX = 120;

export type ClubForm = { id: number; slug: string; version: number; kind: FormKind; title: string; body: string; publishedAt: string };
/** A form as a guardian sees it for one child: signed (this version, by them) or not. */
export type ChildForm = ClubForm & { signedAt: string | null; signedName: string | null };

export type FormError =
  /** Not an owner or admin of the club. */
  | "forbidden"
  | "slug_invalid"
  | "kind_invalid"
  | "title_required"
  | "title_too_long"
  | "body_required"
  | "body_too_long"
  /** The same words as the current version: nothing to publish. */
  | "unchanged"
  /** No such form, child or guardianship in this club. */
  | "not_found"
  /** The form has a newer version (or was retired): show the current one. */
  | "not_current"
  | "name_required"
  | "name_too_long";

export type FormResult<T> = { ok: true; value: T } | { ok: false; code: FormError };
const no = <T>(code: FormError): FormResult<T> => ({ ok: false, code });

const iso = (v: unknown) => new Date(v as string).toISOString();
const toForm = (r: Record<string, unknown>): ClubForm => ({
  id: Number(r.id),
  slug: String(r.slug),
  version: Number(r.version),
  kind: r.kind as FormKind,
  title: String(r.title),
  body: String(r.body),
  publishedAt: iso(r.published_at),
});

/** May this person publish or retire the club's forms? Owners and admins of the club. */
export function mayManageForms(access: Access): boolean {
  return access.role === "owner" || access.role === "admin";
}

// The current version of each form the club asks for: the highest version, unless that one is retired.
const CURRENT = `
  SELECT f.* FROM club_forms f
  WHERE f.tenant_id = $1 AND f.retired_at IS NULL
    AND f.version = (SELECT max(v.version) FROM club_forms v WHERE v.tenant_id = f.tenant_id AND v.slug = f.slug)`;

/** The forms the club currently asks guardians to sign. */
export async function listCurrentForms(db: Db, tenantId: number): Promise<ClubForm[]> {
  return (await db.query(`${CURRENT} ORDER BY f.slug`, [tenantId])).rows.map(toForm);
}

export type PublishInput = { slug: string; kind: string; title: string; body: string };

/** Publish a form, or a new version of one. The older version stops being asked for; its signatures are kept. */
export async function publishForm(db: Db, tenantId: number, actor: { playerId: number; access: Access }, input: PublishInput): Promise<FormResult<ClubForm>> {
  if (!mayManageForms(actor.access)) return no("forbidden");
  const slug = typeof input?.slug === "string" ? input.slug.trim() : "";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return no("slug_invalid");
  if (!(FORM_KINDS as readonly string[]).includes(input.kind)) return no("kind_invalid");
  const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
  if (!title) return no("title_required");
  if (title.length > FORM_TITLE_MAX) return no("title_too_long");
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").trim() : "";
  if (!body) return no("body_required");
  if (body.length > FORM_BODY_MAX) return no("body_too_long");

  const latest = (await db.query(`SELECT version, kind, title, body, retired_at FROM club_forms WHERE tenant_id = $1 AND slug = $2 ORDER BY version DESC LIMIT 1`, [tenantId, slug])).rows[0];
  if (latest && latest.retired_at === null && latest.kind === input.kind && latest.title === title && latest.body === body) return no("unchanged");
  // The unique (club, slug, version) key settles two people publishing at once: one of them gets an error and tries again.
  const { rows } = await db.query(
    `INSERT INTO club_forms (tenant_id, slug, version, kind, title, body, published_by_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [tenantId, slug, latest ? Number(latest.version) + 1 : 1, input.kind, title, body, actor.playerId],
  );
  return { ok: true, value: toForm(rows[0]) };
}

/** Stop asking for a form. Its versions and signatures are kept as records. */
export async function retireForm(db: Db, tenantId: number, actor: { access: Access }, slug: string): Promise<FormResult<{ retired: boolean }>> {
  if (!mayManageForms(actor.access)) return no("forbidden");
  const { rows } = await db.query(
    `UPDATE club_forms f SET retired_at = now()
     WHERE f.tenant_id = $1 AND f.slug = $2 AND f.retired_at IS NULL
       AND f.version = (SELECT max(v.version) FROM club_forms v WHERE v.tenant_id = f.tenant_id AND v.slug = f.slug)
     RETURNING f.id`,
    [tenantId, slug],
  );
  if (rows.length) return { ok: true, value: { retired: true } };
  const any = (await db.query(`SELECT 1 FROM club_forms WHERE tenant_id = $1 AND slug = $2 LIMIT 1`, [tenantId, slug])).rows[0];
  return any ? { ok: true, value: { retired: false } } : no("not_found");
}

/** The club's current forms for one child, each with this guardian's signature of that version (if any). */
export async function listChildForms(db: Db, tenantId: number, guardianId: number, childId: number): Promise<FormResult<ChildForm[]>> {
  if (!(await isGuardianOf(db, tenantId, guardianId, childId))) return no("not_found");
  const { rows } = await db.query(
    `SELECT c.*, s.signed_at, s.signed_name FROM (${CURRENT}) c
     LEFT JOIN form_signatures s ON s.tenant_id = c.tenant_id AND s.form_id = c.id AND s.junior_profile_id = $2 AND s.signed_by_user_id = $3
     ORDER BY c.slug`,
    [tenantId, childId, guardianId],
  );
  return { ok: true, value: rows.map((r) => ({ ...toForm(r), signedAt: r.signed_at ? iso(r.signed_at) : null, signedName: r.signed_name == null ? null : String(r.signed_name) })) };
}

/** How many of the club's current forms this guardian hasn't signed for this child. 0 when all are signed (or the club asks for none). */
export async function unsignedCount(db: Db, tenantId: number, guardianId: number, childId: number): Promise<number> {
  const r = await listChildForms(db, tenantId, guardianId, childId);
  return r.ok ? r.value.filter((f) => !f.signedAt).length : 0;
}

/** Sign the current version of a form for a child, by typing the guardian's own name. Signing again changes nothing. */
export async function signForm(db: Db, tenantId: number, guardianId: number, childId: number, formId: number, signedName: string): Promise<FormResult<ChildForm>> {
  const name = typeof signedName === "string" ? signedName.replace(/\s+/g, " ").trim() : "";
  if (!name) return no("name_required");
  if (name.length > SIGNED_NAME_MAX) return no("name_too_long");
  if (!(await isGuardianOf(db, tenantId, guardianId, childId))) return no("not_found");
  const exists = (await db.query(`SELECT 1 FROM club_forms WHERE tenant_id = $1 AND id = $2`, [tenantId, formId])).rows[0];
  if (!exists) return no("not_found");
  const current = (await db.query(`SELECT c.id FROM (${CURRENT}) c WHERE c.id = $2`, [tenantId, formId])).rows[0];
  if (!current) return no("not_current");
  await db.query(
    `INSERT INTO form_signatures (tenant_id, form_id, junior_profile_id, signed_by_user_id, signed_name) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, form_id, junior_profile_id, signed_by_user_id) DO NOTHING`,
    [tenantId, formId, childId, guardianId, name],
  );
  const all = await listChildForms(db, tenantId, guardianId, childId);
  const form = all.ok ? all.value.find((f) => f.id === formId) : undefined;
  return form ? { ok: true, value: form } : no("not_found");
}
