import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Notice, PageHeader, Section, kit } from "@/components/admin/kit";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { input } from "@/components/admin/ui";
import { audit, requireAdminActor } from "@/lib/admin-access";
import {
  PLAN_IDS,
  loadClubSetting,
  listPricingPlansForAdmin,
  saveClubSetting,
  savePricingPlan,
} from "@/lib/business-config";
import { PRICES, SESSION_CAPACITY, type PlanId } from "@/lib/constants";
import type { CmsPricingPlan } from "@/lib/pricing-plans";

// Admin → Settings: the club's business config, moved out of Sanity into the
// database (Phase 2 PR 6). Pricing plans (names, descriptions, prices,
// features, Stripe price ids) and session settings. Full club admins only
// (lib/admin-roles.ts); the proxy also records every change in the audit log.

export const dynamic = "force-dynamic";
const PATH = "/admin/settings";

const PLAN_LABEL: Record<PlanId, string> = {
  casual: "Casual",
  fridayMonthly: "Monthly (Friday)",
  fridayQuarterly: "Quarterly (Friday)",
  wednesdayMonthly: "Monthly (Wednesday)",
  wednesdayQuarterly: "Quarterly (Wednesday)",
};

function back(param: "toast" | "toastError", message: string): never {
  redirect(`${PATH}?${param}=${encodeURIComponent(message)}`);
}

const text = (max: number) => z.string().max(max).default("");
const planSchema = z.object({
  planId: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]),
  nameEn: text(80),
  nameVi: text(80),
  descEn: text(300),
  descVi: text(300),
  periodEn: text(40),
  periodVi: text(40),
  price: z.union([z.literal(""), z.coerce.number().min(0).max(10000)]),
  featured: z.enum(["on"]).optional(),
  featuresEn: text(2000),
  featuresVi: text(2000),
  stripePriceId: z.union([z.literal(""), z.string().regex(/^price_[A-Za-z0-9]{6,}$/, "Stripe price ids look like price_…")]),
  sort: z.coerce.number().int().min(0).max(100),
});

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim());

async function savePlan(formData: FormData) {
  "use server";
  const { ctx } = await requireAdminActor(PATH);
  const parsed = planSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("toastError", parsed.error.issues[0]?.message ?? "Check the form.");
  const p = parsed.data;
  const en = lines(p.featuresEn);
  const vi = lines(p.featuresVi);
  const n = Math.max(en.length, vi.length);
  await savePricingPlan(
    {
      planId: p.planId,
      name: { en: p.nameEn, vi: p.nameVi },
      description: { en: p.descEn, vi: p.descVi },
      periodLabel: { en: p.periodEn, vi: p.periodVi },
      priceNzd: p.price === "" ? null : p.price,
      featured: p.featured === "on",
      features: Array.from({ length: n }, (_, i) => ({ en: en[i] ?? "", vi: vi[i] ?? "" })),
      stripePriceId: p.stripePriceId || null,
      sort: p.sort,
    },
    ctx.kind === "player" ? ctx.player.id : null,
  );
  await audit(ctx, { action: "settings.pricing_plan_saved", target: p.planId, meta: { price: p.price, stripePriceId: p.stripePriceId || null } });
  revalidatePath("/");
  revalidatePath(PATH);
  back("toast", `${PLAN_LABEL[p.planId]} saved.`);
}

const settingsSchema = z.object({
  maxCasualSpots: z.union([z.literal(""), z.coerce.number().int().min(1).max(200)]),
  bookingLockDays: z.union([z.literal(""), z.coerce.number().int().min(0).max(365)]),
});

async function saveSettings(formData: FormData) {
  "use server";
  const { ctx } = await requireAdminActor(PATH);
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("toastError", parsed.error.issues[0]?.message ?? "Check the form.");
  const actor = ctx.kind === "player" ? ctx.player.id : null;
  const spots = parsed.data.maxCasualSpots === "" ? null : parsed.data.maxCasualSpots;
  const lock = parsed.data.bookingLockDays === "" ? null : parsed.data.bookingLockDays;
  await saveClubSetting("max_casual_spots", spots, actor);
  await saveClubSetting("booking_lock_days", lock, actor);
  await audit(ctx, { action: "settings.club_saved", target: "club_settings", meta: { max_casual_spots: spots, booking_lock_days: lock } });
  revalidatePath("/");
  revalidatePath(PATH);
  back("toast", "Settings saved.");
}

