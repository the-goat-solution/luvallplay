// The migration history, as the running app can see it (Admin → Setup check).
// No imports: the check is tested without the rest of the app.

/**
 * When the newest applied migration was created (the journal's `when`), or
 * null when the database has no migration history, or "unreadable" when the
 * connection isn't allowed to look.
 *
 * Asked on the unscoped pool: the history lives in the `drizzle` schema,
 * which the app's role (every statement under TENANT_SCOPE=enforce) has no
 * rights on. Through the scoped client the read failed, and the failure used
 * to be reported as "no migration history". The app's own login
 * (APP_DATABASE_URL) can't read it either; that is said, not guessed around.
 */
export async function newestMigrationApplied(db: { query: (text: string) => Promise<{ rows: Record<string, unknown>[] }> }): Promise<number | null | "unreadable"> {
  try {
    const { rows } = await db.query(`SELECT max(created_at)::text AS at FROM drizzle.__drizzle_migrations`);
    return rows[0]?.at ? Number(rows[0].at) : null;
  } catch (err) {
    // 42501: insufficient privilege. Anything else (no such schema or table) is "no history".
    return (err as { code?: string }).code === "42501" ? "unreadable" : null;
  }
}
