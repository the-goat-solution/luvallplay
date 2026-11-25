// A guardian's family: the children they manage in a club (build plan §6.8;
// Phase 3b step 3).
//
// The hard rules, kept by construction here:
// - A child has NO login, email or phone. A profile is a name and a birth
//   year in one club; a name that looks like an email address or a phone
//   number is refused, so contact details can't arrive by the side door.
// - Only a guardian sees or changes a child: every read and write names the
//   guardian AND the club, and goes through `guardianships`.
// - Nothing about a child is public unless a guardian says so, item by item
//   (the club's board, photos, match video). Each is off until switched on,
//   and with two guardians both must agree.
//
// `guardianships` is the one source of truth for who a child's guardians
// are. `junior_profiles.guardian_user_id` only records who created the
// profile; nothing reads it for access (audit, "Migration 0012 details").
//
// Callers check that Juniors is on for the club first (lib/juniors/module.ts).
// Takes a small `Db` and the club's id, so tests and scripts share it.

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** The wording a guardian agreed to; a change that alters what they agree to changes the version. */
export const CONSENT_VERSION = "2026-11";
/** Enough for a large family; stops one account being used as a club's whole roster. */
export const MAX_CHILDREN_PER_GUARDIAN = 8;
/** A child can have two guardians (§6.8). */
export const MAX_GUARDIANS_PER_CHILD = 2;
export const CHILD_NAME_MAX = 60;

/** What a guardian can allow for a child, each on its own. All off until the guardian switches one on. */
export const CONSENT_ITEMS = ["leaderboard", "photos", "vision"] as const;
export type ConsentItem = (typeof CONSENT_ITEMS)[number];
export type ConsentChoices = Record<ConsentItem, boolean>;

type StoredConsent = { version: string; items: Record<ConsentItem, { granted: boolean; at: string }> };

export type Child = {
  id: number;
  name: string;
  birthYear: number;
  /** This guardian's own choices. */
  consent: ConsentChoices;
  /** When this guardian confirmed they are the child's parent or guardian. */
  consentAt: string;
  consentVersion: string;
  addedAt: string;
  /** How many guardians manage this child (1 or 2). */
  guardians: number;
};

export type FamilyError =
  | "name_required"
  | "name_invalid"
  | "birth_year"
  | "consent_required"
  | "too_many"
  | "duplicate"
  | "not_found";

export type FamilyResult<T> = { ok: true; value: T } | { ok: false; code: FamilyError };
const no = <T>(code: FamilyError): FamilyResult<T> => ({ ok: false, code });

// ── Rules (pure) ────────────────────────────────────────────────────────────

/** Trimmed, single spaces, no control characters. */
export function cleanChildName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
}

/** Why a name can't be used, or null. A child has no email or phone, so neither may hide in the name. */
export function childNameProblem(name: string): "name_required" | "name_invalid" | null {
  if (!name) return "name_required";
  if (name.length > CHILD_NAME_MAX) return "name_invalid";
  if (/[@<>]|https?:|www\./i.test(name)) return "name_invalid";
  if ((name.match(/\d/g) ?? []).length >= 5) return "name_invalid";
  if (!/\p{L}/u.test(name)) return "name_invalid";
  return null;
}

/**
 * Birth years a junior can have in `year` (the club's own calendar year).
 * A junior is under 16. With only a year, someone born 16 years ago may
 * still be 15, so that year is allowed; growing up at 16 is its own step.
 */
export function juniorBirthYears(year: number): { min: number; max: number } {
  return { min: year - 16, max: year };
}

export function isJuniorBirthYear(birthYear: unknown, year: number): birthYear is number {
  const { min, max } = juniorBirthYears(year);
  return Number.isInteger(birthYear) && (birthYear as number) >= min && (birthYear as number) <= max;
}

function readConsent(scope: unknown): { version: string; choices: ConsentChoices } {
  const s = scope as Partial<StoredConsent> | null;
  const choices = Object.fromEntries(CONSENT_ITEMS.map((i) => [i, s?.items?.[i]?.granted === true])) as ConsentChoices;
  return { version: typeof s?.version === "string" ? s.version : "", choices };
}

function storedConsent(choices: Partial<ConsentChoices>, at: string, previous?: unknown): StoredConsent {
  const before = (previous as Partial<StoredConsent> | null)?.items;
  const items = Object.fromEntries(
    CONSENT_ITEMS.map((i) => {
      const granted = choices[i] === true;
      const was = before?.[i];
      // The time is when the answer last changed, so a withdrawal has a date.
      return [i, was && was.granted === granted && typeof was.at === "string" ? was : { granted, at }];
    }),
  ) as StoredConsent["items"];
  return { version: CONSENT_VERSION, items };
}

