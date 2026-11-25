// The players' app (apps/app): the frame, sign-in, navigation and settings.
// Sport-neutral on purpose: a club's own words ({pointsName}, {visionName})
// come from its terms and are filled by format() in ./format.ts.
// English is the source; Vietnamese must have every key (the type says so).
import type { Messages } from "./format.ts";

const en = {
  brand: "Luvallplay",
  on_luvallplay: "on Luvallplay",
  loading: "Loading…",
  retry: "Try again",
  offline: "You're offline. Check your connection and try again.",
  error_generic: "Something went wrong. Please try again.",

  signin_title: "Sign in",
  signin_lead: "Enter your email and we'll send you a 6-digit code.",
  signin_email: "Email",
  signin_send: "Send my code",
  signin_sending: "Sending…",
  signin_code_title: "Check your email",
  signin_code_lead: "We sent a 6-digit code to {email}.",
  signin_code: "6-digit code",
  signin_verify: "Sign in",
  signin_verifying: "Signing in…",
  signin_change_email: "Use a different email",
  signin_err_invalid_email: "That doesn't look like an email address.",
  signin_err_too_many: "Too many tries. Please wait a few minutes.",
  signin_err_code: "That code isn't right, or it has expired.",
  signin_err_captcha: "We couldn't confirm you're a person. Please try again.",
  signin_err_send: "We couldn't send the email. Please try again.",

  invite_joining: "You're joining {club}",
  invite_lead: "Sign in to open {club} in the app.",
  invite_not_found: "We can't find that club. Check the link, or sign in below.",

  nav_label: "Main",
  nav_me: "Me",
  nav_arena: "Arena",
  nav_vision: "{visionName}",
  nav_player: "Player",
  nav_leaderboard: "Leaderboard",
  nav_settings: "Settings",

  needs_details: "Add your name in Settings so your club knows who you are.",
  club_disabled: "Your access to {club} is switched off. Talk to the club's organisers.",
  coming_title: "This screen is on its way",
  coming_body: "It's being moved into the new app. Until then, use it on your club's website.",
  me_hello: "Hi {name}",
  me_club: "Your club",

  switch_club: "Switch club",
  switch_current: "Current club",
  your_clubs: "Your clubs",

  settings_title: "Settings",
  settings_language: "Language",
  settings_lang_en: "English",
  settings_lang_vi: "Tiếng Việt",
  settings_theme: "Appearance",
  settings_theme_system: "Match my device",
  settings_theme_light: "Light",
  settings_theme_dark: "Dark",
  settings_account: "Account",
  settings_signed_in_as: "Signed in as {email}",
  settings_sign_out: "Sign out",
  settings_sign_out_all: "Sign out everywhere",
  settings_sign_out_all_hint: "Ends your session on every phone, tablet and computer.",
  settings_club_admin: "Club admin",
  settings_club_admin_soon: "Opening the club's admin from the app is coming soon. For now, open it on the club's website.",
} as const;

export type AppKey = keyof typeof en;

const vi: Messages<AppKey> = {
  brand: "Luvallplay",
  on_luvallplay: "trên Luvallplay",
  loading: "Đang tải…",
  retry: "Thử lại",
  offline: "Bạn đang ngoại tuyến. Hãy kiểm tra kết nối rồi thử lại.",
  error_generic: "Đã có lỗi xảy ra. Vui lòng thử lại.",

  signin_title: "Đăng nhập",
  signin_lead: "Nhập email của bạn, chúng tôi sẽ gửi một mã 6 chữ số.",
  signin_email: "Email",
  signin_send: "Gửi mã cho tôi",
  signin_sending: "Đang gửi…",
  signin_code_title: "Kiểm tra email của bạn",
  signin_code_lead: "Chúng tôi đã gửi mã 6 chữ số tới {email}.",
  signin_code: "Mã 6 chữ số",
  signin_verify: "Đăng nhập",
  signin_verifying: "Đang đăng nhập…",
  signin_change_email: "Dùng email khác",
  signin_err_invalid_email: "Địa chỉ email này có vẻ chưa đúng.",
  signin_err_too_many: "Bạn đã thử quá nhiều lần. Vui lòng đợi vài phút.",
  signin_err_code: "Mã chưa đúng hoặc đã hết hạn.",
  signin_err_captcha: "Chúng tôi chưa xác nhận được bạn là người thật. Vui lòng thử lại.",
  signin_err_send: "Chúng tôi chưa gửi được email. Vui lòng thử lại.",

  invite_joining: "Bạn đang tham gia {club}",
  invite_lead: "Đăng nhập để mở {club} trong ứng dụng.",
  invite_not_found: "Không tìm thấy câu lạc bộ này. Hãy kiểm tra đường dẫn hoặc đăng nhập bên dưới.",

  nav_label: "Chính",
  nav_me: "Tôi",
  nav_arena: "Đấu trường",
  nav_vision: "{visionName}",
  nav_player: "Người chơi",
  nav_leaderboard: "Xếp hạng",
  nav_settings: "Cài đặt",

  needs_details: "Hãy thêm tên của bạn trong Cài đặt để câu lạc bộ biết bạn là ai.",
  club_disabled: "Quyền truy cập {club} của bạn đang tắt. Hãy liên hệ ban tổ chức câu lạc bộ.",
  coming_title: "Màn hình này sắp có",
  coming_body: "Màn hình đang được chuyển sang ứng dụng mới. Trong lúc chờ, hãy dùng trên trang web của câu lạc bộ.",
  me_hello: "Chào {name}",
  me_club: "Câu lạc bộ của bạn",

  switch_club: "Đổi câu lạc bộ",
  switch_current: "Câu lạc bộ hiện tại",
  your_clubs: "Câu lạc bộ của bạn",

  settings_title: "Cài đặt",
  settings_language: "Ngôn ngữ",
  settings_lang_en: "English",
  settings_lang_vi: "Tiếng Việt",
  settings_theme: "Giao diện",
  settings_theme_system: "Theo thiết bị",
  settings_theme_light: "Sáng",
  settings_theme_dark: "Tối",
  settings_account: "Tài khoản",
  settings_signed_in_as: "Đã đăng nhập bằng {email}",
  settings_sign_out: "Đăng xuất",
  settings_sign_out_all: "Đăng xuất mọi nơi",
  settings_sign_out_all_hint: "Kết thúc phiên đăng nhập trên mọi điện thoại, máy tính bảng và máy tính.",
  settings_club_admin: "Quản trị câu lạc bộ",
  settings_club_admin_soon: "Sắp có thể mở trang quản trị từ ứng dụng. Hiện tại, hãy mở trên trang web của câu lạc bộ.",
};

export const app = { en, vi };
