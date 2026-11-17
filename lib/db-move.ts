import { createPool, type VercelPool } from "@vercel/postgres";

// One-off database move (e.g. to a Sydney Neon database), run on Vercel so
// it can reach both databases without anyone handling their passwords.
//
//   source: the database the site uses now (POSTGRES_URL, or the original
//           one kept in POSTGRES_URL_PREVIOUS after the switch)
//   target: the new database, connected with a prefix (default SYD_*)
//
// Copies every table in the public schema exactly: columns, defaults,
// NOT NULL, primary/unique/check/foreign keys, indexes and sequence values.
// Rows travel as JSON (row_to_json → json_populate_recordset), so dates,
// timestamps, arrays and JSON keep their exact Postgres values.
// Preview test tables (pv_*) and schema_runs are skipped.

export type MoveMode = "check" | "copy" | "catchup";

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

export function moveUrls(): { source: string | null; target: string | null; targetVar: string } {
  const targetVar = process.env.DB_MOVE_TARGET_VAR || "SYD_POSTGRES_URL";
  const source = process.env.POSTGRES_URL_PREVIOUS || process.env.POSTGRES_URL || null;
  const target = process.env[targetVar] || null;
  return { source, target, targetVar };
}

function hostOf(url: string | null): string {
  try {
    return url ? new URL(url).hostname.replace(/^[^.]+/, "…") : "missing";
  } catch {
    return "invalid";
  }
}

const skip = (t: string) => t.startsWith("pv_") || t === "schema_runs";

async function tables(pool: VercelPool): Promise<string[]> {
  const { rows } = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`);
  return rows.map((r) => r.tablename as string).filter((t) => !skip(t));
}

async function counts(pool: VercelPool, list: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const t of list) {
    try {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM public.${q(t)};`);
      out[t] = rows[0].n;
    } catch {
      out[t] = null;
    }
  }
  return out;
}

