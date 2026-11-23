import { redirect } from "next/navigation";

// The jersey drive is over, so its admin pages are hidden (no menu item, and
// old links land on the admin home). The registrations stay in the database
// and bank payments still match them. To bring the pages back, delete this
// file and add Jersey to components/admin/nav-config.ts.
export default function JerseyHidden(): never {
  redirect("/admin");
}
