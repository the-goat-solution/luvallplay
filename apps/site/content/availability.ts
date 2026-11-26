// What is available today: the one source of truth.
//
// Every "coming soon" badge and every sentence that says who can use a
// feature reads from here (or from the same document in Sanity, which wins).
// When a feature ships or changes, change its line here in the same pull
// request, then update the "Availability" document in the Studio.
//
//   live     open to everyone it is meant for
//   limited  real and in use, but only for some (say who in the note)
//   soon     not available yet
import type { Availability, AvailabilityItem, L } from "../lib/types.ts";

const l = (en: string, vi: string): L => ({ en, vi });
type Row = [key: string, group: AvailabilityItem["group"], status: AvailabilityItem["status"], name: L, note: L];

const FIRST_CLUB = l("In use at the first club on Luvallplay.", "Đang dùng tại câu lạc bộ đầu tiên trên Luvallplay.");
const WITH_CLUBS = l("Planned for when clubs can set themselves up.", "Dự kiến có khi các câu lạc bộ tự lập được trang của mình.");

const rows: Row[] = [
  // For players
  ["sessions", "players", "limited", l("Sessions, sign-ups and waitlists", "Lịch chơi, đăng ký và danh sách chờ"), FIRST_CLUB],
  ["memberships", "players", "limited", l("Memberships", "Hội viên"), FIRST_CLUB],
  ["challenges", "players", "limited", l("Challenges", "Thách đấu"), FIRST_CLUB],
  ["rankings", "players", "limited", l("Rankings", "Xếp hạng"), l("Badminton, at the first club on Luvallplay. Other sports are coming soon.", "Cầu lông, tại câu lạc bộ đầu tiên trên Luvallplay. Các môn khác sắp có.")],
  ["vision", "players", "limited", l("Vision", "Vision"), l("Vision works for badminton today, at the first club on Luvallplay. More sports and clubs are coming soon.", "Hiện Vision dùng cho cầu lông, tại câu lạc bộ đầu tiên trên Luvallplay. Các môn và câu lạc bộ khác sắp có.")],
  ["finder", "players", "limited", l("Club finder", "Tìm câu lạc bộ"), l("A short list for now. It grows as founding clubs join.", "Hiện danh sách còn ngắn và sẽ dài thêm khi các câu lạc bộ sáng lập tham gia.")],
  ["storeApps", "players", "soon", l("App Store and Google Play apps", "Ứng dụng trên App Store và Google Play"), l("The store apps are coming soon. Today Luvallplay runs in your phone’s browser.", "Ứng dụng trên các kho sắp ra mắt. Hiện Luvallplay chạy ngay trên trình duyệt điện thoại.")],
  ["social", "players", "soon", l("Social", "Kết nối"), l("Kudos and follows are coming soon.", "Lời khen và theo dõi sắp có.")],
  ["marketplace", "players", "soon", l("Marketplace", "Chợ đồ thể thao"), l("Buying, selling and swapping gear is coming soon.", "Mua, bán và trao đổi đồ sắp có.")],
  // For clubs
  ["newClubs", "clubs", "soon", l("Starting a new club", "Lập câu lạc bộ mới"), l("Not open yet. The waitlist is open, and founding clubs are invited in small groups.", "Chưa mở. Danh sách chờ đang mở, và các câu lạc bộ sáng lập được mời theo từng nhóm nhỏ.")],
  ["setupWizard", "clubs", "soon", l("Set-up in about 5 minutes", "Thiết lập trong khoảng 5 phút"), WITH_CLUBS],
  ["brand", "clubs", "limited", l("Your club’s own name, logo and colours", "Tên, logo và màu sắc riêng của câu lạc bộ"), l("The first club on Luvallplay keeps its own look. Choosing from 12 colour schemes or bringing your own brand comes with club set-up.", "Câu lạc bộ đầu tiên trên Luvallplay giữ diện mạo riêng. Việc chọn trong 12 bộ màu hoặc dùng thương hiệu riêng sẽ có cùng bước thiết lập câu lạc bộ.")],
  ["fees", "clubs", "limited", l("Fees: free play, cash or bank transfer, or online payments", "Thu phí: chơi miễn phí, tiền mặt hoặc chuyển khoản, hoặc thanh toán trực tuyến"), l("In use at the first club on Luvallplay. Choosing how your club charges comes with club set-up; online payments start in New Zealand and Australia.", "Đang dùng tại câu lạc bộ đầu tiên trên Luvallplay. Việc chọn cách thu phí sẽ có cùng bước thiết lập câu lạc bộ; thanh toán trực tuyến bắt đầu ở New Zealand và Úc.")],
  ["modules", "clubs", "limited", l("Modules you switch on", "Mô-đun bật khi cần"), l("In use at the first club on Luvallplay. Choosing your own modules comes with club set-up.", "Đang dùng tại câu lạc bộ đầu tiên trên Luvallplay. Việc tự chọn mô-đun sẽ có cùng bước thiết lập câu lạc bộ.")],
  ["admin", "clubs", "limited", l("Admin area for the people who run the club", "Khu quản trị cho người điều hành câu lạc bộ"), FIRST_CLUB],
  ["clubWebsites", "clubs", "soon", l("Club websites and your own domain", "Trang web câu lạc bộ và tên miền riêng"), WITH_CLUBS],
  ["juniors", "clubs", "soon", l("Junior accounts managed by a guardian", "Tài khoản thiếu niên do người giám hộ quản lý"), l("Coming soon.", "Sắp có.")],
  // The platform
  ["badminton", "platform", "live", l("Badminton", "Cầu lông"), l("The first sport on Luvallplay.", "Môn đầu tiên trên Luvallplay.")],
  ["otherSports", "platform", "soon", l("Pickleball, tennis, futsal, netball, volleyball, squash, table tennis", "Pickleball, quần vợt, futsal, bóng lưới, bóng chuyền, bóng quần, bóng bàn"), l("Coming soon.", "Sắp có.")],
  ["languages", "platform", "live", l("English and Vietnamese", "Tiếng Việt và tiếng Anh"), l("The players' app and website, in both languages. The club admin is in English for now.", "Ứng dụng cho người chơi và trang web, bằng cả hai ngôn ngữ. Trang quản trị câu lạc bộ hiện chỉ có tiếng Anh.")],
];

export const availability: Availability = {
  _id: "availability",
  _type: "availability",
  updated: "2026-11-26",
  items: rows.map(([key, group, status, name, note]) => ({ _key: key, key, group, status, name, note })),
};
