// Data guard: proves a data change didn't cost anyone access or data.
//
//   snapshot(query)          read-only fingerprint of the whole database
//   checkSnapshot(snap)      access health checks on one snapshot
//   diffSnapshots(a, b, x)   what changed between two snapshots, judged
//                            against the change's written expectations (x)
//
// Two kinds of fingerprint:
//   • Tables: row count, the set of primary keys, and one hash per column.
//     Adding a table or column never trips anything; losing rows, dropping a
//     column or changing any existing value does, unless the expectations
//     file names it with a reason.
//   • People: for every account, what lets them in (email, verified phone,
//     live sessions, roles) and how many rows of their data each table holds
//     (bookings, attendance, photos, orders, memberships by status, ...).
//     That is how "nobody lost access, nobody lost data" is checked person by
//     person, not just in totals.
//
// Snapshots hold no emails or phone numbers: people are keyed by account id
// and a salted hash, so a snapshot file is safe to attach to a pull request.
//
// The database is reached through an injected `query` function, so the same
// code runs against Neon in production (scripts/data-guard/cli.ts) and a
// local Postgres in tests (tests/data-guard.test.ts).

import crypto from "node:crypto";
import { z } from "zod";

export type Row = Record<string, unknown>;
export type Query = (text: string, params?: unknown[]) => Promise<Row[]>;

export const SNAPSHOT_VERSION = 1;

// ---------------------------------------------------------------------------
// Configuration: what counts as a person, a person's data, and their access.
// Defaults describe today's schema; future schemas (users, club_members) are
// listed too and simply skipped while they don't exist.
// ---------------------------------------------------------------------------

export type GuardConfig = {
  schema: string;
  /** Account tables, first one that exists wins. */
  identityTables: { table: string; id: string; email: string; deleted?: string; phone?: string; phoneVerified?: string }[];
  /** Sessions that keep someone signed in. */
  sessionTables: { table: string; person: string; expires: string }[];
  /** Person-pointing columns without a foreign key (FKs to the identity table are found automatically). */
  extraPersonColumns: string[];
  /** Per-person counts split by a status/role column, e.g. memberships by status. The first person column that exists is used, so renames (player_id → user_id) keep working. */
  statusLinks: { table: string; person: string[]; status: string }[];
  /**
   * People without an account of their own: a child's profile, managed by a
   * guardian. They can't sign in, so there is no access to lose, but their
   * rows are checked person by person exactly like an account's.
   */
  dependentTables: {
    table: string;
    id: string;
    deleted?: string;
    prefix: string;
    guardianLink: string;
    /**
     * In the guardian link's table: the column naming the guardian's account,
     * and (optional) the column set when a guardian stepped away. A guardian
     * counts only while their account is live and their link hasn't ended.
     */
    guardianPerson?: string;
    guardianEnded?: string;
    statusLinks: { table: string; person: string; status: string }[];
  }[];
  /** Tables left out entirely (pure logs, caches, rate limits). */
  ignoreTables: string[];
  /** Column names (exact or regex source) whose sums are reported (money, points). */
  sumColumns: RegExp;
};

export const DEFAULT_CONFIG: GuardConfig = {
  schema: "public",
  identityTables: [
    { table: "users", id: "id", email: "email", deleted: "deleted_at", phone: "phone_e164", phoneVerified: "phone_verified_at" },
    { table: "players", id: "id", email: "email", deleted: "deleted_at", phone: "phone_e164", phoneVerified: "phone_verified_at" },
  ],
  sessionTables: [
    { table: "user_sessions", person: "user_id", expires: "expires_at" },
    { table: "player_sessions", person: "player_id", expires: "expires_at" },
  ],
  extraPersonColumns: [
    "arena_pairs.player_low",
    "arena_pairs.player_high",
    "arena_pair_members.player_id",
    "arena_challenges.p1",
    "arena_challenges.p2",
    "arena_challenges.a1",
    "arena_challenges.a2",
    "arena_after_game.player_id",
    "arena_player_ranks.player_id",
  ],
  statusLinks: [
    { table: "memberships", person: ["email"], status: "status" },
    { table: "bookings", person: ["email"], status: "status" },
    { table: "shop_orders", person: ["player_id", "user_id"], status: "status" },
    { table: "player_photos", person: ["player_id", "user_id"], status: "status" },
    { table: "club_roles", person: ["player_id", "user_id"], status: "role" },
    { table: "club_members", person: ["user_id", "player_id"], status: "role" },
  ],
  dependentTables: [
    {
      table: "junior_profiles",
      id: "id",
      deleted: "deleted_at",
      prefix: "junior",
      guardianLink: "guardianships.junior_profile_id",
      guardianPerson: "guardian_user_id",
      guardianEnded: "ended_at",
      statusLinks: [{ table: "junior_bookings", person: "junior_profile_id", status: "status" }],
    },
  ],
  ignoreTables: ["schema_runs", "sms_sends", "auth_codes", "rate_limits", "stripe_events", "webhook_deliveries", "pv_arena_code_attempts", "arena_code_attempts"],
  sumColumns: /(_cents|amount|price|total|points|balance)$/,
};

