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
  contactEmail: "",
  companyName: "The GOAT Solution",
  companyAddress: "",
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
      "The club where Luvallplay started. Social badminton twice a week in Christchurch.",
      "Câu lạc bộ nơi Luvallplay bắt đầu. Cầu lông giao lưu hai buổi mỗi tuần tại Christchurch.",
    ),
    url: "https://threewolvesbadminton.org",
  },
];

export const home: HomePage = {
  _id: "homePage",
  _type: "homePage",
  seoTitle: l("Luvallplay: the app for sports clubs and their players", "Luvallplay: ứng dụng cho câu lạc bộ thể thao và người chơi"),
  seoDescription: l(
    "Sessions, sign-ups, memberships, challenges and rankings for clubs that play regularly. Started with badminton. Free for players, free for founding clubs.",
    "Lịch chơi, đăng ký, hội viên, thách đấu và bảng xếp hạng cho các câu lạc bộ chơi đều đặn. Bắt đầu từ cầu lông. Miễn phí cho người chơi và cho các câu lạc bộ sáng lập.",
  ),
  ticker: {
    label: l("On Luvallplay", "Trên Luvallplay"),
    linkLabel: l("Find a club", "Tìm câu lạc bộ"),
    items: [
      { _key: "t1", strong: l("Three Wolves Badminton Club", "Three Wolves Badminton Club"), rest: l("Christchurch · Wednesday and Friday evenings", "Christchurch · tối thứ Tư và thứ Sáu") },
      { _key: "t2", strong: l("Badminton", "Cầu lông"), rest: l("live now", "đã hoạt động") },
      { _key: "t3", strong: l("Pickleball, tennis, futsal and more", "Pickleball, quần vợt, futsal và nhiều môn khác"), rest: l("coming soon", "sắp ra mắt") },
      { _key: "t4", strong: l("English and Vietnamese", "Tiếng Việt và tiếng Anh"), rest: l("in every screen", "trên mọi màn hình") },
      { _key: "t5", strong: l("Founding clubs", "Câu lạc bộ sáng lập"), rest: l("the waitlist is open", "đang mở danh sách chờ") },
    ],
  },
  hero: {
    badge: l("Meet Vision: your game, on film, in numbers", "Làm quen với Vision: trận đấu của bạn qua video và con số"),
    title: l("Your club’s favourite night of the", "Buổi tối cả câu lạc bộ mong nhất trong"),
    titleAccent: l("week.", "tuần."),
    lead: l(
      "Luvallplay brings your sessions, sign-ups, ladder and the people you play with into one friendly app. Everyone starts at 0–0.",
      "Luvallplay gom lịch chơi, đăng ký, bảng xếp hạng và những người bạn chơi cùng vào một ứng dụng thân thiện. Ai cũng bắt đầu từ 0–0.",
    ),
    primaryCta: l("Find a club near you", "Tìm câu lạc bộ gần bạn"),
    secondaryCta: l("Bring your club", "Đưa câu lạc bộ của bạn lên"),
    photos: [
      { _key: "p1", fallbackAlt: l("Illustration: a shuttle in flight", "Minh hoạ: quả cầu lông đang bay") },
      { _key: "p2", fallbackAlt: l("Illustration: a paddle and ball", "Minh hoạ: vợt và bóng") },
      { _key: "p3", fallbackAlt: l("Illustration: a ball over a net", "Minh hoạ: bóng bay qua lưới") },
      { _key: "p4", fallbackAlt: l("Illustration: a court seen from above", "Minh hoạ: sân nhìn từ trên xuống") },
    ],
    scoreLabel: l("Demo game", "Trận mẫu"),
    scoreCaption: l("You and a partner", "Bạn và đồng đội"),
    nextLabel: l("Next play day", "Buổi chơi tới"),
    nextTitle: l("Friday social", "Giao lưu thứ Sáu"),
    nextMeta: l("Evening · You’re in", "Buổi tối · Bạn đã có chỗ"),
    kudos: l("A clubmate sent you kudos", "Một bạn chơi vừa gửi lời khen"),
  },
  sports: {
    intro: l("Started with badminton. Open to every club that plays regularly.", "Bắt đầu từ cầu lông. Chào đón mọi câu lạc bộ chơi đều đặn."),
  },
  features: {
    title: l("Everything in your kit bag.", "Đủ đồ trong túi của bạn."),
    lead: l(
      "Seven tools, one app, zero spreadsheets. Your club keeps its own colours and words.",
      "Bảy công cụ, một ứng dụng, không cần bảng tính. Câu lạc bộ giữ nguyên màu sắc và cách gọi riêng.",
    ),
    items: [
      { key: "sessions", status: "live", title: l("Sessions and sign-ups", "Lịch chơi và đăng ký"), body: l("Book a spot in two taps. Waitlists move up on their own.", "Giữ chỗ chỉ với hai lần chạm. Danh sách chờ tự động đôn lên.") },
      { key: "rankings", status: "live", title: l("Rankings", "Xếp hạng"), body: l("A fair ladder for every level, updated after each game.", "Bảng xếp hạng công bằng cho mọi trình độ, cập nhật sau mỗi trận.") },
      { key: "challenges", status: "live", title: l("Challenges", "Thách đấu"), body: l("Post one in the Arena and see who’s up for it.", "Đăng một lời thách đấu trong Arena và xem ai nhận lời.") },
      { key: "memberships", status: "live", title: l("Memberships", "Hội viên"), body: l("Fees paid, renewals reminded. Clubs that play for free never see a price.", "Phí đã đóng, gia hạn được nhắc. Câu lạc bộ chơi miễn phí thì không thấy giá nào cả.") },
      { key: "finder", status: "live", title: l("Club finder", "Tìm câu lạc bộ"), body: l("Clubs on Luvallplay, by sport and city. More join as we open up.", "Các câu lạc bộ trên Luvallplay theo môn và thành phố. Sẽ có thêm khi chúng tôi mở rộng.") },
      { key: "social", status: "soon", title: l("Social", "Kết nối"), body: l("Kudos, follows and the people you play with.", "Lời khen, theo dõi và những người bạn chơi cùng.") },
      { key: "marketplace", status: "soon", title: l("Marketplace", "Chợ đồ thể thao"), body: l("Swap rackets, sell shoes, buy club kit.", "Đổi vợt, bán giày, mua đồ câu lạc bộ.") },
    ],
    sessionRows: [
      { _key: "r1", name: l("Wed · Social play", "Thứ Tư · Chơi giao lưu"), meta: l("Evening · spots open", "Buổi tối · còn chỗ"), action: l("Book", "Giữ chỗ") },
      { _key: "r2", name: l("Fri · Social play", "Thứ Sáu · Chơi giao lưu"), meta: l("Evening · full", "Buổi tối · đã đầy"), action: l("Waitlist", "Vào danh sách chờ") },
    ],
    finderCta: l("Find a club", "Tìm câu lạc bộ"),
    mapChip: l("Three Wolves · Christchurch", "Three Wolves · Christchurch"),
  },
  vision: {
    eyebrow: l("Luvallplay Vision", "Luvallplay Vision"),
    title: l("Film your game. See every rally.", "Quay trận đấu. Xem lại từng pha bóng."),
    lead: l(
      "Prop your phone behind the court and play. Vision follows the players and the shots, cuts out the waiting between rallies, and gives you stats and highlights to look back on.",
      "Dựng điện thoại sau sân rồi cứ chơi. Vision theo dõi người chơi và từng cú đánh, cắt bỏ thời gian chờ giữa các pha bóng, rồi đưa cho bạn số liệu và những pha hay để xem lại.",
    ),
    primaryCta: l("Read about Vision", "Tìm hiểu Vision"),
    secondaryCta: l("See how it works", "Xem cách hoạt động"),
    note: l(
      "Vision works for badminton today and is open to Three Wolves members first. More sports and clubs are coming soon.",
      "Hiện Vision dùng cho cầu lông và mở trước cho hội viên Three Wolves. Các môn và câu lạc bộ khác sắp có.",
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
    title: l("From “who’s in?” to game on.", "Từ “ai đi không?” đến lúc vào sân."),
    steps: [
      { _key: "s1", title: l("Find your people", "Tìm đúng hội của bạn"), body: l("Search clubs by sport and city.", "Tìm câu lạc bộ theo môn và thành phố.") },
      { _key: "s2", title: l("Book a casual session", "Đặt một buổi chơi thử"), body: l("Try it once. Join when it feels like your place.", "Chơi thử một buổi. Thấy hợp thì tham gia.") },
      { _key: "s3", title: l("Play, score, cheer", "Chơi, ghi điểm, cổ vũ"), body: l("Log the score, climb the ladder, cheer each other on.", "Ghi lại tỉ số, leo bảng xếp hạng, cổ vũ nhau.") },
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
    title: l("Who’s playing this week?", "Tuần này ai ra sân?"),
    lead: l("Pick a sport, type your city. Try a casual session before you join.", "Chọn môn, nhập thành phố. Chơi thử một buổi trước khi tham gia."),
  },
  story: {
    title: l("Started at a club, for clubs.", "Bắt đầu từ một câu lạc bộ, dành cho các câu lạc bộ."),
    body: l(
      "Luvallplay grew out of the app that runs Three Wolves Badminton Club in Christchurch, New Zealand. Twice a week the club books courts, fills them and keeps score with it. Now we’re opening the same tools to every club that plays regularly.",
      "Luvallplay lớn lên từ ứng dụng đang vận hành Three Wolves Badminton Club ở Christchurch, New Zealand. Mỗi tuần hai buổi, câu lạc bộ dùng nó để đặt sân, xếp người và ghi điểm. Giờ chúng tôi mở những công cụ ấy cho mọi câu lạc bộ chơi đều đặn.",
    ),
    caption: l("Illustration. Real photos arrive with our founding clubs.", "Hình minh hoạ. Ảnh thật sẽ có cùng các câu lạc bộ sáng lập."),
  },
  clubs: {
    eyebrow: l("For club organisers", "Dành cho người tổ chức"),
    title: l("Bring your club. Keep your colours.", "Đưa câu lạc bộ lên. Giữ nguyên màu áo."),
    lead: l(
      "Your club’s name, logo and words lead inside the app. Luvallplay takes care of sign-ups, fees and the ladder, in English and Vietnamese.",
      "Tên, logo và cách gọi của câu lạc bộ luôn đứng trước trong ứng dụng. Luvallplay lo phần đăng ký, thu phí và bảng xếp hạng, bằng tiếng Việt và tiếng Anh.",
    ),
    primaryCta: l("Start your club", "Mở câu lạc bộ của bạn"),
    secondaryCta: l("Book a walkthrough", "Hẹn buổi giới thiệu"),
    stats: [
      { _key: "c1", value: l("1", "1"), label: l("Sport live, more coming", "Môn đã có, sắp thêm") },
      { _key: "c2", value: l("12", "12"), label: l("Club colour schemes", "Bộ màu cho câu lạc bộ") },
      { _key: "c3", value: l("2", "2"), label: l("Languages", "Ngôn ngữ") },
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

const page = (key: string, title: L, lead: L, seoDescription: L, sections: [L, L, L[]?][]): Page => ({
  _id: `page.${key}`,
  _type: "page",
  key,
  title,
  lead,
  seoTitle: l(`${title.en} · Luvallplay`, `${title.vi} · Luvallplay`),
  seoDescription,
  sections: sections.map(([heading, body, bullets], i) => ({ _key: `s${i + 1}`, heading, body, ...(bullets ? { bullets } : {}) })),
});

export const pages: Page[] = [
  page(
    "vision",
    l("Vision: film your game, see every rally", "Vision: quay trận đấu, xem lại từng pha bóng"),
    l(
      "Vision turns a phone video of your game into stats and highlights. It works for badminton today and is open to Three Wolves members first.",
      "Vision biến video quay bằng điện thoại thành số liệu và những pha bóng hay. Hiện Vision dùng cho cầu lông và mở trước cho hội viên Three Wolves.",
    ),
    l(
      "Luvallplay Vision analyses a phone video of your badminton game: players, shots, rallies and highlights. Open to Three Wolves members first.",
      "Luvallplay Vision phân tích video cầu lông quay bằng điện thoại: người chơi, cú đánh, pha bóng và khoảnh khắc đẹp. Mở trước cho hội viên Three Wolves.",
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
          "Vision is real and in use, but it is early. Today it analyses badminton only, and it is available to members of Three Wolves Badminton Club. Other sports and other clubs are coming soon. Leave your email and we’ll tell you when it opens up.",
          "Vision là thật và đang được dùng, nhưng mới ở giai đoạn đầu. Hiện Vision chỉ phân tích cầu lông và dành cho hội viên Three Wolves Badminton Club. Các môn và câu lạc bộ khác sắp có. Để lại email, chúng tôi sẽ báo khi Vision mở rộng.",
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
    l("For clubs: run your sessions, keep your colours", "Cho câu lạc bộ: lo buổi chơi, giữ màu áo"),
    l(
      "Luvallplay gives your club sign-ups, waitlists, memberships, challenges and a ladder in one place. It is free for founding clubs, and the waitlist is open.",
      "Luvallplay đem đăng ký, danh sách chờ, hội viên, thách đấu và bảng xếp hạng của câu lạc bộ về một nơi. Miễn phí cho các câu lạc bộ sáng lập, và danh sách chờ đang mở.",
    ),
    l(
      "What Luvallplay does for club organisers: sessions and sign-ups, memberships, three ways to handle fees, your own colours and brand, in English and Vietnamese.",
      "Luvallplay giúp gì cho người tổ chức: lịch chơi và đăng ký, hội viên, ba cách thu phí, màu sắc và thương hiệu riêng, bằng tiếng Việt và tiếng Anh.",
    ),
    [
      [
        l("What’s running today", "Những gì đang chạy"),
        l(
          "Three Wolves Badminton Club in Christchurch runs on Luvallplay twice a week. These tools are in daily use there.",
          "Three Wolves Badminton Club ở Christchurch dùng Luvallplay hai buổi mỗi tuần. Những công cụ sau đang được dùng hằng ngày ở đó.",
        ),
        [
          l("Sessions, sign-ups and waitlists that move up on their own.", "Lịch chơi, đăng ký và danh sách chờ tự đôn lên."),
          l("Memberships and casual sessions, paid online or recorded by hand.", "Hội viên và buổi chơi lẻ, trả trực tuyến hoặc ghi nhận thủ công."),
          l("Challenges in the Arena and a club ladder.", "Thách đấu trong Arena và bảng xếp hạng của câu lạc bộ."),
          l("An admin area for the people who run the club.", "Khu quản trị cho những người điều hành câu lạc bộ."),
        ],
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
      ],
      [
        l("Make it yours", "Mang dấu ấn riêng"),
        l(
          "Your club’s name, logo and words lead. Pick one of 12 tested colour schemes, or bring your own logo, fonts and colours. Luvallplay checks the contrast so everyone can read it, in light and dark.",
          "Tên, logo và cách gọi của câu lạc bộ luôn đứng trước. Chọn một trong 12 bộ màu đã kiểm thử, hoặc dùng logo, phông chữ và màu riêng. Luvallplay kiểm tra độ tương phản để ai cũng đọc được, cả giao diện sáng lẫn tối.",
        ),
      ],
      [
        l("Add what you need", "Thêm thứ bạn cần"),
        l(
          "Sessions, members and messages are always included. Everything else is a module you switch on when your club is ready for it: memberships, challenges and rankings, a shop, and more over time.",
          "Lịch chơi, hội viên và tin nhắn luôn có sẵn. Mọi thứ khác là mô-đun bạn bật khi câu lạc bộ sẵn sàng: hội viên trả phí, thách đấu và xếp hạng, cửa hàng, và thêm nữa theo thời gian.",
        ),
      ],
      [
        l("Where we are", "Chúng tôi đang ở đâu"),
        l(
          "Luvallplay isn’t open to new clubs yet. Join the waitlist and we’ll invite founding clubs in small groups, starting in New Zealand. Founding clubs use Luvallplay free. Paid plans come later, and you’ll get notice before anything changes.",
          "Luvallplay chưa mở cho câu lạc bộ mới. Hãy vào danh sách chờ, chúng tôi sẽ mời các câu lạc bộ sáng lập theo từng nhóm nhỏ, bắt đầu ở New Zealand. Câu lạc bộ sáng lập dùng Luvallplay miễn phí. Các gói trả phí sẽ có sau, và bạn được báo trước khi có thay đổi.",
        ),
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
      "Luvallplay is a platform for sports clubs and their players, started at Three Wolves Badminton Club in Christchurch, New Zealand.",
      "Luvallplay là nền tảng cho câu lạc bộ thể thao và người chơi, bắt đầu từ Three Wolves Badminton Club ở Christchurch, New Zealand.",
    ),
    [
      [
        l("Where it started", "Khởi đầu"),
        l(
          "Luvallplay began as the app behind Three Wolves Badminton Club, a social club that plays on Wednesday and Friday evenings in Christchurch. It handled the weekly question every organiser knows: who’s in, who has paid, and who’s on which court.",
          "Luvallplay khởi đầu là ứng dụng của Three Wolves Badminton Club, một câu lạc bộ giao lưu chơi vào tối thứ Tư và thứ Sáu ở Christchurch. Nó giải quyết câu hỏi hằng tuần mà người tổ chức nào cũng quen: ai đi, ai đã đóng tiền, ai đánh sân nào.",
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
          "Luvallplay is a product of The GOAT Solution. Three Wolves Badminton Club is its first club and keeps its own name and look.",
          "Luvallplay là sản phẩm của The GOAT Solution. Three Wolves Badminton Club là câu lạc bộ đầu tiên và vẫn giữ tên cùng diện mạo riêng.",
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
