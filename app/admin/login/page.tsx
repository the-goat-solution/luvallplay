import { LoginSubmitButton } from "@/components/admin/LoginSubmitButton";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

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
