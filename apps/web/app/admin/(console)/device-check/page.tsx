import { redirect } from "next/navigation";

// Moved: System check → This device.
export default function DeviceCheckMoved(): never {
  redirect("/admin/setup?tab=device");
}
