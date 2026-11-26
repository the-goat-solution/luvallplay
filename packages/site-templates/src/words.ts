// The templates' own words (everything else is the club's content), in both
// of the platform's languages. Free-play clubs get their own call to action
// (build plan §7.3).
import type { SiteLang } from "./content.ts";

const en = {
  skip: "Skip to content",
  about: "About us",
  schedule: "When and where",
  nextDays: "Coming up",
  spotsLeft: (n: number) => (n === 1 ? "1 spot left" : `${n} spots left`),
  full: "Full",
  map: "Open the map",
  prices: "Prices",
  popular: "Most popular",
  freeTitle: "Free to play: just turn up",
  freeBody: "There's nothing to pay. Sign up for a play day so we know you're coming.",
  offlineNote: "Pay by cash or bank transfer.",
  gallery: "Gallery",
  reviews: "What players say",
  faq: "Questions",
  contact: "Get in touch",
  join: "Join in the app",
  book: "Book a casual session",
  signUp: "Sign up for a play day",
  getApp: "Get the app",
  onLuvallplay: "on Luvallplay",
  language: "Language",
};

const vi: typeof en = {
  skip: "Tới nội dung chính",
  about: "Về chúng tôi",
  schedule: "Thời gian và địa điểm",
  nextDays: "Sắp tới",
  spotsLeft: (n: number) => `Còn ${n} chỗ`,
  full: "Hết chỗ",
  map: "Mở bản đồ",
  prices: "Giá",
  popular: "Được chọn nhiều nhất",
  freeTitle: "Chơi miễn phí: cứ đến là chơi",
  freeBody: "Không mất phí. Hãy đăng ký buổi chơi để chúng tôi biết bạn sẽ đến.",
  offlineNote: "Thanh toán bằng tiền mặt hoặc chuyển khoản.",
  gallery: "Hình ảnh",
  reviews: "Người chơi nói gì",
  faq: "Câu hỏi thường gặp",
  contact: "Liên hệ",
  join: "Tham gia trong ứng dụng",
  book: "Đặt một buổi chơi lẻ",
  signUp: "Đăng ký buổi chơi",
  getApp: "Tải ứng dụng",
  onLuvallplay: "trên Luvallplay",
  language: "Ngôn ngữ",
};

export type Words = typeof en;
export const WORDS: Record<SiteLang, Words> = { en, vi };
