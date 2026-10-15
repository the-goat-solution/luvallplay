import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminNav } from "@/components/admin/AdminNav";
import adminStyles from "@/components/admin/admin.module.css";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { sendJerseyRegistrationEmail } from "@/lib/email";
import {
  EARLY_BIRD_CENTS,
  JERSEY_SIZES,
  PRINT_CENTS,
  PRINT_COUNTRY_MAX,
  PRINT_NAME_MAX,
  STANDARD_CENTS,
  cleanPrintText,
  formatDollars,
} from "@/lib/jersey";
import { createJerseyByAdmin } from "@/lib/jersey-db";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message: string): never {
  redirect(`/admin/jersey/new?error=${encodeURIComponent(message)}`);
}

async function create(formData: FormData) {
  "use server";
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const firstName = text("firstName");
  const lastName = text("lastName");
  const email = text("email");
  const phone = text("phone");
  const size = text("size");

  if (!firstName || !lastName) fail("First and last name are required.");
  if (!EMAIL_RE.test(email)) fail("Please enter a valid email address.");
  if (phone && phone.length < 6) fail("That phone number looks too short. Leave it empty if you don't have one.");
  if (!(JERSEY_SIZES as readonly string[]).includes(size)) fail("Pick a size.");

  const printName = cleanPrintText(formData.get("printName") as string | null);
  const printKind = text("printKind") === "country" ? "country" : "number";
  const numberRaw = text("printNumber");
  const country = cleanPrintText(formData.get("printCountry") as string | null);
  let printNumber: number | null = null;
  if (printName && printKind === "number" && numberRaw !== "") {
    const n = Number(numberRaw);
    if (!Number.isInteger(n) || n < 0 || n > 99) fail("The number must be a whole number from 0 to 99.");
    printNumber = n;
  }
  const printCountry = printName && printKind === "country" && country ? country.slice(0, PRINT_COUNTRY_MAX) : null;
  if (!printName && (numberRaw !== "" || country)) {
    fail("A number or country can only be printed with a name. Add the name, or clear both.");
  }

  const payment = text("payment") === "free" ? "free" : "code";
  const priceModeRaw = text("priceMode");
  const priceMode = priceModeRaw === "early" || priceModeRaw === "standard" ? priceModeRaw : "auto";
  const lang = text("lang") === "vi" ? "vi" : "en";

  const result = await createJerseyByAdmin({
    firstName,
    lastName,
    email,
    phone,
    size,
    printName: printName ? printName.slice(0, PRINT_NAME_MAX) : null,
    printNumber,
    printCountry,
    payment,
    priceMode,
    lang,
  });
  if (!result.ok) fail("Another live registration already uses that email address.");

  const r = result.registration;
  let message: string;
  if (payment === "free") {
    message = `Added ${firstName} ${lastName} as a free entry (no code, no payment).`;
  } else {
    message = `Added ${firstName} ${lastName}: code ${r.refCode}, ${formatDollars(r.priceCents)} to pay.`;
    if (formData.get("sendEmail") === "on") {
      try {
        await sendJerseyRegistrationEmail({
          to: r.email,
          firstName: r.firstName,
          refCode: r.refCode ?? "",
          priceCents: r.priceCents,
          earlyBird: r.earlyBird,
          lang: r.lang,
          deadline: null,
        });
        message += " Code emailed.";
      } catch (err) {
        console.error("Jersey admin-add email failed", err);
        message += " The email could not be sent; give them the code yourself.";
      }
    }
  }
  revalidatePath("/admin/jersey");
  redirect(`/admin/jersey?toast=${encodeURIComponent(message)}`);
}

const input = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #ccc",
  fontSize: 14,
  boxSizing: "border-box",
} as const;
const label = { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 } as const;
const field = { marginBottom: 14 } as const;
const box = { border: "1px solid #e3e3e3", borderRadius: 8, padding: "12px 14px", margin: "6px 0 16px" } as const;

