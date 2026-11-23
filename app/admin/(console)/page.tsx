import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/admin-access";
import { adminPathAllowed } from "@/lib/admin-roles";

// Admin home: Play days, which every admin role (coaches too) can open.
export default async function AdminHome() {
  const ctx = await currentAdmin();
  if (ctx?.kind === "player" && !adminPathAllowed(ctx.access, "/admin/play-days")) redirect("/profile");
  redirect("/admin/play-days");
}