/** With two guardians, an item is allowed only when every guardian allows it. */
export function effectiveConsent(perGuardian: readonly ConsentChoices[]): ConsentChoices {
  return Object.fromEntries(CONSENT_ITEMS.map((i) => [i, perGuardian.length > 0 && perGuardian.every((c) => c[i])])) as ConsentChoices;
}

// ── Reads ───────────────────────────────────────────────────────────────────

const CHILD_COLUMNS = `j.id, j.name, j.birth_year, j.created_at, g.consent_at, g.consent_scope,
  (SELECT count(*)::int FROM guardianships o JOIN players op ON op.id = o.guardian_user_id AND op.deleted_at IS NULL WHERE o.junior_profile_id = j.id) AS guardians`;

function toChild(r: Record<string, unknown>): Child {
  const consent = readConsent(r.consent_scope);
  return {
    id: Number(r.id),
    name: String(r.name),
    birthYear: Number(r.birth_year),
    consent: consent.choices,
    consentAt: new Date(r.consent_at as string).toISOString(),
    consentVersion: consent.version,
    addedAt: new Date(r.created_at as string).toISOString(),
    guardians: Number(r.guardians),
  };
}

/** The children this guardian manages in this club, oldest profile first. Never another guardian's, never another club's. */
export async function listChildren(db: Db, tenantId: number, guardianId: number): Promise<Child[]> {
  const { rows } = await db.query(
    `SELECT ${CHILD_COLUMNS}
     FROM guardianships g JOIN junior_profiles j ON j.id = g.junior_profile_id
     WHERE g.guardian_user_id = $2 AND j.tenant_id = $1 AND j.deleted_at IS NULL AND g.consent_at IS NOT NULL
     ORDER BY j.created_at, j.id`,
    [tenantId, guardianId],
  );
  return rows.map(toChild);
}

/** One child, if this guardian manages them in this club. */
export async function getChild(db: Db, tenantId: number, guardianId: number, childId: number): Promise<Child | null> {
  const { rows } = await db.query(
    `SELECT ${CHILD_COLUMNS}
     FROM guardianships g JOIN junior_profiles j ON j.id = g.junior_profile_id
     WHERE g.guardian_user_id = $2 AND j.tenant_id = $1 AND j.id = $3 AND j.deleted_at IS NULL AND g.consent_at IS NOT NULL`,
    [tenantId, guardianId, childId],
  );
  return rows[0] ? toChild(rows[0]) : null;
}

/** May this account act for this child in this club? The one question booking, forms and exports ask. */
export async function isGuardianOf(db: Db, tenantId: number, guardianId: number, childId: number): Promise<boolean> {
  return (await getChild(db, tenantId, guardianId, childId)) !== null;
}

/** What is allowed for a child right now, across all their guardians (both must agree). */
export async function childConsent(db: Db, tenantId: number, childId: number): Promise<ConsentChoices> {
  const { rows } = await db.query(
    `SELECT g.consent_scope
     FROM guardianships g JOIN junior_profiles j ON j.id = g.junior_profile_id JOIN players p ON p.id = g.guardian_user_id
     WHERE j.tenant_id = $1 AND j.id = $2 AND j.deleted_at IS NULL AND g.consent_at IS NOT NULL AND p.deleted_at IS NULL`,
    [tenantId, childId],
  );
  return effectiveConsent(rows.map((r) => readConsent(r.consent_scope).choices));
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type AddChildInput = {
  name: unknown;
  birthYear: unknown;
  /** "I am this child's parent or legal guardian, I'm 18 or over, and I agree to the club holding this information." Required. */
  guardianConfirmed: unknown;
  /** Optional items; anything not exactly `true` is off. */
  consent?: Partial<Record<ConsentItem, unknown>>;
};

function choicesFrom(raw: Partial<Record<ConsentItem, unknown>> | undefined): ConsentChoices {
  return Object.fromEntries(CONSENT_ITEMS.map((i) => [i, raw?.[i] === true])) as ConsentChoices;
}

/**
 * Add a child to the guardian's family in this club. `year` is the club's
 * calendar year. The profile and the guardianship are written by one
 * statement, so a child never exists without a guardian.
 */
export async function addChild(db: Db, tenantId: number, guardianId: number, input: AddChildInput, opts: { year: number; now?: Date }): Promise<FamilyResult<Child>> {
  const name = cleanChildName(input.name);
  const problem = childNameProblem(name);
  if (problem) return no(problem);
  if (!isJuniorBirthYear(input.birthYear, opts.year)) return no("birth_year");
  if (input.guardianConfirmed !== true) return no("consent_required");

  const existing = await listChildren(db, tenantId, guardianId);
  if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase() && c.birthYear === input.birthYear)) return no("duplicate");
  if (existing.length >= MAX_CHILDREN_PER_GUARDIAN) return no("too_many");

  const at = (opts.now ?? new Date()).toISOString();
  const { rows } = await db.query(
    `WITH j AS (
       INSERT INTO junior_profiles (tenant_id, guardian_user_id, name, birth_year)
       SELECT $1, p.id, $3, $4 FROM players p WHERE p.id = $2 AND p.deleted_at IS NULL
       RETURNING id
     )
     INSERT INTO guardianships (guardian_user_id, junior_profile_id, consent_at, consent_scope)
     SELECT $2, j.id, $5::timestamptz, $6::jsonb FROM j
     RETURNING junior_profile_id`,
    [tenantId, guardianId, name, input.birthYear, at, JSON.stringify(storedConsent(choicesFrom(input.consent), at))],
  );
  if (!rows[0]) return no("not_found"); // the guardian's account is gone
  const child = await getChild(db, tenantId, guardianId, Number(rows[0].junior_profile_id));
  return child ? { ok: true, value: child } : no("not_found");
}