// ---------------------------------------------------------------------------
// Snapshot shape
// ---------------------------------------------------------------------------

export type ColumnSnap = { type: string; nullable: boolean; hash: string; nulls: number; sum?: string };
export type TableSnap = { rows: number; primaryKey: string[]; keyHash: string; columns: Record<string, ColumnSnap> };
export type PersonSnap = {
  /** Set for a person without an account (a junior profile); their id is "<prefix>:<row id>". */
  kind?: "dependent";
  /** For a dependent: the link that names their guardians, e.g. "guardianships.junior_profile_id". */
  guardianLink?: string;
  /**
   * For a dependent: how many guardians can act for them right now (a live
   * account, a link that hasn't ended). Absent in older snapshots, where
   * every guardian link counted.
   */
  liveGuardians?: number;
  id: string;
  emailHash: string;
  emailEmpty: boolean;
  deleted: boolean;
  phoneHash: string | null;
  liveSessions: number;
  /** Latest session expiry (ISO), so a natural expiry isn't mistaken for a sign-out. */
  sessionsExpireAt: string | null;
  /** "table.column" or "table.column[status=x]" → rows belonging to this person. */
  links: Record<string, number>;
};
export type Snapshot = {
  version: number;
  takenAt: string;
  label: string;
  identityTable: string | null;
  tables: Record<string, TableSnap>;
  people: PersonSnap[];
  /** Rows whose person column points at no account: "table.column" → rows. */
  orphans: Record<string, number>;
};

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function personHash(value: string, salt = process.env.DATA_GUARD_SALT ?? "data-guard-v1"): string {
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 20);
}

export const normalizeEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();

type TableMeta = {
  name: string;
  columns: { name: string; type: string; nullable: boolean }[];
  primaryKey: string[];
};

async function listTables(query: Query, cfg: GuardConfig): Promise<TableMeta[]> {
  const tables = await query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
    [cfg.schema],
  );
  const cols = await query(
    `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = $1 ORDER BY table_name, ordinal_position`,
    [cfg.schema],
  );
  const pks = await query(
    `SELECT c.relname AS table_name, a.attname AS column_name, array_position(i.indkey::int2[], a.attnum) AS pos
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indisprimary AND n.nspname = $1
     ORDER BY c.relname, pos`,
    [cfg.schema],
  );
  return tables
    .map((t) => String(t.table_name))
    .filter((name) => !cfg.ignoreTables.includes(name))
    .map((name) => ({
      name,
      columns: cols
        .filter((c) => c.table_name === name)
        .map((c) => ({ name: String(c.column_name), type: String(c.data_type), nullable: c.is_nullable === "YES" })),
      primaryKey: pks.filter((p) => p.table_name === name).map((p) => String(p.column_name)),
    }));
}

const NUMERIC_TYPES = new Set(["integer", "bigint", "smallint", "numeric", "real", "double precision"]);