export default async function NewJerseyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Add jersey registration</h1>
      <p className={adminStyles.subtitle}>
        Add someone yourself, for example a sponsor, a coach or a person paying in cash. This bypasses the opening and closing times.
      </p>
      <AdminNav active="jersey" />

      <form action={create} style={{ maxWidth: 560 }}>
        {error ? (
          <div role="alert" style={{ background: "#fdecea", color: "#a12622", padding: "10px 12px", borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={field}>
            <label style={label} htmlFor="firstName">First name</label>
            <input id="firstName" name="firstName" required maxLength={80} style={input} />
          </div>
          <div style={field}>
            <label style={label} htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" required maxLength={80} style={input} />
          </div>
        </div>
        <div style={field}>
          <label style={label} htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required maxLength={200} style={input} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={field}>
            <label style={label} htmlFor="phone">Phone (optional)</label>
            <input id="phone" name="phone" type="tel" maxLength={30} style={input} />
          </div>
          <div style={field}>
            <label style={label} htmlFor="size">Size</label>
            <select id="size" name="size" required defaultValue="" style={input}>
              <option value="" disabled>Choose a size</option>
              {JERSEY_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <fieldset style={box}>
          <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 6px" }}>Printing on the back (+{formatDollars(PRINT_CENTS)}, free entries pay nothing)</legend>
          <div style={field}>
            <label style={label} htmlFor="printName">Name (leave empty for no printing)</label>
            <input id="printName" name="printName" maxLength={PRINT_NAME_MAX} style={input} />
          </div>
          <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 14 }}>
            <label><input type="radio" name="printKind" value="number" defaultChecked /> Number</label>
            <label><input type="radio" name="printKind" value="country" /> Country</label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={label} htmlFor="printNumber">Number (0–99)</label>
              <input id="printNumber" name="printNumber" type="number" min={0} max={99} style={input} />
            </div>
            <div>
              <label style={label} htmlFor="printCountry">Country</label>
              <input id="printCountry" name="printCountry" maxLength={PRINT_COUNTRY_MAX} style={input} />
            </div>
          </div>
        </fieldset>

        <fieldset style={box}>
          <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 6px" }}>Payment</legend>
          <label style={{ display: "block", fontSize: 14, marginBottom: 8 }}>
            <input type="radio" name="payment" value="code" defaultChecked /> <strong>Generate a reference code</strong>: they pay by bank transfer using the code
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "0 0 8px 22px" }}>
            <div>
              <label style={label} htmlFor="priceMode">Price</label>
              <select id="priceMode" name="priceMode" defaultValue="auto" style={input}>
                <option value="auto">Automatic (early bird while spots remain)</option>
                <option value="early">Early bird {formatDollars(EARLY_BIRD_CENTS)}</option>
                <option value="standard">Standard {formatDollars(STANDARD_CENTS)}</option>
              </select>
            </div>
            <div>
              <label style={label} htmlFor="lang">Email language</label>
              <select id="lang" name="lang" defaultValue="en" style={input}>
                <option value="en">English</option>
                <option value="vi">Tiếng Việt</option>
              </select>
            </div>
          </div>
          <label style={{ display: "block", fontSize: 13, margin: "0 0 12px 22px" }}>
            <input type="checkbox" name="sendEmail" defaultChecked /> Email them the code and bank details
          </label>
          <label style={{ display: "block", fontSize: 14 }}>
            <input type="radio" name="payment" value="free" /> <strong>Free</strong>: no code, no payment required, confirmed straight away
          </label>
        </fieldset>

        <p style={{ fontSize: 13, color: "#666", margin: "0 0 16px" }}>
          A coded entry has no 48-hour hold, so it stays until you mark it paid, release it or cancel it. Free entries never use up an early-bird spot.
        </p>

        <div style={{ display: "flex", gap: 10 }}>
          <SubmitButton
            loadingText="Adding…"
            style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #1a2a4a", background: "#1a2a4a", color: "#fff", fontSize: 14 }}
          >
            Add registration
          </SubmitButton>
          <Link
            href="/admin/jersey"
            style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", color: "#333", fontSize: 14, textDecoration: "none" }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
