import { LoginSubmitButton } from "@/components/admin/LoginSubmitButton";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    expired?: string;
    loggedOut?: string;
  }>;
}) {
  const { error, expired, loggedOut } = await searchParams;

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 320,
        margin: "120px auto",
        padding: "0 20px",
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Admin login</h1>
      {expired && !error ? (
        <p
          style={{
            background: "#fdf3e3",
            color: "#7a4a00",
            padding: "9px 12px",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 14,
            lineHeight: 1.5,
          }}
        >
          Your session timed out after 48 hours without activity. Please log in
          again.
        </p>
      ) : null}
      {loggedOut && !error ? (
        <p
          style={{
            background: "#eef2f7",
            color: "#1a2a4a",
            padding: "9px 12px",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          You&apos;ve been logged out.
        </p>
      ) : null}
      <form method="POST" action="/api/admin-login">
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          required
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid #ccc",
            fontSize: 14,
            marginBottom: 10,
          }}
        />
        <LoginSubmitButton />
      </form>
      {error && (
        <p style={{ color: "#b00020", fontSize: 13, marginTop: 10 }}>
          Incorrect password.
        </p>
      )}
    </div>
  );
}