async function copySchemaAndData(src: VercelPool, dst: VercelPool, list: string[], log: string[]): Promise<void> {
  // Sequences first (serial columns' defaults point at them).
  const { rows: seqs } = await src.query(
    `SELECT sequencename, data_type::text AS data_type, last_value, increment_by, start_value FROM pg_sequences WHERE schemaname = 'public';`,
  );
  const { rows: owned } = await src.query(
    `SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
     FROM pg_depend d
     JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
     JOIN pg_class t ON t.oid = d.refobjid
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
     WHERE d.deptype = 'a' AND s.relnamespace = 'public'::regnamespace;`,
  );
  const wanted = new Set(list);
  const seqList = seqs.filter((s) => {
    const o = owned.find((x) => x.seq === s.sequencename);
    return !o || wanted.has(o.tbl);
  });
  for (const s of seqList) {
    const asType = /^(smallint|integer|bigint)$/.test(s.data_type) ? ` AS ${s.data_type}` : "";
    await dst.query(`CREATE SEQUENCE IF NOT EXISTS public.${q(s.sequencename)}${asType} INCREMENT BY ${Number(s.increment_by)} START WITH ${Number(s.start_value)};`);
  }

  // Tables: columns, types, defaults, NOT NULL.
  for (const t of list) {
    const { rows: cols } = await src.query(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS def
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum;`,
      [`public.${q(t)}`],
    );
    const body = cols
      .map((c) => `${q(c.attname)} ${c.type}${c.def ? ` DEFAULT ${c.def}` : ""}${c.attnotnull ? " NOT NULL" : ""}`)
      .join(", ");
    await dst.query(`CREATE TABLE public.${q(t)} (${body});`);
  }
  log.push(`created ${list.length} tables and ${seqList.length} sequences`);

  // Data, 500 rows at a time.
  let total = 0;
  for (const t of list) {
    for (let offset = 0; ; offset += 500) {
      const { rows } = await src.query(
        `SELECT coalesce(json_agg(r), '[]'::json)::text AS batch
         FROM (SELECT * FROM public.${q(t)} ORDER BY 1 LIMIT 500 OFFSET ${offset}) r;`,
      );
      const batch = rows[0].batch as string;
      if (batch === "[]") break;
      const res = await dst.query(`INSERT INTO public.${q(t)} SELECT * FROM json_populate_recordset(NULL::public.${q(t)}, $1::json);`, [batch]);
      total += res.rowCount ?? 0;
      if ((res.rowCount ?? 0) < 500) break;
    }
  }
  log.push(`copied ${total} rows`);

  // Constraints: keys and checks first, then foreign keys.
  const { rows: cons } = await src.query(
    `SELECT c.conrelid::regclass::text AS tbl, c.conname, c.contype, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.contype IN ('p','u','c','f')
     ORDER BY CASE c.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'c' THEN 2 ELSE 3 END;`,
  );
  const bare = (s: string) => s.replace(/^public\./, "").replace(/^"|"$/g, "");
  let nCons = 0;
  for (const c of cons) {
    if (!wanted.has(bare(c.tbl))) continue;
    await dst.query(`ALTER TABLE public.${q(bare(c.tbl))} ADD CONSTRAINT ${q(c.conname)} ${c.def};`);
    nCons++;
  }
  // Indexes that don't belong to a constraint (those were created above).
  const conNames = new Set(cons.map((c) => c.conname as string));
  const { rows: idx } = await src.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public';`);
  let nIdx = 0;
  for (const i of idx) {
    if (!wanted.has(i.tablename) || conNames.has(i.indexname)) continue;
    await dst.query(i.indexdef);
    nIdx++;
  }
  log.push(`added ${nCons} constraints and ${nIdx} indexes`);

  await syncSequences(src, dst, seqList, owned, wanted);
  log.push("sequence values copied");
}

async function syncSequences(
  src: VercelPool,
  dst: VercelPool,
  seqList: Record<string, unknown>[],
  owned: Record<string, unknown>[],
  wanted: Set<string>,
): Promise<void> {
  for (const s of seqList) {
    const { rows } = await src.query(`SELECT last_value, is_called FROM public.${q(String(s.sequencename))};`);
    await dst.query(`SELECT setval('public.${q(String(s.sequencename))}', $1, $2);`, [rows[0].last_value, rows[0].is_called]);
    const o = owned.find((x) => x.seq === s.sequencename);
    if (o && wanted.has(String(o.tbl))) {
      await dst.query(`ALTER SEQUENCE public.${q(String(s.sequencename))} OWNED BY public.${q(String(o.tbl))}.${q(String(o.col))};`);
    }
  }
}

/** After the switch: copies rows added to the old database in the meantime (tables keyed by a numeric id). */
async function catchUp(src: VercelPool, dst: VercelPool, list: string[], log: string[]): Promise<void> {
  const { rows: pks } = await src.query(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
     FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'p' AND array_length(c.conkey, 1) = 1 AND c.connamespace = 'public'::regnamespace;`,
  );
  let added = 0;
  for (const pk of pks) {
    const t = String(pk.tbl).replace(/^public\./, "").replace(/^"|"$/g, "");
    if (!list.includes(t) || !/^(integer|bigint|smallint)$/.test(pk.type)) continue;
    const { rows: mx } = await dst.query(`SELECT coalesce(max(${q(pk.col)}), 0)::bigint AS m FROM public.${q(t)};`);
    const { rows } = await src.query(
      `SELECT coalesce(json_agg(r), '[]'::json)::text AS batch FROM (SELECT * FROM public.${q(t)} WHERE ${q(pk.col)} > $1) r;`,
      [mx[0].m],
    );
    if (rows[0].batch === "[]") continue;
    const res = await dst.query(`INSERT INTO public.${q(t)} SELECT * FROM json_populate_recordset(NULL::public.${q(t)}, $1::json) ON CONFLICT DO NOTHING;`, [rows[0].batch]);
    added += res.rowCount ?? 0;
    log.push(`${t}: +${res.rowCount ?? 0}`);
  }
  const { rows: seqs } = await src.query(`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public';`);
  for (const s of seqs) {
    if (String(s.sequencename).startsWith("pv_")) continue;
    try {
      const { rows } = await src.query(`SELECT last_value, is_called FROM public.${q(s.sequencename)};`);
      await dst.query(`SELECT setval('public.${q(s.sequencename)}', greatest($1::bigint, (SELECT last_value FROM public.${q(s.sequencename)})), $2);`, [rows[0].last_value, rows[0].is_called]);
    } catch {
      // sequence of a skipped table
    }
  }
  log.push(`catch-up added ${added} rows`);
}

export async function runMove(mode: MoveMode): Promise<Record<string, unknown>> {
  const { source, target, targetVar } = moveUrls();
  const log: string[] = [];
  const report: Record<string, unknown> = { mode, sourceHost: hostOf(source), targetHost: hostOf(target), targetVar, log };
  if (!source || !target) return { ...report, error: `missing ${!source ? "source (POSTGRES_URL)" : targetVar}` };
  if (source === target) return { ...report, error: "source and target are the same database" };
  const src = createPool({ connectionString: source });
  const dst = createPool({ connectionString: target });
  try {
    const list = await tables(src);
    const existing = await tables(dst);
    if (mode === "copy") {
      if (existing.some((t) => list.includes(t))) return { ...report, error: "target already has these tables; refusing to overwrite", existing };
      await copySchemaAndData(src, dst, list, log);
    } else if (mode === "catchup") {
      await catchUp(src, dst, list, log);
    }
    const [a, b] = await Promise.all([counts(src, list), counts(dst, list)]);
    const mismatched = list.filter((t) => a[t] !== b[t]);
    return { ...report, tables: list.length, sourceRows: a, targetRows: b, mismatched, ok: mismatched.length === 0 };
  } finally {
    await Promise.allSettled([src.end(), dst.end()]);
  }
}
