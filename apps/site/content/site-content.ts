// The seeded content of the public site, in English and Vietnamese.
//
// These documents are pushed to Sanity (scripts/seed-sanity.ts) and are also
// what the site shows when Sanity isn't configured. Only true, checkable
// facts: no invented members, clubs, quotes, rankings or prices. Anything not
// yet available says "coming soon".

import type { Club, HomePage, L, Page, SiteSettings, Sport } from "../lib/types.ts";

const l = (en: string, vi: string): L => ({ en, vi });

export const settings: SiteSettings = {
  _id: "siteSettings",
  _type: "siteSettings",
  launchMode: "coming-soon",
  searchIndexing: false,
  wizardUrl: "",
  appStoreUrl: "",
  playStoreUrl: "",
  bookingUrl: "",
  contactEmail: "support@thegoatsolution.com",
  companyName: "The GOAT Solution",
  // As published on thegoatsolution.com (read 24 Nov 2026).
  companyAddress: "No. 11, lane 17, Huong Vien street, Dong Mac ward, Hai Ba Trung district, Hanoi, Vietnam 10000",
};

export const sports: Sport[] = [
  ["badminton", "Badminton", "Cầu lông", "live"],
  ["pickleball", "Pickleball", "Pickleball", "soon"],
  ["tennis", "Tennis", "Quần vợt", "soon"],
  ["futsal", "Futsal", "Futsal", "soon"],
  ["netball", "Netball", "Bóng lưới", "soon"],
  ["volleyball", "Volleyball", "Bóng chuyền", "soon"],
  ["squash", "Squash", "Bóng quần", "soon"],
  ["table-tennis", "Table tennis", "Bóng bàn", "soon"],
].map(([key, en, vi, status], i) => ({
  _id: `sport.${key}`,
  _type: "sport" as const,
  key,
  name: l(en, vi),
  status: status as "live" | "soon",
  order: i + 1,
}));

export const clubs: Club[] = [
  {
    _id: "club.three-wolves",
    _type: "club",
    slug: "three-wolves",
    name: "Three Wolves Badminton Club",
    sportKey: "badminton",
    city: "Christchurch",
    country: "New Zealand",
    schedule: l("Wednesday and Friday evenings", "Tối thứ Tư và thứ Sáu"),
    audience: l("Social play", "Chơi giao lưu"),
    description: l(
      "The first club on Luvallplay. Social badminton twice a week in Christchurch.",
      "Câu lạc bộ đầu tiên trên Luvallplay. Cầu lông giao lưu hai buổi mỗi tuần tại Christchurch.",
    ),
    url: "https://threewolvesbadminton.org",
    logo: { url: "/clubs/three-wolves.png", alt: l("Three Wolves Badminton Club logo", "Logo Three Wolves Badminton Club") },
  },
];

