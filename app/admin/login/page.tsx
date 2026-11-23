import { LoginSubmitButton } from "@/components/admin/LoginSubmitButton";
import { Notice, kit } from "@/components/admin/kit";

export const dynamic = "force-dynamic";

// Break-glass only. Admin is reached by signing in as yourself (a player
// account with a club role); the middleware sends /admin/login to /login.
// This password form stays reachable at /admin/login?breakglass=1 for two
// weeks after the switch-over, in case account sign-in fails, then it's
// removed along with ADMIN_PASSWORD.
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; loggedOut?: string }>;
}) {
  const { error, loggedOut } = await searchParams;

  return (
    <div className={kit.login}>
      <h1 className={kit.title}>Admin password (break-glass)</h1>
      <Notice>
        Admin now opens from your own profile: sign in at <a href="/login?next=/admin">the normal sign-in page</a>. Use this password only if that
        isn&apos;t working. Every use is logged.
      </Notice>
      {loggedOut && !error ? <Notice>You&apos;ve been logged out.</Notice> : null}
      <form method="POST" action="/api/admin-login">
        <input type="password" name="password" placeholder="Password" autoFocus required className={kit.loginInput} aria-label="Admin password" />
        <LoginSubmitButton />
      </form>
      {error && <Notice tone="error">Incorrect password.</Notice>}
    </div>
  );
}
