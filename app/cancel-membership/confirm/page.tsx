import { redirect } from "next/navigation";

// The emailed cancellation link is gone: members manage (and cancel) their
// membership from their profile. Old links in inboxes land there instead.
export default function OldCancelLink() {
  redirect("/login?next=/profile/membership");
}
