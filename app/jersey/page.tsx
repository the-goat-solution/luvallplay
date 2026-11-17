import { redirect } from "next/navigation";

// The jersey drive is over: the public page is gone (registrations stay in
// Admin → Jersey). Old links land on the home page.
export default function JerseyPage() {
  redirect("/");
}
