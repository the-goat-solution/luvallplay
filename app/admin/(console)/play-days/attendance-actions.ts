"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { recordAttendance, removeAttendance } from "@/lib/stats-db";

function back(date: string, message: string): never {
  revalidatePath("/admin/play-days");
  redirect(`/admin/play-days?date=${date}&toast=${encodeURIComponent(message)}#attendance`);
}

export async function markAttended(date: string, email: string) {
  await recordAttendance(date, [email], "admin");
  back(date, `${email} marked as played.`);
}

export async function markNotAttended(date: string, email: string) {
  await removeAttendance(date, email);
  back(date, `${email} removed from ${date}'s attendance.`);
}

export async function addAttendanceByEmail(date: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) back(date, "Enter a valid email.");
  await recordAttendance(date, [email], "admin");
  back(date, `${email} marked as played.`);
}
