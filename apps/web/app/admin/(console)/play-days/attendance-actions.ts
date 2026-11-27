"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { recordAttendance, removeAttendance } from "@/lib/stats-db";
import { adminText } from "@/lib/admin-lang";

function back(date: string, message: string): never {
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&tab=attendance&toast=${encodeURIComponent(message)}`);
}

export async function markAttended(date: string, email: string) {
  const { t } = await adminText();
  await recordAttendance(date, [email], "admin");
  back(date, t("att_marked_played", { email }));
}

export async function markNotAttended(date: string, email: string) {
  const { t } = await adminText();
  await removeAttendance(date, email);
  back(date, t("att_removed", { email, date }));
}

export async function addAttendanceByEmail(date: string, formData: FormData) {
  const { t } = await adminText();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) back(date, t("att_bad_email"));
  await recordAttendance(date, [email], "admin");
  back(date, t("att_marked_played", { email }));
}
