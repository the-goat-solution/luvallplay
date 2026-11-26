// The two strings of the row that leads to Family from My profile, kept apart
// from the rest of the `juniors` namespace so My profile doesn't carry the
// whole dictionary for every member (the rest loads with the Family screen).
import type { Messages } from "./format.ts";

const en = {
  family_entry: "Family",
  family_entry_sub: "Add and manage your children at {club}",
} as const;

const vi: Messages<keyof typeof en> = {
  family_entry: "Gia đình",
  family_entry_sub: "Thêm và quản lý con của bạn tại {club}",
};

export const juniorsEntry = { en, vi };
