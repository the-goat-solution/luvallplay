import { redirect } from "next/navigation";

// The home-screen app opens here (manifest start_url); land on Membership.
export default async function ProfileIndex({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source } = await searchParams;
  redirect(source === "homescreen" ? "/profile/membership?source=homescreen" : "/profile/membership");
}
