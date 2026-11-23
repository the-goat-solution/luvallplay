import { redirect } from "next/navigation";

// Moved: weekday pauses and their waiting lists are on Play days → Schedule.
export default function DayRequestsMoved(): never {
  redirect("/admin/play-days/schedule");
}
