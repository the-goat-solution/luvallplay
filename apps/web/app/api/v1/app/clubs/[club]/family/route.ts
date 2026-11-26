import { appRoute } from "@/lib/app-api";
import { familyAdd, familyList } from "@/lib/juniors/app-family";

// A guardian's family in this club (module juniors): the caller's own
// children, and adding one. A child is a name and a birth year only.
const list = appRoute("family.list", ({ player, club }) => familyList(player, club));
const add = appRoute("family.add", ({ player, club, body }) => familyAdd(player, club, body));

export const GET = list.handle;
export const POST = add.handle;
export const OPTIONS = list.preflight;