export const home: HomePage = {
  _id: "homePage",
  _type: "homePage",
  seoTitle: l("Luvallplay: run your sports club in one app", "Luvallplay: quản lý câu lạc bộ thể thao trong một ứng dụng"),
  seoDescription: l(
    "Sign-ups, waitlists, memberships and fees for clubs that play every week, in your club’s own colours. Free for founding clubs and for players.",
    "Đăng ký, danh sách chờ, hội viên và thu phí cho các câu lạc bộ chơi hằng tuần, mang màu sắc riêng của câu lạc bộ. Miễn phí cho câu lạc bộ sáng lập và người chơi.",
  ),
  ticker: {
    label: l("On Luvallplay", "Trên Luvallplay"),
    linkLabel: l("Find a club", "Tìm câu lạc bộ"),
    items: [
      { _key: "t2", strong: l("Badminton", "Cầu lông"), rest: l("live now", "đã hoạt động") },
      { _key: "t3", strong: l("Pickleball, tennis, futsal and more", "Pickleball, quần vợt, futsal và nhiều môn khác"), rest: l("coming soon", "sắp ra mắt") },
      { _key: "t5", strong: l("Founding clubs", "Câu lạc bộ sáng lập"), rest: l("the waitlist is open", "đang mở danh sách chờ") },
    ],
  },
  hero: {
    badge: l("Founding clubs use Luvallplay free", "Câu lạc bộ sáng lập dùng Luvallplay miễn phí"),
    title: l("Less admin. More", "Bớt việc sổ sách. Thêm giờ"),
    titleAccent: l("play.", "ra sân."),
    lead: l(
      "Sign-ups, waitlists, memberships and fees for clubs that play every week. One place to run it all, in your club’s own name and colours.",
      "Đăng ký, danh sách chờ, hội viên và thu phí cho các câu lạc bộ chơi hằng tuần. Một nơi để lo mọi việc, mang tên và màu sắc của chính câu lạc bộ bạn.",
    ),
    primaryCta: l("Start your club", "Mở câu lạc bộ của bạn"),
    secondaryCta: l("Book a walkthrough", "Hẹn buổi giới thiệu"),
    playerLine: l("Looking for a game?", "Bạn đang tìm chỗ chơi?"),
    playerCta: l("Find a club near you", "Tìm câu lạc bộ gần bạn"),
    photos: [
      { _key: "p1", fallbackAlt: l("Illustration: a shuttle in flight", "Minh hoạ: quả cầu lông đang bay") },
      { _key: "p2", fallbackAlt: l("Illustration: a paddle and ball", "Minh hoạ: vợt và bóng") },
      { _key: "p3", fallbackAlt: l("Illustration: a ball over a net", "Minh hoạ: bóng bay qua lưới") },
      { _key: "p4", fallbackAlt: l("Illustration: a court seen from above", "Minh hoạ: sân nhìn từ trên xuống") },
    ],
    scoreLabel: l("Demo game", "Trận mẫu"),
    scoreCaption: l("You and a partner", "Bạn và đồng đội"),
    nextLabel: l("Friday social", "Giao lưu thứ Sáu"),
    nextTitle: l("Full", "Đã đủ người"),
    nextMeta: l("The waitlist moves up on its own", "Danh sách chờ tự đôn lên"),
    paidChip: l("Payment recorded", "Đã ghi nhận thanh toán"),
  },
  sports: {
    intro: l("Started with badminton. Open to every club that plays regularly.", "Bắt đầu từ cầu lông. Chào đón mọi câu lạc bộ chơi đều đặn."),
  },
  features: {
    title: l("Built for the people who run the club.", "Làm ra cho những người điều hành câu lạc bộ."),
    lead: l(
      "Fewer spreadsheets, fewer reminders in the group chat, less chasing payments. Switch on what your club needs.",
      "Bớt bảng tính, bớt nhắc nhở trong nhóm chat, bớt đi đòi tiền. Bật đúng những gì câu lạc bộ cần.",
    ),
    items: [
      {
        key: "sessions",
        status: "live",
        title: l("Sessions that fill themselves", "Buổi chơi tự kín chỗ"),
        body: l(
          "Set the spots once. Members sign up, the waitlist moves up when someone can’t make it, and you know who’s coming.",
          "Đặt số chỗ một lần. Hội viên tự đăng ký, danh sách chờ tự đôn lên khi có người báo bận, và bạn biết ai sẽ đến.",
        ),
      },
      {
        key: "fees",
        status: "live",
        title: l("Fees, your way", "Thu phí theo cách của bạn"),
        body: l(
          "Free play, cash or bank transfer, or online payments to your club’s own Stripe account. You can change it later.",
          "Chơi miễn phí, tiền mặt hoặc chuyển khoản, hay thanh toán trực tuyến vào tài khoản Stripe riêng của câu lạc bộ. Sau này vẫn đổi được.",
        ),
      },
      {
        key: "memberships",
        status: "live",
        title: l("Memberships, no chasing", "Hội viên, không phải đi nhắc"),
        body: l(
          "Members join and renew in the app. Renewals are reminded for you, and you see who has paid at a glance.",
          "Hội viên tham gia và gia hạn ngay trong ứng dụng. Việc gia hạn được nhắc thay bạn, và bạn biết ngay ai đã đóng.",
        ),
      },
      {
        key: "brand",
        status: "live",
        title: l("Your club’s name, not ours", "Tên câu lạc bộ, không phải tên chúng tôi"),
        body: l(
          "Your name, logo and words lead. Pick a tested colour scheme or bring your own, checked for contrast in light and dark.",
          "Tên, logo và cách gọi của bạn luôn đứng trước. Chọn một bộ màu đã kiểm thử hoặc dùng màu riêng, được kiểm tra độ tương phản cả giao diện sáng lẫn tối.",
        ),
      },
      {
        key: "admin",
        status: "live",
        title: l("One admin area", "Một khu quản trị"),
        body: l(
          "Sessions, members, payments and messages for everyone who helps run the club, in English and Vietnamese.",
          "Lịch chơi, hội viên, thanh toán và tin nhắn cho mọi người cùng điều hành câu lạc bộ, bằng tiếng Việt và tiếng Anh.",
        ),
      },
      {
        key: "modules",
        status: "live",
        title: l("Add what you need", "Thêm thứ bạn cần"),
        body: l(
          "Sessions, members and messages are always on. Switch on challenges, rankings or a shop when you’re ready.",
          "Lịch chơi, hội viên và tin nhắn luôn có sẵn. Bật thách đấu, xếp hạng hay cửa hàng khi bạn sẵn sàng.",
        ),
      },
    ],
    sessionRows: [
      { _key: "r1", name: l("Wed · Social play", "Thứ Tư · Chơi giao lưu"), meta: l("Evening · spots open", "Buổi tối · còn chỗ"), action: l("Open", "Còn chỗ") },
      { _key: "r2", name: l("Fri · Social play", "Thứ Sáu · Chơi giao lưu"), meta: l("Evening · waitlist on", "Buổi tối · có danh sách chờ"), action: l("Full", "Đã đủ") },
    ],
    feeModes: [
      l("Free play", "Chơi miễn phí"),
      l("Cash or bank transfer", "Tiền mặt hoặc chuyển khoản"),
      l("Online, through Stripe", "Trực tuyến qua Stripe"),
    ],
    schemesCaption: l("12 tested colour schemes", "12 bộ màu đã kiểm thử"),
  },
  vision: {
    eyebrow: l("Luvallplay Vision", "Luvallplay Vision"),
    title: l("Film your game. See every rally.", "Quay trận đấu. Xem lại từng pha bóng."),
    lead: l(
      "Prop your phone behind the court and play. Vision tracks every shot, trims the waiting, and hands you stats and highlights.",
      "Dựng điện thoại sau sân rồi cứ chơi. Vision theo dõi từng cú đánh, cắt bỏ thời gian chờ, rồi gửi bạn số liệu và những pha hay.",
    ),
    primaryCta: l("Read about Vision", "Tìm hiểu Vision"),
    secondaryCta: l("See how it works", "Xem cách hoạt động"),
    note: l(
      "Vision works for badminton today, at the first club on Luvallplay. More sports and clubs are coming soon.",
      "Hiện Vision dùng cho cầu lông, tại câu lạc bộ đầu tiên trên Luvallplay. Các môn và câu lạc bộ khác sắp có.",
    ),
    figureCaption: l("Illustration: a sample analysis, not a real game", "Minh hoạ: bản phân tích mẫu, không phải trận đấu thật"),
    benefits: [
      { _key: "b1", title: l("One phone, no kit", "Một chiếc điện thoại, không cần thiết bị"), body: l("Film in the app or upload a video you already have.", "Quay ngay trong ứng dụng hoặc tải lên video bạn đã có.") },
      { _key: "b2", title: l("Every shot tracked", "Theo dõi từng cú đánh"), body: l("Shot types, placement and rally length, player by player.", "Loại cú đánh, điểm rơi và độ dài pha bóng của từng người chơi.") },
      { _key: "b3", title: l("Rallies, no waiting", "Chỉ còn pha bóng"), body: l("The breaks between points are cut for you.", "Thời gian nghỉ giữa các điểm được cắt sẵn cho bạn.") },
      { _key: "b4", title: l("Highlights to keep", "Giữ lại pha hay"), body: l("Your best points, ready to watch again and share.", "Những điểm đẹp nhất, sẵn sàng để xem lại và chia sẻ.") },
    ],
  },
  how: {
    eyebrow: l("For your members", "Cho hội viên của bạn"),
    title: l("An app members open every week.", "Ứng dụng hội viên mở mỗi tuần."),
    lead: l(
      "Players use Luvallplay free. They see the next game, book a spot and follow their ranking, so you answer fewer messages.",
      "Người chơi dùng Luvallplay miễn phí. Họ xem buổi chơi tới, giữ chỗ và theo dõi thứ hạng, nên bạn bớt phải trả lời tin nhắn.",
    ),
    steps: [
      { _key: "s1", title: l("Book in two taps", "Giữ chỗ với hai lần chạm"), body: l("Grab a spot, join the waitlist or say they can’t make it.", "Giữ chỗ, vào danh sách chờ hoặc báo không đến được.") },
      { _key: "s2", title: l("Play, score, climb", "Chơi, ghi điểm, leo hạng"), body: l("A ladder per club and per sport, and challenges in the Arena.", "Bảng xếp hạng theo từng câu lạc bộ và từng môn, cùng thách đấu trong Arena.") },
      { _key: "s3", title: l("Bring new players in", "Đón thêm người chơi mới"), body: l("Your club can appear in the club finder, so new players can try a casual session.", "Câu lạc bộ có thể xuất hiện trong mục tìm câu lạc bộ, để người mới chơi thử một buổi.") },
    ],
    storeNote: l(
      "The store apps are coming soon. Today Luvallplay runs in your phone’s browser.",
      "Ứng dụng trên các kho sắp ra mắt. Hiện Luvallplay chạy ngay trên trình duyệt điện thoại.",
    ),
  },
  rankings: {
    eyebrow: l("Rankings", "Xếp hạng"),
    title: l("Climb the ladder at your level.", "Leo hạng ở đúng trình độ của bạn."),
    lead: l(
      "Rankings are per club and per sport, so a beginner’s win counts as much as anyone’s.",
      "Xếp hạng tính theo từng câu lạc bộ và từng môn, nên chiến thắng của người mới cũng có giá trị như của bất kỳ ai.",
    ),
    note: l(
      "Illustration: how a club ladder looks. Real ladders belong to each club and its members.",
      "Minh hoạ: hình dáng một bảng xếp hạng. Bảng thật thuộc về từng câu lạc bộ và hội viên.",
    ),
    cta: l("How the ladder works", "Bảng xếp hạng hoạt động thế nào"),
  },
  finder: {
    title: l("Looking for a game?", "Bạn đang tìm chỗ chơi?"),
    lead: l("Pick a sport, type your city and try a casual session first.", "Chọn môn, nhập thành phố và chơi thử một buổi trước."),
  },
  story: {
    title: l(
      "Our first club is on court.",
      "Câu lạc bộ đầu tiên đã ra sân.",
    ),
    body: l(
      "Three Wolves Badminton Club is the first club that uses Luvallplay. The same tools are opening to every club that plays regularly.",
      "Three Wolves Badminton Club là câu lạc bộ đầu tiên dùng Luvallplay. Những công cụ ấy đang được mở cho mọi câu lạc bộ chơi đều đặn.",
    ),
    caption: l("Illustration. Real photos arrive with our founding clubs.", "Hình minh hoạ. Ảnh thật sẽ có cùng các câu lạc bộ sáng lập."),
  },
  clubs: {
    eyebrow: l("Founding clubs", "Câu lạc bộ sáng lập"),
    title: l("Start free as a founding club.", "Bắt đầu miễn phí cùng các câu lạc bộ sáng lập."),
    lead: l(
      "We’re inviting clubs from the waitlist in small groups, starting in New Zealand. Founding clubs get every tool at no charge, and notice before anything changes.",
      "Chúng tôi mời các câu lạc bộ từ danh sách chờ theo từng nhóm nhỏ, bắt đầu ở New Zealand. Câu lạc bộ sáng lập có đủ mọi công cụ mà không mất phí, và được báo trước khi có bất kỳ thay đổi nào.",
    ),
    primaryCta: l("Start your club", "Mở câu lạc bộ của bạn"),
    secondaryCta: l("Book a walkthrough", "Hẹn buổi giới thiệu"),
    steps: [
      { _key: "c1", title: l("Join the waitlist", "Vào danh sách chờ"), body: l("Tell us your sport, your city and how your club plays.", "Cho chúng tôi biết môn, thành phố và cách câu lạc bộ đang chơi.") },
      { _key: "c2", title: l("Set up together", "Cùng thiết lập"), body: l("Your colours, your sessions, and members moved across from spreadsheets and chats.", "Màu sắc, lịch chơi, và hội viên được chuyển sang từ bảng tính và nhóm chat.") },
      { _key: "c3", title: l("Run your first session", "Chạy buổi chơi đầu tiên"), body: l("Members sign up in the app. You watch the list fill.", "Hội viên đăng ký trong ứng dụng. Bạn chỉ việc xem danh sách kín dần.") },
    ],
  },
  pricing: {
    players: {
      eyebrow: l("For players", "Cho người chơi"),
      price: l("Free", "Miễn phí"),
      body: l("Find clubs, book sessions, track your games. Your club sets its own fees.", "Tìm câu lạc bộ, đặt buổi chơi, theo dõi các trận của bạn. Phí chơi do câu lạc bộ tự đặt."),
      cta: l("Get the app", "Tải ứng dụng"),
    },
    clubs: {
      eyebrow: l("For clubs", "Cho câu lạc bộ"),
      badge: l("Everything included", "Đã gồm mọi thứ"),
      price: l("Free for founding clubs", "Miễn phí cho câu lạc bộ sáng lập"),
      body: l("Every tool for your club, with members and organisers included.", "Mọi công cụ cho câu lạc bộ, đã gồm hội viên và người tổ chức."),
      note: l(
        "Paid plans come later. Clubs get notice before anything changes.",
        "Các gói trả phí sẽ có sau. Câu lạc bộ được báo trước khi có bất kỳ thay đổi nào.",
      ),
      cta: l("Start your club", "Mở câu lạc bộ của bạn"),
    },
  },
};

