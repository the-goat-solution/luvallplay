import { redirect } from "next/navigation";

// The Arena lives in the profile now (a tab beside Player); old links land there.
export default function ChallengesPage() {
  redirect("/profile/arena");
}
