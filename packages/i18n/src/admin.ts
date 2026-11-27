// The club admin (build plan §6.2.4 layer 5, step A5). Its own namespace,
// owned by lane A, imported on its own ("@luvallplay/i18n/admin") like juniors,
// so the players' bundles don't carry it. English is the source; Vietnamese
// must have every key (the type says so). {var} placeholders are filled by
// format(). The Vietnamese is a first draft and needs a native review.
//
// Key shape: shell_*, nav_* (menu), common_* (words every page uses), then a
// prefix per page as pages are translated (play_*, people_*, ...).
import { format, type Lang, type Messages, type Vars } from "./format.ts";

const en = {
  // The frame
  shell_club_admin: "Club admin",
  shell_open_menu: "Open menu",
  shell_close_menu: "Close menu",
  shell_court_board: "Court board ↗",
  shell_my_profile: "My profile",
  shell_sign_in: "Sign in",
  // Menu groups and pages (the key is "nav_" + the English label, lower case, non-letters as _)
  nav_group_play: "Play",
  nav_group_people: "People",
  nav_group_money: "Money",
  nav_group_club: "Club",
  nav_today: "Today",
  nav_play_days: "Play days",
  nav_players: "Players",
  nav_inbox: "Inbox",
  nav_pricing_settings: "Pricing & settings",
  nav_admins: "Admins",
  nav_schedule: "Schedule",
  nav_members: "Members",
  nav_bank: "Bank",
  nav_ledger: "Ledger",
  nav_annual_report: "Annual report",
  nav_shop: "Shop",
  nav_arena: "Arena",
  nav_photos: "Photos",
  nav_juniors: "Juniors",
  nav_platform_staff: "Platform staff",
  nav_system_check: "System check",
  // Words every page uses
  common_save: "Save",
  common_cancel: "Cancel",
  common_delete: "Delete",
  common_edit: "Edit",
  common_search: "Search",
  common_none: "None",
  common_yes: "Yes",
  common_no: "No",
  common_loading: "Loading…",
} as const;

const vi: Messages<keyof typeof en> = {
  shell_club_admin: "Quản trị câu lạc bộ",
  shell_open_menu: "Mở menu",
  shell_close_menu: "Đóng menu",
  shell_court_board: "Bảng sân ↗",
  shell_my_profile: "Hồ sơ của tôi",
  shell_sign_in: "Đăng nhập",
  nav_group_play: "Chơi",
  nav_group_people: "Mọi người",
  nav_group_money: "Tiền",
  nav_group_club: "Câu lạc bộ",
  nav_today: "Hôm nay",
  nav_play_days: "Ngày chơi",
  nav_players: "Người chơi",
  nav_inbox: "Hộp thư",
  nav_pricing_settings: "Giá và cài đặt",
  nav_admins: "Quản trị viên",
  nav_schedule: "Lịch",
  nav_members: "Hội viên",
  nav_bank: "Ngân hàng",
  nav_ledger: "Sổ cái",
  nav_annual_report: "Báo cáo năm",
  nav_shop: "Cửa hàng",
  nav_arena: "Đấu trường",
  nav_photos: "Hình ảnh",
  nav_juniors: "Thiếu niên",
  nav_platform_staff: "Nhân sự nền tảng",
  nav_system_check: "Kiểm tra hệ thống",
  common_save: "Lưu",
  common_cancel: "Hủy",
  common_delete: "Xóa",
  common_edit: "Sửa",
  common_search: "Tìm kiếm",
  common_none: "Không có",
  common_yes: "Có",
  common_no: "Không",
  common_loading: "Đang tải…",
};

export const admin = { en, vi };
export type AdminKey = keyof typeof en;

/** A message in `lang`, falling back to English, then to the key itself. */
export function at(lang: Lang, key: AdminKey, vars?: Vars): string {
  return format(admin[lang]?.[key] ?? admin.en[key] ?? key, vars, lang);
}

/** The menu key for a manifest label ("Pricing & settings" -> nav_pricing_settings). */
export function navKey(label: string, group = false): string {
  return `nav_${group ? "group_" : ""}${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

/** A menu label in `lang`; a label with no entry yet is shown as written. */
export function navLabel(lang: Lang, label: string, group = false): string {
  const key = navKey(label, group) as AdminKey;
  return key in admin.en ? at(lang, key) : label;
}
