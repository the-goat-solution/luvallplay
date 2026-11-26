// The junior-safeguarding policy a club acknowledges before Juniors can be
// switched on (build plan §6.8: "the club acknowledges a junior-safeguarding
// policy when switching the module on").
//
// What is stored is the VERSION the owner acknowledged, who they are and
// when. Change the wording in a way that changes what a club commits to and
// the version changes with it: clubs that acknowledged an older version are
// asked again (the module stays on meanwhile).
//
// Not legal advice, and not claimed as reviewed: the wording is checked in
// the safeguarding review and with counsel before any real child's profile
// exists (Phase 3b runbook §4).

export const SAFEGUARDING_POLICY_VERSION = "2026-11b";

export type SafeguardingPoint = { id: string; en: string; vi: string };

export const SAFEGUARDING_POLICY: readonly SafeguardingPoint[] = [
  {
    id: "policy",
    en: "Our club has a written child-safeguarding policy, and a named person who is responsible for it and can be contacted by guardians.",
    vi: "Câu lạc bộ có chính sách bảo vệ trẻ em bằng văn bản và một người phụ trách có tên cụ thể mà phụ huynh có thể liên hệ.",
  },
  {
    id: "safety-checks",
    en: "Every coach and volunteer who works with juniors has a current safety check. We record it here before assigning them to juniors. Luvallplay records that a check exists and when it expires; it does not carry out or verify the check.",
    vi: "Mọi huấn luyện viên và tình nguyện viên làm việc với thiếu niên đều có kiểm tra an toàn còn hiệu lực. Chúng tôi ghi nhận tại đây trước khi phân công họ. Luvallplay chỉ ghi nhận việc kiểm tra và ngày hết hạn, không thực hiện hay xác minh việc kiểm tra.",
  },
  {
    id: "guardians-only",
    en: "A junior is managed only by their guardian. We don't ask a child for their own email, phone number or sign-in, and coaches don't message children directly: messages about a junior go to the guardian.",
    vi: "Thiếu niên chỉ do phụ huynh hoặc người giám hộ quản lý. Chúng tôi không yêu cầu trẻ cung cấp email, số điện thoại hay tài khoản riêng, và huấn luyện viên không nhắn tin trực tiếp cho trẻ: tin nhắn về trẻ được gửi cho phụ huynh.",
  },
  {
    id: "sensitive-information",
    en: "Medical notes and emergency contacts are used only to keep the child safe, and are seen only by the people who need them.",
    vi: "Ghi chú y tế và liên hệ khẩn cấp chỉ được dùng để giữ an toàn cho trẻ và chỉ những người cần biết mới được xem.",
  },
  {
    id: "consent",
    en: "We don't publish a junior's photo, video, name or results unless their guardian has agreed to it, and we stop when the guardian withdraws that agreement.",
    vi: "Chúng tôi không đăng ảnh, video, tên hay kết quả của thiếu niên nếu phụ huynh chưa đồng ý, và sẽ dừng khi phụ huynh rút lại sự đồng ý.",
  },
  {
    id: "concerns-and-data",
    en: "We tell guardians how to raise a concern, and we act on a guardian's request to see or export their child's information. When a guardian asks us to delete it, an owner or admin of our club confirms the request without delay, and then everything we hold about the child is deleted for good.",
    vi: "Chúng tôi cho phụ huynh biết cách nêu quan ngại, và thực hiện yêu cầu xem hoặc xuất thông tin của con em họ. Khi phụ huynh yêu cầu xoá, chủ hoặc quản trị viên câu lạc bộ sẽ xác nhận yêu cầu ngay, và sau đó mọi thông tin chúng tôi lưu về trẻ sẽ bị xoá vĩnh viễn.",
  },
];