const loc = (v: { en?: string; vi?: string } | undefined, k: "en" | "vi") => v?.[k] ?? "";

function PlanForm({ plan }: { plan: CmsPricingPlan & { sort: number } }) {
  const field = { ...input, width: "100%" } as const;
  return (
    <form action={savePlan} style={{ borderTop: "1px solid #eee", paddingTop: 12, marginTop: 12 }}>
      <input type="hidden" name="planId" value={plan.planId} />
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{PLAN_LABEL[plan.planId]}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <label>Name (English)<input name="nameEn" defaultValue={loc(plan.name, "en")} style={field} /></label>
        <label>Name (Vietnamese)<input name="nameVi" defaultValue={loc(plan.name, "vi")} style={field} /></label>
        <label>Description (English)<input name="descEn" defaultValue={loc(plan.description, "en")} style={field} /></label>
        <label>Description (Vietnamese)<input name="descVi" defaultValue={loc(plan.description, "vi")} style={field} /></label>
        <label>Period label (English)<input name="periodEn" defaultValue={loc(plan.periodLabel, "en")} style={field} /></label>
        <label>Period label (Vietnamese)<input name="periodVi" defaultValue={loc(plan.periodLabel, "vi")} style={field} /></label>
        <label>Price (NZD)<input name="price" inputMode="decimal" defaultValue={plan.priceNzd ?? ""} placeholder={String(PRICES[plan.planId])} style={field} /></label>
        <label>Stripe price id<input name="stripePriceId" defaultValue={plan.stripePriceId ?? ""} placeholder="price_…" style={field} /></label>
        <label>Order<input name="sort" inputMode="numeric" defaultValue={plan.sort} style={field} /></label>
        <label style={{ alignSelf: "end" }}><input type="checkbox" name="featured" defaultChecked={Boolean(plan.featured)} /> Featured</label>
        <label>Features, one per line (English)<textarea name="featuresEn" rows={5} defaultValue={(plan.features ?? []).map((f) => f.en ?? "").join("\n")} style={field} /></label>
        <label>Features, one per line (Vietnamese)<textarea name="featuresVi" rows={5} defaultValue={(plan.features ?? []).map((f) => f.vi ?? "").join("\n")} style={field} /></label>
      </div>
      <p style={{ color: "#666", fontSize: 12, margin: "6px 0" }}>Empty fields use the site&apos;s built-in text. The Stripe price id is used only when the matching STRIPE_PRICE_* setting isn&apos;t set in Vercel.</p>
      <SubmitButton className={kit.btn}>Save {PLAN_LABEL[plan.planId]}</SubmitButton>
    </form>
  );
}

export default async function SettingsPage() {
  const plans = await listPricingPlansForAdmin();
  const spots = await loadClubSetting<number>("max_casual_spots");
  const lock = await loadClubSetting<number>("booking_lock_days");
  return (
    <div className={adminStyles.page}>
      <PageHeader title="Pricing & settings" subtitle="Pricing plans and session settings. These used to be edited in Sanity; they now live here." />
      {!plans && <Notice>The settings tables haven&apos;t been created on this database yet (migration 0002). Until then the site keeps reading these values from Sanity.</Notice>}
      {plans && (
        <>
          <Section title="Session settings">
            <form action={saveSettings} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
              <label>Players per session (casual spots = this minus members)<input name="maxCasualSpots" inputMode="numeric" defaultValue={spots.value ?? ""} placeholder={String(SESSION_CAPACITY)} style={input} /></label>
              <label>Booking lock (days)<input name="bookingLockDays" inputMode="numeric" defaultValue={lock.value ?? ""} style={input} /></label>
              <SubmitButton className={kit.btn}>Save settings</SubmitButton>
            </form>
          </Section>
          <Section title="Pricing plans">
            <div>{plans.map((p) => <PlanForm key={p.planId} plan={p} />)}</div>
          </Section>
        </>
      )}
    </div>
  );
}