async function snapTable(query: Query, cfg: GuardConfig, t: TableMeta): Promise<TableSnap> {
  const tbl = `${quoteIdent(cfg.schema)}.${quoteIdent(t.name)}`;
  const pk = t.primaryKey.map(quoteIdent);
  // Per-value md5 keeps memory bounded; ordering by the primary key ties each
  // value to its row. Without a primary key, values are hashed as a sorted
  // multiset, so adding an unrelated column can't reorder anything.
  const keyExpr = pk.length ? `md5(row(${pk.join(", ")})::text)` : `md5(t::text)`;
  const orderBy = pk.length ? pk.join(", ") : null;
  const parts = [`count(*)::bigint AS rows`, `md5(coalesce(string_agg(${keyExpr}, ',' ORDER BY ${orderBy ?? keyExpr}), '')) AS key_hash`];
  t.columns.forEach((c, i) => {
    const v = `md5(coalesce(${quoteIdent(c.name)}::text, '∅'))`;
    parts.push(`md5(coalesce(string_agg(${v}, ',' ORDER BY ${orderBy ?? v}), '')) AS h${i}`);
    parts.push(`count(*) FILTER (WHERE ${quoteIdent(c.name)} IS NULL)::bigint AS n${i}`);
    if (NUMERIC_TYPES.has(c.type) && cfg.sumColumns.test(c.name)) parts.push(`coalesce(sum(${quoteIdent(c.name)}), 0)::text AS s${i}`);
  });
  const [r] = await query(`SELECT ${parts.join(", ")} FROM ${tbl} t`);
  const columns: Record<string, ColumnSnap> = {};
  t.columns.forEach((c, i) => {
    columns[c.name] = {
      type: c.type,
      nullable: c.nullable,
      hash: String(r[`h${i}`]),
      nulls: Number(r[`n${i}`]),
      ...(r[`s${i}`] !== undefined ? { sum: String(r[`s${i}`]) } : {}),
    };
  });
  return { rows: Number(r.rows), primaryKey: t.primaryKey, keyHash: String(r.key_hash), columns };
}

async function foreignKeysTo(query: Query, cfg: GuardConfig, identity: string): Promise<string[]> {
  const rows = await query(
    `SELECT src.relname AS table_name, a.attname AS column_name
     FROM pg_constraint con
     JOIN pg_class src ON src.oid = con.conrelid
     JOIN pg_class dst ON dst.oid = con.confrelid
     JOIN pg_namespace n ON n.oid = src.relnamespace
     JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1 AND n.nspname = $1 AND dst.relname = $2`,
    [cfg.schema, identity],
  );
  return rows.map((r) => `${r.table_name}.${r.column_name}`);
}

/**
 * Read-only fingerprint of the database. Run it inside one
 * `REPEATABLE READ READ ONLY` transaction (the CLI does) so every table is
 * read at the same instant.
 */