/** Correct a child's name or birth year. */
export async function updateChild(db: Db, tenantId: number, guardianId: number, childId: number, input: { name?: unknown; birthYear?: unknown }, opts: { year: number }): Promise<FamilyResult<Child>> {
  const current = await getChild(db, tenantId, guardianId, childId);
  if (!current) return no("not_found");
  let name = current.name;
  if (input.name !== undefined) {
    name = cleanChildName(input.name);
    const problem = childNameProblem(name);
    if (problem) return no(problem);
  }
  let birthYear = current.birthYear;
  if (input.birthYear !== undefined) {
    if (!isJuniorBirthYear(input.birthYear, opts.year)) return no("birth_year");
    birthYear = input.birthYear;
  }
  if (name !== current.name || birthYear !== current.birthYear) {
    const others = (await listChildren(db, tenantId, guardianId)).filter((c) => c.id !== childId);
    if (others.some((c) => c.name.toLowerCase() === name.toLowerCase() && c.birthYear === birthYear)) return no("duplicate");
    // The guardianship is checked again in the statement itself.
    await db.query(
      `UPDATE junior_profiles j SET name = $4, birth_year = $5
       WHERE j.id = $3 AND j.tenant_id = $1 AND j.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM guardianships g WHERE g.junior_profile_id = j.id AND g.guardian_user_id = $2 AND g.consent_at IS NOT NULL)`,
      [tenantId, guardianId, childId, name, birthYear],
    );
  }
  const child = await getChild(db, tenantId, guardianId, childId);
  return child ? { ok: true, value: child } : no("not_found");
}

/** Switch this guardian's optional items on or off for a child. Items not named keep their answer. */
export async function setConsent(db: Db, tenantId: number, guardianId: number, childId: number, changes: Partial<Record<ConsentItem, unknown>>, opts: { now?: Date } = {}): Promise<FamilyResult<Child>> {
  const current = await getChild(db, tenantId, guardianId, childId);
  if (!current) return no("not_found");
  const next = { ...current.consent };
  for (const item of CONSENT_ITEMS) if (typeof changes[item] === "boolean") next[item] = changes[item] as boolean;
  const at = (opts.now ?? new Date()).toISOString();
  const previous = (
    await db.query(`SELECT consent_scope FROM guardianships WHERE guardian_user_id = $1 AND junior_profile_id = $2`, [guardianId, childId])
  ).rows[0]?.consent_scope;
  await db.query(
    `UPDATE guardianships g SET consent_scope = $4::jsonb
     WHERE g.guardian_user_id = $2 AND g.junior_profile_id = $3
       AND EXISTS (SELECT 1 FROM junior_profiles j WHERE j.id = g.junior_profile_id AND j.tenant_id = $1 AND j.deleted_at IS NULL)`,
    [tenantId, guardianId, childId, JSON.stringify(storedConsent(next, at, previous))],
  );
  const child = await getChild(db, tenantId, guardianId, childId);
  return child ? { ok: true, value: child } : no("not_found");
}
