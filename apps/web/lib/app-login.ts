// The app's own database login (runbook §11.2): a role that is not the
// owner, can't bypass row-level security, and has no rights of its own. All
// it can do is step down to the app's role, which sees one club at a time.
//
// checkAppLogin looks at a connection made with that login and returns what
// is wrong with it; empty = safe to give to the app. Read-only.
import { APP_ROLE } from "./tenant-scope.ts";

type Conn = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** The SQL that creates the login. The password is typed by the person running it, never stored here. */
export function appLoginSql(role: string): string {
  return [`CREATE ROLE ${role} LOGIN PASSWORD '<generated>' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;`, `GRANT ${APP_ROLE} TO ${role} WITH SET TRUE, INHERIT FALSE;`].join("\n");
}

export async function checkAppLogin(db: Conn, clubSlug: string): Promise<string[]> {
  const problems: string[] = [];
  const me = (
    await db.query(
      `SELECT current_user AS name, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
              (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relowner = r.oid) AS owned,
              (SELECT string_agg(g.rolname, ', ' ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid) AS member_of,
              has_schema_privilege(current_user, 'public', 'CREATE') AS can_create
       FROM pg_roles r WHERE r.rolname = current_user`,
    )
  ).rows[0] as { name: string; rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean; owned: number; member_of: string | null; can_create: boolean };
  if (me.name === APP_ROLE) problems.push(`the login is the app's role itself; it should be a separate role that is a member of it`);
  if (me.rolsuper) problems.push("the login is a superuser");
  if (me.rolbypassrls) problems.push("the login can bypass row-level security");
  if (me.rolcreatedb || me.rolcreaterole) problems.push("the login can create databases or roles");
  if (me.owned > 0) problems.push(`the login owns ${me.owned} table(s) or index(es): it is, or was made like, the owner`);
  if (me.can_create) problems.push("the login can create tables in the public schema");
  if (me.member_of !== APP_ROLE) problems.push(`the login should be a member of ${APP_ROLE} only (it is a member of: ${me.member_of ?? "nothing"})`);

  // With its own rights it reads nothing, not even a platform table.
  const own = await db.query(`SELECT count(*)::int AS n FROM tenants`).then(
    () => "read",
    (err: { code?: string }) => (err.code === "42501" ? "refused" : `error ${err.code}`),
  );
  if (own !== "refused") problems.push(`without stepping down, the login could read the clubs table (${own}); grant the app's role WITH INHERIT FALSE`);

  // Stepped down: nothing with no club named, the club's rows with it named.
  await db.query("BEGIN READ ONLY");
  try {
    await db.query(`SET LOCAL ROLE ${APP_ROLE}`);
    const none = (await db.query(`SELECT count(*)::int AS n FROM tenant_modules`)).rows[0].n as number;
    if (none !== 0) problems.push(`as the app's role with no club named, ${none} module row(s) are visible`);
    const club = (await db.query(`SELECT id FROM tenants WHERE slug = $1`, [clubSlug])).rows[0] as { id: number } | undefined;
    if (!club) problems.push(`no club "${clubSlug}"`);
    else {
      await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(club.id)]);
      const mine = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE tenant_id <> $1)::int AS others FROM tenant_modules`, [club.id])).rows[0] as { n: number; others: number };
      if (mine.n === 0) problems.push("as the app's role for the club, its module rows are not visible");
      if (mine.others !== 0) problems.push(`as the app's role for the club, ${mine.others} row(s) of other clubs are visible`);
    }
  } catch (err) {
    problems.push(`stepping down to ${APP_ROLE} failed: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
  } finally {
    await db.query("ROLLBACK").catch(() => {});
  }
  return problems;
}
