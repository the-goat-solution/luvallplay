import { useCallback } from "react";
import { useLanguage } from "@/context/LanguageContext";
import type { Lang } from "@/lib/i18n";

// Text for the /jersey page, kept apart from lib/i18n.ts so the jersey
// campaign can be removed in one go. Same {var} placeholder style as t().
const JERSEY_I18N = {
  en: {
    hero_label: "Official Club Jersey",
    hero_title: "Wear the pack",
    hero_sub: "Authentic Yonex, printed in Vietnam and shipped to Christchurch. Arriving around early November.",
    opens_in: "Registration opens in",
    days: "Days",
    hours: "Hours",
    mins: "Mins",
    secs: "Secs",
    opens_note:
      "Opens 1:30 AM, Friday 16 October and closes 11:59 PM, Wednesday 21 October (NZ time). First come, first served — the first 10 pay just $15.",
    closes_note: "Registration closes 11:59 PM, Wednesday 21 October (NZ time).",
    closed_msg: "Registration is now closed. Thank you!",
    closed_form: "Registration has closed — thank you to everyone who signed up!",
    spots_left: "{n} of 10 early-bird spots left at $15",
    spots_gone: "Early-bird spots are gone — jerseys are now $30",
    register_now: "Register now",

    jersey_label: "The Jersey",
    jersey_h: "Authentic Yonex",
    jersey_p:
      "Our official club jersey is made by Yonex, printed in Vietnam and shipped to New Zealand. Delivery is expected around early November. Jerseys will be handed out at a play day, to be announced.",
    price_li1: "**$15** for the first 10 registrations, **$30** after that",
    price_li2: "Optional name & number on the back for **+$5**",
    price_li3: "One jersey per person",
    design_alt: "Three Wolves club jersey design: Port Hills Dawn, Yonex edition",

    size_label: "Sizing",
    size_h: "Find your size",
    size_p: "Available sizes: {sizes}. Match your height and weight to the chart. Between sizes? Size up.",
    size_alt: "Jersey size chart",
    men: "Men",
    women: "Women",
    size: "Size",
    height: "Height",
    weight: "Weight",

    how_label: "How it works",
    how_h: "Three quick steps",
    step1_t: "Register",
    step1_d: "Fill in the form below. You'll get a personal 5-digit reference code.",
    step2_t: "Pay by bank transfer",
    step2_d: "Send the amount to the club account and put your code in the reference field.",
    step3_t: "We match it automatically",
    step3_d: "Your payment is matched by your code and you'll get a confirmation email.",
    bank_h: "Club bank account",
    acct_name: "Account name",
    acct_no: "Account number",
    reference: "Reference",
    copy: "Copy",
    copy_both: "Copy account name & number",
    copied: "Copied ✓",

    reg_label: "Registration",
    reg_h: "Get your jersey",
    not_open: "Registration isn't open yet — the form unlocks when the countdown ends.",
    first: "First name",
    last: "Last name",
    email: "Email",
    email_hint: "One jersey per person, one registration per email. Your reference code is sent here.",
    phone: "Phone",
    size_f: "Size",
    choose_size: "Choose a size",
    size_hint: "Check the size chart above. Between sizes? Size up.",
    add_print: "Add my name & number on the back ({price})",
    print_name: "Name on back",
    print_name_hint: "Up to {n} characters.",
    number: "Number",
    number_hint: "0–99.",
    consent:
      "I'll pay by bank transfer using my reference code. I understand any amount over the price goes to club funds and there are no refunds.",
    consent_hold: " My $15 spot is released if unpaid after 48 hours.",
    total: "Total to pay",
    submit: "Register & get my code",
    submitting: "Registering…",
    err_size: "Please choose your size.",
    err_print: "Add a print name and number, or untick the printing option.",
    err_consent: "Please tick the box to confirm you understand the payment rules.",
    err_generic: "Something went wrong. Please try again.",

    done_h: "You're registered! 🎉",
    done_p: "Transfer {price} to secure your jersey. We've also emailed these details.",
    code_lbl: "Your reference code",
    done_warn:
      "Please put {code} in the reference field of your bank transfer. It's how we match your payment to you automatically — without it we may not be able to find your transfer and you could lose your spot. Thank you! 🙏",
    done_hold: "Your $15 early-bird price is held until {deadline}. After that, an unpaid spot is released to the next person.",

    rules_label: "Good to know",
    rules_h: "The rules",
    r1: "First come, first served.",
    r1d: "One jersey per person; duplicate registrations are cancelled. Registration closes 11:59 PM, Wednesday 21 October (NZ time).",
    r2: "Always include your reference code",
    r2d: "when you pay. Without it we may not find your transfer and you could lose your spot.",
    r3: "Early-bird spots are held for 48 hours.",
    r3d: "If your payment hasn't arrived by then, the spot goes to the next person.",
    r4: "Paying more than the price?",
    r4d: "The difference goes to the club's funds — thank you! We can't offer refunds.",
    r5: "Pick-up",
    r5d: "is at a play day, which will be announced once the jerseys arrive.",

    sponsor_label: "Our sponsor",
    sponsor_p:
      "Proudly sponsored by House of Barber. Owner Jason Nguyen offers **10% off a haircut** to anyone wearing the Three Wolves jersey.",
    visit: "Visit House of Barber",
  },
  vi: {
    hero_label: "Áo Đấu Chính Thức Của CLB",
    hero_title: "Mặc áo đàn sói",
    hero_sub: "Yonex chính hãng, in tại Việt Nam và vận chuyển về Christchurch. Dự kiến về khoảng đầu tháng 11.",
    opens_in: "Đăng ký mở sau",
    days: "Ngày",
    hours: "Giờ",
    mins: "Phút",
    secs: "Giây",
    opens_note:
      "Mở lúc 1:30 sáng thứ Sáu 16/10 và đóng lúc 11:59 tối thứ Tư 21/10 (giờ NZ). Ai đăng ký trước được trước — 10 người đầu tiên chỉ trả $15.",
    closes_note: "Đăng ký đóng lúc 11:59 tối thứ Tư 21/10 (giờ NZ).",
    closed_msg: "Đã đóng đăng ký. Xin cảm ơn!",
    closed_form: "Đã đóng đăng ký — cảm ơn tất cả mọi người đã đăng ký!",
    spots_left: "Còn {n}/10 suất giá ưu đãi $15",
    spots_gone: "Đã hết suất ưu đãi — áo hiện có giá $30",
    register_now: "Đăng ký ngay",

    jersey_label: "Áo Đấu",
    jersey_h: "Yonex Chính Hãng",
    jersey_p:
      "Áo đấu chính thức của CLB do Yonex sản xuất, in tại Việt Nam và vận chuyển về New Zealand. Dự kiến nhận hàng khoảng đầu tháng 11. Áo sẽ được phát vào một buổi chơi, thời gian sẽ được thông báo sau.",
    price_li1: "**$15** cho 10 người đăng ký đầu tiên, sau đó **$30**",
    price_li2: "In tên & số sau lưng tuỳ chọn: thêm **+$5**",
    price_li3: "Mỗi người một áo",
    design_alt: "Thiết kế áo đấu Three Wolves: Port Hills Dawn, phiên bản Yonex",

    size_label: "Kích Cỡ",
    size_h: "Chọn size của bạn",
    size_p: "Các size: {sizes}. Đối chiếu chiều cao và cân nặng với bảng bên dưới. Nếu phân vân giữa hai size, hãy chọn size lớn hơn.",
    size_alt: "Bảng size áo đấu",
    men: "Nam",
    women: "Nữ",
    size: "Size",
    height: "Chiều cao",
    weight: "Cân nặng",

    how_label: "Cách thực hiện",
    how_h: "Ba bước đơn giản",
    step1_t: "Đăng ký",
    step1_d: "Điền vào biểu mẫu bên dưới. Bạn sẽ nhận được mã tham chiếu gồm 5 chữ số.",
    step2_t: "Chuyển khoản ngân hàng",
    step2_d: "Chuyển đúng số tiền vào tài khoản CLB và ghi mã của bạn vào ô nội dung (reference).",
    step3_t: "Hệ thống tự đối chiếu",
    step3_d: "Khoản thanh toán được đối chiếu tự động theo mã của bạn và bạn sẽ nhận email xác nhận.",
    bank_h: "Tài khoản ngân hàng CLB",
    acct_name: "Tên tài khoản",
    acct_no: "Số tài khoản",
    reference: "Nội dung (Reference)",
    copy: "Sao chép",
    copy_both: "Sao chép tên & số tài khoản",
    copied: "Đã chép ✓",

    reg_label: "Đăng Ký",
    reg_h: "Đặt áo của bạn",
    not_open: "Chưa mở đăng ký — biểu mẫu sẽ mở khi đồng hồ đếm ngược kết thúc.",
    first: "Tên",
    last: "Họ",
    email: "Email",
    email_hint: "Mỗi người một áo, mỗi email một lần đăng ký. Mã tham chiếu sẽ được gửi về email này.",
    phone: "Số điện thoại",
    size_f: "Size",
    choose_size: "Chọn size",
    size_hint: "Xem bảng size ở trên. Phân vân giữa hai size? Hãy chọn size lớn hơn.",
    add_print: "In tên & số của tôi sau lưng ({price})",
    print_name: "Tên in sau lưng",
    print_name_hint: "Tối đa {n} ký tự.",
    number: "Số áo",
    number_hint: "Từ 0–99.",
    consent:
      "Tôi sẽ chuyển khoản kèm mã tham chiếu của mình. Tôi hiểu rằng số tiền chuyển dư sẽ thuộc về quỹ CLB và không được hoàn lại.",
    consent_hold: " Suất $15 của tôi sẽ bị huỷ nếu chưa thanh toán sau 48 giờ.",
    total: "Tổng cần thanh toán",
    submit: "Đăng ký & nhận mã",
    submitting: "Đang đăng ký…",
    err_size: "Vui lòng chọn size.",
    err_print: "Hãy nhập tên và số cần in, hoặc bỏ chọn mục in tên.",
    err_consent: "Vui lòng tích vào ô xác nhận đã hiểu quy định thanh toán.",
    err_generic: "Đã có lỗi xảy ra. Vui lòng thử lại.",

    done_h: "Đăng ký thành công! 🎉",
    done_p: "Hãy chuyển khoản {price} để giữ áo của bạn. Chúng tôi cũng đã gửi thông tin này qua email.",
    code_lbl: "Mã tham chiếu của bạn",
    done_warn:
      "Vui lòng ghi {code} vào ô nội dung (reference) khi chuyển khoản. Nhờ mã này hệ thống mới tự đối chiếu được khoản thanh toán của bạn — nếu thiếu mã, chúng tôi có thể không tìm thấy giao dịch và bạn có thể mất suất. Cảm ơn bạn! 🙏",
    done_hold: "Giá ưu đãi $15 được giữ đến {deadline}. Sau đó, suất chưa thanh toán sẽ được chuyển cho người kế tiếp.",

    rules_label: "Cần lưu ý",
    rules_h: "Quy định",
    r1: "Ai đăng ký trước được trước.",
    r1d: "Mỗi người một áo; các đăng ký trùng lặp sẽ bị huỷ. Đăng ký đóng lúc 11:59 tối thứ Tư 21/10 (giờ NZ).",
    r2: "Luôn ghi mã tham chiếu",
    r2d: "khi chuyển khoản. Nếu thiếu mã, chúng tôi có thể không tìm thấy giao dịch và bạn có thể mất suất.",
    r3: "Suất ưu đãi được giữ trong 48 giờ.",
    r3d: "Nếu chưa nhận được thanh toán trong thời gian này, suất sẽ chuyển cho người kế tiếp.",
    r4: "Chuyển dư tiền?",
    r4d: "Phần chênh lệch sẽ thuộc về quỹ CLB — xin cảm ơn! Chúng tôi không hoàn tiền.",
    r5: "Nhận áo",
    r5d: "vào một buổi chơi, sẽ được thông báo khi áo về tới nơi.",

    sponsor_label: "Nhà tài trợ",
    sponsor_p:
      "Tự hào được tài trợ bởi House of Barber. Chủ tiệm Jason Nguyen **giảm 10% khi cắt tóc** cho bất kỳ ai mặc áo đấu Three Wolves.",
    visit: "Truy cập House of Barber",
  },
} as const;

export type JerseyKey = keyof (typeof JERSEY_I18N)["en"];

export function jt(lang: Lang, key: JerseyKey, vars?: Record<string, string | number>): string {
  let s: string = JERSEY_I18N[lang][key] ?? JERSEY_I18N.en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function useJerseyT() {
  const { lang } = useLanguage();
  const tr = useCallback((key: JerseyKey, vars?: Record<string, string | number>) => jt(lang, key, vars), [lang]);
  return { lang, tr };
}