export async function snapshot(query: Query, opts: { label?: string; config?: GuardConfig } = {}): Promise<Snapshot> {
  const cfg = opts.config ?? DEFAULT_CONFIG;
  const [{ now }] = await query(`SELECT now()::text AS now`);
  const metas = await listTables(query, cfg);
  const byName = new Map(metas.map((m) => [m.name, m]));
  const hasCol = (table: string, col?: string) => !!col && !!byName.get(table)?.columns.some((c) => c.name === col);

  const tables: Record<string, TableSnap> = {};
  for (const m of metas) tables[m.name] = await snapTable(query, cfg, m);

  const identity = cfg.identityTables.find((i) => byName.has(i.table) && hasCol(i.table, i.id) && hasCol(i.table, i.email)) ?? null;
  const people: PersonSnap[] = [];
  const orphans: Record<string, number> = {};
  if (!identity) return { version: SNAPSHOT_VERSION, takenAt: new Date(String(now)).toISOString(), label: opts.label ?? "", identityTable: null, tables, people, orphans };

  const it = quoteIdent(identity.table);
  const deleted = hasCol(identity.table, identity.deleted) ? `${quoteIdent(identity.deleted!)} IS NOT NULL` : "false";
  const phone =
    hasCol(identity.table, identity.phone) && hasCol(identity.table, identity.phoneVerified)
      ? `CASE WHEN ${quoteIdent(identity.phoneVerified!)} IS NOT NULL THEN ${quoteIdent(identity.phone!)} END`
      : "NULL";
  const accounts = await query(
    `SELECT ${quoteIdent(identity.id)}::text AS id, ${quoteIdent(identity.email)} AS email, ${deleted} AS deleted, ${phone} AS phone FROM ${it} ORDER BY 1`,
  );
  const byId = new Map<string, PersonSnap>();
  const byEmail = new Map<string, PersonSnap>();
  for (const a of accounts) {
    const email = normalizeEmail(a.email);
    const p: PersonSnap = {
      id: String(a.id),
      emailHash: personHash(email),
      emailEmpty: email === "",
      deleted: a.deleted === true,
      phoneHash: a.phone ? personHash(String(a.phone)) : null,
      liveSessions: 0,
      sessionsExpireAt: null,
      links: {},
    };
    people.push(p);
    byId.set(p.id, p);
    // Live accounts win the email slot over deleted ones.
    if (!byEmail.has(email) || byEmail.get(email)!.deleted) byEmail.set(email, p);
  }

  for (const s of cfg.sessionTables) {
    if (!hasCol(s.table, s.person) || !hasCol(s.table, s.expires)) continue;
    const rows = await query(
      `SELECT ${quoteIdent(s.person)}::text AS k, count(*) FILTER (WHERE ${quoteIdent(s.expires)} > now())::int AS live,
              max(${quoteIdent(s.expires)})::text AS last
       FROM ${quoteIdent(s.table)} GROUP BY 1`,
    );
    for (const r of rows) {
      const p = byId.get(String(r.k));
      if (!p) continue;
      p.liveSessions += Number(r.live);
      const last = r.last ? new Date(String(r.last)).toISOString() : null;
      if (last && (!p.sessionsExpireAt || last > p.sessionsExpireAt)) p.sessionsExpireAt = last;
    }
  }

  // Which columns point at people: FKs to the identity table, configured
  // extras, and any column called email / *_email.
  const idCols = new Set([...(await foreignKeysTo(query, cfg, identity.table)), ...cfg.extraPersonColumns]);
  const emailCols = new Set<string>();
  for (const m of metas) {
    if (m.name === identity.table) continue;
    for (const c of m.columns) if (c.name === "email" || c.name.endsWith("_email")) emailCols.add(`${m.name}.${c.name}`);
  }
  const resolve = (isEmail: boolean, key: unknown) => (isEmail ? byEmail.get(normalizeEmail(key)) : byId.get(String(key)));

  const count = async (table: string, col: string, isEmail: boolean, status?: string) => {
    if (!hasCol(table, col) || (status && !hasCol(table, status))) return;
    const keyExpr = isEmail ? `lower(trim(${quoteIdent(col)}))` : `${quoteIdent(col)}::text`;
    const rows = await query(
      `SELECT ${keyExpr} AS k, ${status ? `coalesce(${quoteIdent(status)}::text, '')` : `''`} AS s, count(*)::int AS n
       FROM ${quoteIdent(table)} WHERE ${quoteIdent(col)} IS NOT NULL GROUP BY 1, 2`,
    );
    for (const r of rows) {
      const linkKey = status ? `${table}.${col}[${status}=${r.s}]` : `${table}.${col}`;
      const p = resolve(isEmail, r.k);
      if (p) p.links[linkKey] = (p.links[linkKey] ?? 0) + Number(r.n);
      else orphans[linkKey] = (orphans[linkKey] ?? 0) + Number(r.n);
    }
  };

  for (const ref of [...idCols].sort()) {
    const [table, col] = ref.split(".");
    if (table !== identity.table) await count(table, col, false);
  }
  for (const ref of [...emailCols].sort()) {
    const [table, col] = ref.split(".");
    await count(table, col, true);
  }
  for (const s of cfg.statusLinks) {
    const col = s.person.find((c) => hasCol(s.table, c));
    if (col) await count(s.table, col, col === "email" || col.endsWith("_email"), s.status);
  }

  // People without an account: one person per row of each dependent table,
  // with their rows counted from the foreign keys that point at it.
  for (const d of cfg.dependentTables ?? []) {
    if (!hasCol(d.table, d.id)) continue;
    const gone = hasCol(d.table, d.deleted) ? `${quoteIdent(d.deleted!)} IS NOT NULL` : "false";
    const rows = await query(`SELECT ${quoteIdent(d.id)}::text AS id, ${gone} AS deleted FROM ${quoteIdent(d.table)} ORDER BY 1`);
    const byDependent = new Map<string, PersonSnap>();
    for (const r of rows) {
      const id = `${d.prefix}:${r.id}`;
      const person: PersonSnap = { kind: "dependent", guardianLink: d.guardianLink, id, emailHash: personHash(id), emailEmpty: false, deleted: r.deleted === true, phoneHash: null, liveSessions: 0, sessionsExpireAt: null, links: {} };
      people.push(person);
      byDependent.set(String(r.id), person);
    }
    const countFor = async (table: string, col: string, status?: string) => {
      if (!hasCol(table, col) || (status && !hasCol(table, status))) return;
      const found = await query(
        `SELECT ${quoteIdent(col)}::text AS k, ${status ? `coalesce(${quoteIdent(status)}::text, '')` : `''`} AS s, count(*)::int AS n
         FROM ${quoteIdent(table)} WHERE ${quoteIdent(col)} IS NOT NULL GROUP BY 1, 2`,
      );
      for (const r of found) {
        const linkKey = status ? `${table}.${col}[${status}=${r.s}]` : `${table}.${col}`;
        const person = byDependent.get(String(r.k));
        if (person) person.links[linkKey] = (person.links[linkKey] ?? 0) + Number(r.n);
        else orphans[linkKey] = (orphans[linkKey] ?? 0) + Number(r.n);
      }
    };
    for (const ref of (await foreignKeysTo(query, cfg, d.table)).sort()) {
      const [table, col] = ref.split(".");
      await countFor(table, col);
    }
    for (const l of d.statusLinks) await countFor(l.table, l.person, l.status);

    // Guardians who can actually act for the child: a deleted account or an
    // ended link is nobody to see, manage or delete that child's data.
    const [gTable, gCol] = d.guardianLink.split(".");
    if (d.guardianPerson && hasCol(gTable, gCol) && hasCol(gTable, d.guardianPerson)) {
      const liveAccount = identity.deleted ? `a.${quoteIdent(identity.deleted)} IS NULL` : "true";
      const notEnded = d.guardianEnded && hasCol(gTable, d.guardianEnded) ? `g.${quoteIdent(d.guardianEnded)} IS NULL` : "true";
      for (const person of byDependent.values()) person.liveGuardians = 0;
      const live = await query(
        `SELECT g.${quoteIdent(gCol)}::text AS k, count(*)::int AS n
         FROM ${quoteIdent(gTable)} g JOIN ${quoteIdent(identity.table)} a ON a.${quoteIdent(identity.id)} = g.${quoteIdent(d.guardianPerson)}
         WHERE ${liveAccount} AND ${notEnded} GROUP BY 1`,
      );
      for (const r of live) {
        const person = byDependent.get(String(r.k));
        if (person) person.liveGuardians = Number(r.n);
      }
    }
  }

  return { version: SNAPSHOT_VERSION, takenAt: new Date(String(now)).toISOString(), label: opts.label ?? "", identityTable: identity.table, tables, people, orphans };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type Level = "error" | "warning" | "info";
export type Finding = { level: Level; code: string; message: string; target?: string; people?: string[]; count?: number };

const MAX_SAMPLES = 20;

function finding(level: Level, code: string, message: string, extra: Partial<Finding> = {}): Finding {
  const f: Finding = { level, code, message, ...extra };
  if (f.people && f.people.length > MAX_SAMPLES) {
    f.count = f.people.length;
    f.people = f.people.slice(0, MAX_SAMPLES);
  } else if (f.people) f.count = f.people.length;
  return f;
}

/** Health checks on one snapshot: can every account still sign in, unambiguously? */
export function checkSnapshot(s: Snapshot): Finding[] {
  const out: Finding[] = [];
  if (!s.identityTable) return [finding("error", "NO_ACCOUNTS_TABLE", "No accounts table found (players/users), so nobody can sign in.")];
  const live = s.people.filter((p) => !p.deleted && p.kind !== "dependent");
  const dependents = s.people.filter((p) => !p.deleted && p.kind === "dependent");
  const guardiansOf = (p: PersonSnap) => p.liveGuardians ?? (p.guardianLink ? (p.links[p.guardianLink] ?? 0) : 0);
  const unguarded = dependents.filter((p) => !(guardiansOf(p) > 0)).map((p) => p.id);
  if (unguarded.length)
    out.push(finding("error", "DEPENDENT_WITHOUT_GUARDIAN", "Junior profiles with no guardian: nobody can see, manage or delete that child's data.", { people: unguarded }));

  const empty = live.filter((p) => p.emailEmpty).map((p) => p.id);
  if (empty.length) out.push(finding("error", "EMPTY_EMAIL", "Accounts with an empty email can't receive a sign-in code.", { people: empty }));

  const groups = (key: (p: PersonSnap) => string | null) => {
    const m = new Map<string, string[]>();
    for (const p of live) {
      const k = key(p);
      if (k) m.set(k, [...(m.get(k) ?? []), p.id]);
    }
    return [...m.values()].filter((ids) => ids.length > 1).flat();
  };
  const dupEmail = groups((p) => (p.emailEmpty ? null : p.emailHash));
  if (dupEmail.length)
    out.push(finding("error", "DUPLICATE_EMAIL", "Several live accounts share one email (ignoring case/spaces), so a sign-in code can't pick the right one.", { people: dupEmail }));
  const dupPhone = groups((p) => p.phoneHash);
  if (dupPhone.length) out.push(finding("error", "DUPLICATE_VERIFIED_PHONE", "Several live accounts share one verified phone, so SMS sign-in is ambiguous.", { people: dupPhone }));

  for (const [key, n] of Object.entries(s.orphans)) {
    if (/^memberships\.email\[status=active\]$/.test(key))
      out.push(finding("warning", "ACTIVE_MEMBERSHIP_WITHOUT_ACCOUNT", "Active memberships whose email has no account: those members can't see their membership in the app.", { target: key, count: n }));
    else if (!key.includes("@") && /\.(player_id|user_id|p1|p2|a1|a2|player_low|player_high)$/.test(key))
      out.push(finding("warning", "ROWS_POINT_AT_MISSING_ACCOUNT", "Rows point at an account id that doesn't exist.", { target: key, count: n }));
  }

  const roles = s.people.flatMap((p) => Object.keys(p.links).filter((k) => /^(club_roles|club_members)\..*\[role=(owner|admin)\]$/.test(k) && !p.deleted));
  const hasRoleTable = Object.keys(s.tables).some((t) => t === "club_roles" || t === "club_members");
  if (hasRoleTable && roles.length === 0) out.push(finding("error", "NO_ADMIN", "A roles table exists but no live account is an owner or admin: nobody can reach admin."));

  out.push(
    finding("info", "SUMMARY", `${live.length} live accounts, ${live.filter((p) => p.liveSessions > 0).length} signed in on at least one device${dependents.length ? `; ${dependents.length} junior profiles` : ""}.`),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Expectations: what a change is allowed to do, each with a reason.
// ---------------------------------------------------------------------------

const allow = z.array(z.object({ target: z.string().min(1), reason: z.string().min(10) }));

export const ExpectationsSchema = z.object({
  change: z.string().min(1),
  description: z.string().min(1),
  renamedTables: z.record(z.string()).default({}),
  renamedColumns: z.record(z.string()).default({}),
  allowDroppedTables: allow.default([]),
  allowDroppedColumns: allow.default([]),
  allowChangedColumns: allow.default([]),
  /**
   * Tables allowed to have fewer rows. With `people`, only those people (an
   * account id, or "junior:<id>") may have fewer rows there: anyone else
   * losing a row in the same table is still DATA_LOST. Without it, the
   * allowance covers everyone in the table (a whole-table clean-up).
   */
  allowRowDecrease: z.array(z.object({ target: z.string().min(1), reason: z.string().min(10), people: z.array(z.string().min(1)).min(1).optional() })).default([]),
  allowDataLoss: allow.default([]),
  /** Account ids allowed to be removed or have their email changed (e.g. a reviewed duplicate merge). */
  allowAccountChanges: allow.default([]),
  /** "true" only for a deliberate sign-out of everyone (e.g. a session-secret rotation), with a reason. */
  allowSignOut: z.object({ reason: z.string().min(10) }).optional(),
  /** Tables or columns that live traffic changes on its own (only for checks against a live database). */
  volatile: z.array(z.string()).default([]),
});
export type Expectations = z.infer<typeof ExpectationsSchema>;

export const NO_CHANGES: Expectations = ExpectationsSchema.parse({ change: "none", description: "Nothing may change." });

function matches(list: { target: string }[], target: string): boolean {
  return list.some((a) => a.target === target || (a.target.endsWith(".*") && target.startsWith(a.target.slice(0, -1))) || a.target === "*");
}

/** Map a before-name (table or link key) to its after-name using the renames. */
function renameLink(key: string, x: Expectations): string {
  const m = key.match(/^([^.[]+)\.([^[]+)(\[.*\])?$/);
  if (!m) return key;
  const [, table, col, rest = ""] = m;
  const t = x.renamedTables[table] ?? table;
  const full = x.renamedColumns[`${table}.${col}`] ?? x.renamedColumns[`${t}.${col}`];
  const c = full ? full.split(".").pop()! : col;
  return `${t}.${c}${rest}`;
}

/** Everything that changed between two snapshots, judged against the expectations. */
export function diffSnapshots(before: Snapshot, after: Snapshot, x: Expectations = NO_CHANGES): Finding[] {
  const out: Finding[] = [];
  const isVolatile = (target: string) => x.volatile.some((v) => v === target || target.startsWith(`${v}.`));

  // ---- Tables ----
  for (const [name, b] of Object.entries(before.tables)) {
    const newName = x.renamedTables[name] ?? name;
    const a = after.tables[newName];
    if (isVolatile(name)) continue;
    if (!a) {
      if (!matches(x.allowDroppedTables, name)) out.push(finding("error", "TABLE_DROPPED", `Table ${name} is gone (${b.rows} rows).`, { target: name, count: b.rows }));
      continue;
    }
    if (a.rows < b.rows && !matches(x.allowRowDecrease, name))
      out.push(finding("error", "ROWS_LOST", `${name}: ${b.rows} → ${a.rows} rows.`, { target: name, count: b.rows - a.rows }));
    else if (a.rows === b.rows && b.primaryKey.length > 0 && a.keyHash !== b.keyHash && b.primaryKey.join() === a.primaryKey.join() && !matches(x.allowRowDecrease, name))
      out.push(finding("error", "ROWS_REPLACED", `${name}: same row count but different rows (some deleted, others added).`, { target: name }));
    else if (a.rows > b.rows) out.push(finding("info", "ROWS_ADDED", `${name}: ${b.rows} → ${a.rows} rows.`, { target: name }));

    for (const [col, bc] of Object.entries(b.columns)) {
      const target = `${name}.${col}`;
      if (isVolatile(target)) continue;
      const renamed = x.renamedColumns[target];
      const newCol = renamed ? renamed.split(".").pop()! : col;
      const ac = a.columns[newCol];
      if (!ac) {
        if (!matches(x.allowDroppedColumns, target)) out.push(finding("error", "COLUMN_DROPPED", `Column ${target} is gone.`, { target }));
        continue;
      }
      if (ac.type !== bc.type) out.push(finding("warning", "TYPE_CHANGED", `${target}: ${bc.type} → ${ac.type}.`, { target }));
      // Values compared only when the row set is the same; lost/added rows are reported above.
      // Tables without a primary key hash each column as a sorted set, so equal counts suffice.
      const sameRows = a.rows === b.rows && (b.primaryKey.length === 0 || a.keyHash === b.keyHash);
      if (sameRows && ac.hash !== bc.hash && !matches(x.allowChangedColumns, target)) {
        const detail = [bc.nulls !== ac.nulls ? `empty values ${bc.nulls} → ${ac.nulls}` : "", bc.sum !== ac.sum && bc.sum !== undefined ? `sum ${bc.sum} → ${ac.sum}` : ""]
          .filter(Boolean)
          .join(", ");
        out.push(finding("error", "VALUES_CHANGED", `${target}: existing values changed${detail ? ` (${detail})` : ""}.`, { target }));
      } else if (bc.sum !== undefined && ac.sum !== undefined && bc.sum !== ac.sum && !matches(x.allowChangedColumns, target) && !matches(x.allowRowDecrease, name)) {
        out.push(finding(a.rows >= b.rows ? "info" : "error", "SUM_CHANGED", `${target}: total ${bc.sum} → ${ac.sum}.`, { target }));
      }
    }
  }
  for (const name of Object.keys(after.tables)) {
    const wasRenamed = Object.values(x.renamedTables).includes(name);
    if (!before.tables[name] && !wasRenamed) out.push(finding("info", "TABLE_ADDED", `New table ${name}.`, { target: name }));
  }

  // ---- People ----
  if (before.identityTable && !after.identityTable) {
    out.push(finding("error", "NO_ACCOUNTS_TABLE", "The accounts table is gone after the change: nobody can sign in."));
    return out;
  }
  const afterById = new Map(after.people.map((p) => [p.id, p]));
  const afterByEmail = new Map<string, PersonSnap>();
  for (const p of after.people) if (!p.emailEmpty && (!afterByEmail.has(p.emailHash) || afterByEmail.get(p.emailHash)!.deleted)) afterByEmail.set(p.emailHash, p);

  const missing: string[] = [];
  const dependentMissing: string[] = [];
  const dependentDeleted: string[] = [];
  const deletedNow: string[] = [];
  const emailChanged: string[] = [];
  const phoneLost: string[] = [];
  const signedOut: string[] = [];
  const lostData = new Map<string, string[]>();
  const accountAllowed = (id: string) => matches(x.allowAccountChanges, id);
  // An allowance that names people excuses only them; one that doesn't excuses the whole table.
  const rowDecreaseAllowedFor = (table: string, personId: string) =>
    matches(x.allowRowDecrease.filter((a) => !a.people || a.people.includes(personId)), table);

  for (const b of before.people) {
    if (b.deleted) continue;
    // Same id first (ids are stable unless the change says otherwise), then same email.
    let a = afterById.get(b.id);
    if (a && a.emailHash !== b.emailHash) {
      if (!accountAllowed(b.id)) emailChanged.push(b.id);
    }
    if (!a) a = afterByEmail.get(b.emailHash);
    if (!a) {
      if (!accountAllowed(b.id)) (b.kind === "dependent" ? dependentMissing : missing).push(b.id);
      continue;
    }
    if (a.deleted) {
      if (!accountAllowed(b.id)) (b.kind === "dependent" ? dependentDeleted : deletedNow).push(b.id);
      continue;
    }
    if (b.phoneHash && a.phoneHash !== b.phoneHash && !accountAllowed(b.id)) phoneLost.push(b.id);
    const naturallyExpired = b.sessionsExpireAt !== null && after.takenAt >= b.sessionsExpireAt;
    if (b.liveSessions > 0 && a.liveSessions === 0 && !naturallyExpired && !x.allowSignOut) signedOut.push(b.id);
    for (const [key, n] of Object.entries(b.links)) {
      const newKey = renameLink(key, x);
      const table = newKey.split(".")[0];
      if (isVolatile(key.split(".")[0]) || isVolatile(key.split("[")[0])) continue;
      if ((a.links[newKey] ?? 0) < n && !matches(x.allowDataLoss, key) && !matches(x.allowDataLoss, newKey) && !rowDecreaseAllowedFor(table, b.id)) {
        lostData.set(key, [...(lostData.get(key) ?? []), b.id]);
      }
    }
  }

  if (missing.length) out.push(finding("error", "ACCOUNT_MISSING", "Accounts that existed before are gone (no same id, no same email).", { people: missing }));
  if (deletedNow.length) out.push(finding("error", "ACCOUNT_DELETED", "Live accounts became deleted.", { people: deletedNow }));
  if (dependentMissing.length) out.push(finding("error", "DEPENDENT_MISSING", "Junior profiles that existed before are gone.", { people: dependentMissing }));
  if (dependentDeleted.length) out.push(finding("error", "DEPENDENT_DELETED", "Live junior profiles became deleted.", { people: dependentDeleted }));
  if (emailChanged.length) out.push(finding("error", "EMAIL_CHANGED", "Accounts' sign-in email changed, so their codes now go elsewhere.", { people: emailChanged }));
  if (phoneLost.length) out.push(finding("error", "PHONE_SIGNIN_LOST", "Accounts lost their verified phone (SMS sign-in).", { people: phoneLost }));
  if (signedOut.length) out.push(finding("error", "SIGNED_OUT", "People signed in before are signed out after (sessions gone before their expiry).", { people: signedOut }));
  for (const [key, ids] of lostData) out.push(finding("error", "DATA_LOST", `People have fewer ${key} rows than before.`, { target: key, people: ids }));

  for (const [key, n] of Object.entries(after.orphans)) {
    const beforeN = Object.entries(before.orphans).reduce((sum, [k, v]) => (renameLink(k, x) === key ? sum + v : sum), 0);
    if (n > beforeN) out.push(finding("warning", "ROWS_UNLINKED", `${key}: ${n - beforeN} more rows point at no account.`, { target: key, count: n - beforeN }));
  }

  // Health of the after state on its own, so a change can't introduce duplicates.
  for (const f of checkSnapshot(after)) if (f.level === "error") out.push({ ...f, code: `AFTER_${f.code}` });

  const errors = out.filter((f) => f.level === "error").length;
  const checked = before.people.filter((p) => !p.deleted);
  const juniors = checked.filter((p) => p.kind === "dependent").length;
  out.push(finding("info", "SUMMARY", `${checked.length - juniors} accounts${juniors ? ` and ${juniors} junior profiles` : ""} checked, ${errors} problem${errors === 1 ? "" : "s"}.`));
  return out;
}

export const hasErrors = (findings: Finding[]) => findings.some((f) => f.level === "error");

export function formatFindings(findings: Finding[]): string {
  const icon: Record<Level, string> = { error: "✖", warning: "▲", info: "·" };
  return findings
    .map((f) => {
      const who = f.people?.length ? `\n      account ids: ${f.people.join(", ")}${(f.count ?? 0) > f.people.length ? ` … (+${f.count! - f.people.length} more)` : ""}` : "";
      const n = f.count !== undefined && !f.people ? ` [${f.count}]` : "";
      return `  ${icon[f.level]} ${f.code}${n}: ${f.message}${who}`;
    })
    .join("\n");
}