// --- Inner pages -------------------------------------------------------------

const page = (key: string, title: L, lead: L, seoDescription: L, sections: [L, L, L[]?, string?][]): Page => ({
  _id: `page.${key}`,
  _type: "page",
  key,
  title,
  lead,
  seoTitle: l(`${title.en} · Luvallplay`, `${title.vi} · Luvallplay`),
  seoDescription,
  sections: sections.map(([heading, body, bullets, art], i) => ({ _key: `s${i + 1}`, heading, body, ...(bullets ? { bullets } : {}), ...(art ? { art } : {}) })),
});

export const pages: Page[] = [
  page(
    "vision",
    l("Vision: film your game, see every rally", "Vision: quay trận đấu, xem lại từng pha bóng"),
    l(
      "Vision turns a phone video of your game into stats and highlights. It works for badminton today, at the first club on Luvallplay.",
      "Vision biến video quay bằng điện thoại thành số liệu và những pha bóng hay. Hiện Vision dùng cho cầu lông, tại câu lạc bộ đầu tiên trên Luvallplay.",
    ),
    l(
      "Luvallplay Vision analyses a phone video of your badminton game: players, shots, rallies and highlights. More sports are coming soon.",
      "Luvallplay Vision phân tích video cầu lông quay bằng điện thoại: người chơi, cú đánh, pha bóng và khoảnh khắc đẹp. Các môn khác sắp có.",
    ),
    [
      [
        l("How it works", "Cách hoạt động"),
        l(
          "You film from behind the court, or upload a video you already have. Vision finds the court lines, follows each player and the shuttle, and splits the video into rallies.",
          "Bạn quay từ phía sau sân, hoặc tải lên video đã có. Vision nhận ra vạch sân, theo dõi từng người chơi và quả cầu, rồi chia video thành từng pha bóng.",
        ),
        [
          l("Prop your phone behind the baseline, high enough to see the whole court.", "Dựng điện thoại sau vạch cuối sân, đủ cao để thấy trọn sân."),
          l("Play your game as usual.", "Chơi trận của bạn như bình thường."),
          l("Open the result: rallies without the waiting, shot counts, and your best points.", "Mở kết quả: các pha bóng đã bỏ thời gian chờ, số cú đánh và những điểm đẹp nhất."),
        ],
      ],
      [
        l("What you get", "Bạn nhận được gì"),
        l(
          "A clearer picture of how you play, without anyone keeping notes at the side of the court.",
          "Một cái nhìn rõ hơn về lối chơi của bạn mà không cần ai ngồi ghi chép bên sân.",
        ),
        [
          l("Shot types: clears, drops, smashes and net shots.", "Loại cú đánh: phông, bỏ nhỏ, đập và đánh lưới."),
          l("Where you played from on the court.", "Bạn đã đánh từ những vị trí nào trên sân."),
          l("Rally lengths, and the longest rally of the game.", "Độ dài các pha bóng và pha dài nhất trận."),
          l("Highlights you can watch again.", "Những pha hay để xem lại."),
        ],
      ],
      [
        l("Who can use it today", "Hiện ai dùng được"),
        l(
      "Vision is real and in use, but it is early. Today it analyses badminton only, and it is open to members of the first club on Luvallplay. Other sports and other clubs are coming soon. Leave your email and we’ll tell you when it opens up.",
      "Vision là thật và đang được dùng, nhưng mới ở giai đoạn đầu. Hiện Vision chỉ phân tích cầu lông và dành cho hội viên của câu lạc bộ đầu tiên trên Luvallplay. Các môn và câu lạc bộ khác sắp có. Để lại email, chúng tôi sẽ báo khi Vision mở rộng.",
    ),
      ],
      [
        l("Your video stays yours", "Video vẫn là của bạn"),
        l(
          "A video is analysed for the player who uploaded it. Luvallplay doesn’t use your game to advertise to you and doesn’t sell it to anyone.",
          "Video được phân tích cho chính người tải lên. Luvallplay không dùng trận đấu của bạn để quảng cáo và không bán cho ai.",
        ),
      ],
    ],
  ),
  page(
    "for-clubs",
    l("For clubs: less admin, more play", "Cho câu lạc bộ: bớt sổ sách, thêm giờ ra sân"),
    l(
      "Luvallplay is one place to run your club: sessions and waitlists, members, fees, messages and your own brand. These tools run every week at Three Wolves Badminton Club, our first club. Founding clubs use them free, and the waitlist is open.",
      "Luvallplay là một nơi để điều hành câu lạc bộ: buổi chơi và danh sách chờ, hội viên, thu phí, tin nhắn và thương hiệu riêng. Những công cụ này chạy hằng tuần tại Three Wolves Badminton Club, câu lạc bộ đầu tiên của chúng tôi. Câu lạc bộ sáng lập dùng miễn phí, và danh sách chờ đang mở.",
    ),
    l(
      "What Luvallplay does for club organisers: an admin home, sessions and waitlists, members and roles, three ways to handle fees, your own brand and modules.",
      "Luvallplay giúp gì cho người tổ chức: trang quản trị, buổi chơi và danh sách chờ, hội viên và vai trò, ba cách thu phí, thương hiệu riêng và mô-đun.",
    ),
    [
      [
        l("Your admin home", "Trang quản trị của bạn"),
        l(
          "The first page an organiser sees answers three questions: what’s next, what needs me, and what do I usually do.",
          "Trang đầu tiên người tổ chức nhìn thấy trả lời ba câu hỏi: buổi tới là gì, việc gì cần tôi, và tôi hay làm gì.",
        ),
        [
          l("Next play day: who’s signed up, spots left and the waitlist.", "Buổi chơi tới: ai đã đăng ký, còn bao nhiêu chỗ và danh sách chờ."),
          l("Needs attention: unread messages, failed payments, disputed scores, shop orders and photos to check.", "Cần xử lý: tin nhắn chưa đọc, thanh toán lỗi, tỉ số bị khiếu nại, đơn hàng và ảnh cần duyệt."),
          l("Quick actions: add a player to a day, add a member, message a player, record an expense.", "Lối tắt: thêm người chơi vào một buổi, thêm hội viên, nhắn cho người chơi, ghi một khoản chi."),
        ],
        "admin",
      ],
      [
        l("Sessions and sign-ups", "Buổi chơi và đăng ký"),
        l(
          "Set your regular days once. Capacity follows the courts you’ve booked, and the list looks after itself.",
          "Đặt lịch chơi cố định một lần. Số chỗ theo số sân bạn đã đặt, và danh sách tự vận hành.",
        ),
        [
          l("A waitlist that moves up when someone says they can’t make it.", "Danh sách chờ tự đôn lên khi có người báo không đến được."),
          l("Open or close sign-ups, pause a weekday, or add a one-off day.", "Mở hoặc đóng đăng ký, tạm dừng một ngày trong tuần, hoặc thêm một buổi riêng."),
          l("A roster for each day, with attendance.", "Danh sách từng buổi, kèm điểm danh."),
        ],
        "sessions",
      ],
      [
        l("Members and organisers", "Hội viên và người tổ chức"),
        l(
          "Your club decides who plays. Approve people who ask to join, keep details up to date, and message members from one inbox.",
          "Câu lạc bộ quyết định ai được chơi. Duyệt người xin tham gia, cập nhật thông tin, và nhắn cho hội viên từ một hộp thư.",
        ),
        [
          l("Each organiser sees what their role needs. A coach sees the play pages, not the money.", "Mỗi người tổ chức thấy đúng phần vai trò của mình. Huấn luyện viên thấy các trang buổi chơi, không thấy phần tiền."),
          l("Members sign in with an email code. No passwords to forget.", "Hội viên đăng nhập bằng mã gửi qua email. Không có mật khẩu để quên."),
        ],
        "members",
      ],
      [
        l("Three ways to handle fees", "Ba cách xử lý phí"),
        l(
          "When you set up your club you’ll choose how it charges. You can change your mind later.",
          "Khi lập câu lạc bộ, bạn sẽ chọn cách thu phí. Sau này vẫn đổi được.",
        ),
        [
          l("Free play: no prices anywhere. People just turn up.", "Chơi miễn phí: không có giá nào cả. Mọi người cứ đến chơi."),
          l("Cash or bank transfer: you record who has paid.", "Tiền mặt hoặc chuyển khoản: bạn ghi nhận ai đã đóng."),
          l("Online payments: for incorporated clubs with their own Stripe account. Planned for New Zealand and Australia first.", "Thanh toán trực tuyến: cho câu lạc bộ có tư cách pháp nhân và tài khoản Stripe riêng. Dự kiến mở trước ở New Zealand và Úc."),
        ],
        "fees",
      ],
      [
        l("Money, kept tidy", "Tiền bạc, gọn gàng"),
        l(
          "For clubs that charge, the treasurer gets a ledger instead of a spreadsheet. Your club’s money stays with your club.",
          "Với câu lạc bộ có thu phí, thủ quỹ có sổ thu chi thay cho bảng tính. Tiền của câu lạc bộ vẫn ở lại với câu lạc bộ.",
        ),
        [
          l("Income and expenses in one ledger, with receipts.", "Thu và chi trong một sổ, kèm biên lai."),
          l("Bank lines matched to payments.", "Các dòng sao kê ngân hàng được đối chiếu với khoản thanh toán."),
          l("A report ready for your annual meeting.", "Báo cáo sẵn sàng cho cuộc họp thường niên."),
        ],
        "money",
      ],
      [
        l("Make it yours", "Mang dấu ấn riêng"),
        l(
          "Your club’s name, logo and words lead. Pick one of 12 tested colour schemes, or bring your own logo, fonts and colours. Luvallplay checks the contrast so everyone can read it, in light and dark. Everything works in English and Vietnamese.",
          "Tên, logo và cách gọi của câu lạc bộ luôn đứng trước. Chọn một trong 12 bộ màu đã kiểm thử, hoặc dùng logo, phông chữ và màu riêng. Luvallplay kiểm tra độ tương phản để ai cũng đọc được, cả giao diện sáng lẫn tối. Mọi thứ đều có tiếng Việt và tiếng Anh.",
        ),
        undefined,
        "brand",
      ],
      [
        l("Add what you need", "Thêm thứ bạn cần"),
        l(
          "Play days, members, messages, a simple club page and settings are always included. Everything else is a module you switch on when your club is ready, and switching one off hides it without deleting anything.",
          "Buổi chơi, hội viên, tin nhắn, một trang câu lạc bộ đơn giản và phần cài đặt luôn có sẵn. Mọi thứ khác là mô-đun bạn bật khi câu lạc bộ sẵn sàng, và tắt một mô-đun chỉ ẩn nó đi chứ không xoá gì cả.",
        ),
        [
          l("For sessions: casual play, a court board and round robins.", "Cho buổi chơi: chơi lẻ, bảng xoay sân và thi đấu vòng tròn."),
          l("For money: memberships, payments to check, finance reports and a shop.", "Cho tài chính: hội viên trả phí, thanh toán cần kiểm tra, báo cáo tài chính và cửa hàng."),
          l("For players: the Arena with challenges and a ladder, and a photo gallery.", "Cho người chơi: Arena với thách đấu và bảng xếp hạng, cùng thư viện ảnh."),
        ],
        "modules",
      ],
      [
        l("Getting started", "Bắt đầu thế nào"),
        l(
          "Founding clubs set up with us. The plan is a short setup: your club and sport, your look, how you charge, which modules you want, then inviting your organisers and bringing your members across from a spreadsheet.",
          "Câu lạc bộ sáng lập được chúng tôi cùng thiết lập. Dự kiến việc thiết lập rất ngắn: câu lạc bộ và môn chơi, giao diện, cách thu phí, các mô-đun bạn muốn, rồi mời người tổ chức và chuyển hội viên sang từ bảng tính.",
        ),
        undefined,
        "start",
      ],
      [
        l("Where we are", "Chúng tôi đang ở đâu"),
        l(
          "Luvallplay isn’t open to new clubs yet. Join the waitlist and we’ll invite founding clubs in small groups, starting in New Zealand. Founding clubs use Luvallplay free. Paid plans come later, and you’ll get notice before anything changes.",
          "Luvallplay chưa mở cho câu lạc bộ mới. Hãy vào danh sách chờ, chúng tôi sẽ mời các câu lạc bộ sáng lập theo từng nhóm nhỏ, bắt đầu ở New Zealand. Câu lạc bộ sáng lập dùng Luvallplay miễn phí. Các gói trả phí sẽ có sau, và bạn được báo trước khi có thay đổi.",
        ),
        undefined,
        "where",
      ],
    ],
  ),
  page(
    "find-a-club",
    l("Find a club", "Tìm câu lạc bộ"),
    l(
      "Clubs on Luvallplay, by sport and city. The list is short today and grows as founding clubs join.",
      "Các câu lạc bộ trên Luvallplay theo môn và thành phố. Danh sách hôm nay còn ngắn và sẽ dài thêm khi các câu lạc bộ sáng lập tham gia.",
    ),
    l(
      "Find a sports club on Luvallplay by sport and city, and book a casual session before you join.",
      "Tìm câu lạc bộ thể thao trên Luvallplay theo môn và thành phố, rồi đặt một buổi chơi thử trước khi tham gia.",
    ),
    [
      [
        l("Don’t see your club?", "Chưa thấy câu lạc bộ của bạn?"),
        l(
          "Tell us about a club you’d like to see here. We’ll get in touch with the organiser, and we won’t list any club without its say-so.",
          "Hãy cho chúng tôi biết câu lạc bộ bạn muốn thấy ở đây. Chúng tôi sẽ liên hệ người tổ chức, và không đưa câu lạc bộ nào lên khi chưa được đồng ý.",
        ),
      ],
    ],
  ),
  page(
    "pricing",
    l("Pricing", "Chi phí"),
    l(
      "Players use Luvallplay free. Founding clubs use it free too. There are no price lists to compare.",
      "Người chơi dùng Luvallplay miễn phí. Câu lạc bộ sáng lập cũng vậy. Không có bảng giá nào để so sánh.",
    ),
    l(
      "Luvallplay is free for players and free for founding clubs. Paid plans come later, with notice before any change.",
      "Luvallplay miễn phí cho người chơi và cho câu lạc bộ sáng lập. Các gói trả phí sẽ có sau và được báo trước.",
    ),
    [
      [
        l("What “free for founding clubs” means", "“Miễn phí cho câu lạc bộ sáng lập” nghĩa là gì"),
        l(
          "Founding clubs are the first clubs we invite from the waitlist. They get every tool, with members and organisers included, at no charge. Paid plans will come later. Before anything changes for your club you’ll hear from us, with time to decide.",
          "Câu lạc bộ sáng lập là những câu lạc bộ đầu tiên được mời từ danh sách chờ. Họ có đủ mọi công cụ, gồm cả hội viên và người tổ chức, mà không mất phí. Các gói trả phí sẽ có sau. Trước khi có thay đổi nào với câu lạc bộ của bạn, chúng tôi sẽ báo và để bạn đủ thời gian quyết định.",
        ),
      ],
      [
        l("Your club’s own fees", "Phí riêng của câu lạc bộ"),
        l(
          "What your club charges its members is up to your club. Luvallplay doesn’t set it. If your club takes online payments, its payment provider charges its usual card fees.",
          "Câu lạc bộ thu của hội viên bao nhiêu là do câu lạc bộ quyết định, Luvallplay không đặt mức phí đó. Nếu câu lạc bộ nhận thanh toán trực tuyến, đơn vị thanh toán sẽ tính phí thẻ thông thường của họ.",
        ),
      ],
      [
        l("Clubs that play for free", "Câu lạc bộ chơi miễn phí"),
        l(
          "Some clubs never charge anything. In free-play mode there isn’t a single price on screen, and no payment account is needed.",
          "Có những câu lạc bộ không thu đồng nào. Ở chế độ chơi miễn phí, màn hình không hiện bất kỳ giá nào và cũng không cần tài khoản thanh toán.",
        ),
      ],
    ],
  ),
  page(
    "about",
    l("About Luvallplay", "Về Luvallplay"),
    l(
      "“Love all, play.” is the call that starts a game. Everyone equal at 0–0, everyone welcome.",
      "“Love all, play.” là tiếng hô mở đầu một trận đấu: 0–0, bắt đầu. Ai cũng ngang nhau, ai cũng được chào đón.",
    ),
    l(
      "Luvallplay is a platform for sports clubs and their players: sessions, sign-ups, memberships, challenges and rankings, in English and Vietnamese.",
      "Luvallplay là nền tảng cho câu lạc bộ thể thao và người chơi: lịch chơi, đăng ký, hội viên, thách đấu và xếp hạng, bằng tiếng Việt và tiếng Anh.",
    ),
    [
      [
        l(
      "What it does",
      "Luvallplay làm gì",
    ),
        l(
      "Luvallplay answers the weekly question every organiser knows: who’s in, who has paid, and who’s on which court. Players book a spot, clubs fill their sessions, and everyone keeps score.",
      "Luvallplay trả lời câu hỏi hằng tuần mà người tổ chức nào cũng quen: ai đi, ai đã đóng tiền, ai đánh sân nào. Người chơi giữ chỗ, câu lạc bộ xếp đủ người, và ai cũng ghi được điểm.",
    ),
      ],
      [
        l("Where it’s going", "Hướng đi"),
        l(
          "The same tools suit any club that plays regularly, whatever the sport. Badminton is live. Pickleball, tennis, futsal, netball, volleyball, squash and table tennis are coming soon, along with store apps, social features and a marketplace.",
          "Những công cụ ấy hợp với mọi câu lạc bộ chơi đều đặn, bất kể môn nào. Cầu lông đã hoạt động. Pickleball, quần vợt, futsal, bóng lưới, bóng chuyền, bóng quần và bóng bàn sắp có, cùng với ứng dụng trên các kho, tính năng kết nối và chợ đồ thể thao.",
        ),
      ],
      [
        l("What we care about", "Điều chúng tôi coi trọng"),
        l("A few promises we build by.", "Vài lời hứa chúng tôi theo khi xây dựng."),
        [
          l("Your club comes first: its name, colours and words lead.", "Câu lạc bộ đứng trước: tên, màu sắc và cách gọi của câu lạc bộ luôn dẫn đầu."),
          l("Everyone is welcome, at every level.", "Ai cũng được chào đón, ở mọi trình độ."),
          l("English and Vietnamese, written with the same care.", "Tiếng Việt và tiếng Anh được viết kỹ lưỡng như nhau."),
          l("No tracking cookies and no ads on this site.", "Trang này không có cookie theo dõi và không có quảng cáo."),
        ],
      ],
      [
        l("Who’s behind it", "Ai đứng sau"),
        l(
      "Luvallplay is a product of The GOAT Solution. Its first club is Three Wolves Badminton Club.",
      "Luvallplay là sản phẩm của The GOAT Solution. Câu lạc bộ đầu tiên là Three Wolves Badminton Club.",
    ),
      ],
    ],
  ),
  page(
    "help",
    l("Help centre", "Trung tâm trợ giúp"),
    l(
      "Short, practical guides for organisers and players.",
      "Những hướng dẫn ngắn gọn, thiết thực cho người tổ chức và người chơi.",
    ),
    l(
      "Guides for club organisers and players on Luvallplay: starting a club, running sessions, bookings, challenges, Vision and privacy.",
      "Hướng dẫn cho người tổ chức và người chơi trên Luvallplay: lập câu lạc bộ, tổ chức buổi chơi, đặt chỗ, thách đấu, Vision và quyền riêng tư.",
    ),
    [],
  ),
  page(
    "contact",
    l("Contact us", "Liên hệ"),
    l(
      "A question, an idea or a problem with this site? Write to us. A person reads every message.",
      "Bạn có câu hỏi, ý tưởng hay gặp trục trặc với trang này? Hãy viết cho chúng tôi. Mọi tin nhắn đều có người đọc.",
    ),
    l("Get in touch with the Luvallplay team: questions, ideas, or a problem with this site.", "Liên hệ với đội ngũ Luvallplay: câu hỏi, ý tưởng hoặc trục trặc với trang này."),
    [],
  ),
  page(
    "waitlist",
    l("Start your club", "Mở câu lạc bộ của bạn"),
    l(
      "Luvallplay opens to founding clubs in small groups. Join the waitlist and we’ll write when there’s a place for your club. Players are welcome too.",
      "Luvallplay mở cho các câu lạc bộ sáng lập theo từng nhóm nhỏ. Hãy vào danh sách chờ, chúng tôi sẽ viết cho bạn khi có chỗ cho câu lạc bộ. Người chơi cũng được chào đón.",
    ),
    l("Join the Luvallplay waitlist for founding clubs and players.", "Vào danh sách chờ của Luvallplay dành cho câu lạc bộ sáng lập và người chơi."),
    [],
  ),
  page(
    "walkthrough",
    l("Book a walkthrough", "Hẹn buổi giới thiệu"),
    l(
      "See Luvallplay with someone from the team, on a call, in English or Vietnamese. Tell us a little about your club and we’ll suggest a time.",
      "Xem Luvallplay cùng một thành viên trong đội qua cuộc gọi, bằng tiếng Việt hoặc tiếng Anh. Kể đôi chút về câu lạc bộ và chúng tôi sẽ đề xuất thời gian.",
    ),
    l("Ask for a walkthrough of Luvallplay for your club.", "Đăng ký một buổi giới thiệu Luvallplay cho câu lạc bộ của bạn."),
    [],
  ),
  page(
    "invite-a-club",
    l("Invite a club", "Mời một câu lạc bộ"),
    l(
      "Know a club that should be here? Tell us which one. We’ll contact the organiser and mention you only if you want us to.",
      "Bạn biết một câu lạc bộ nên có mặt ở đây? Hãy cho chúng tôi biết. Chúng tôi sẽ liên hệ người tổ chức và chỉ nhắc đến bạn nếu bạn muốn.",
    ),
    l("Suggest a sports club you would like to see on Luvallplay. We contact the organiser.", "Giới thiệu một câu lạc bộ thể thao bạn muốn thấy trên Luvallplay. Chúng tôi sẽ liên hệ người tổ chức."),
    [],
  ),
  page(
    "get-the-app",
    l("Get the app", "Tải ứng dụng"),
    l(
      "The App Store and Google Play apps are coming soon. Leave your email and we’ll tell you the day they’re out. Until then Luvallplay runs in your phone’s browser.",
      "Ứng dụng trên App Store và Google Play sắp ra mắt. Để lại email, chúng tôi sẽ báo ngay ngày phát hành. Trong lúc chờ, Luvallplay chạy trên trình duyệt điện thoại của bạn.",
    ),
    l("Be told when the Luvallplay apps reach the App Store and Google Play.", "Nhận tin khi ứng dụng Luvallplay có trên App Store và Google Play."),
    [],
  ),
];
