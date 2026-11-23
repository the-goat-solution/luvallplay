import { CLUB_TIME_ZONE } from "./constants";
import { sendAdminAlertEmail, sendPlayerNoticeEmail } from "./player-email";
import { cashOrdersExpiringSoon, markReminderSent, releaseExpiredHolds, type Order } from "./shop-db";
import { getPlayerByEmail } from "./player-db";
import { clubMoney } from "./money";

// Shop emails. Best effort: a failed email never undoes an order.

function money(cents: number): string {
  return clubMoney(cents);
}

function nzDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-NZ", { timeZone: CLUB_TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
}

async function langFor(email: string): Promise<"en" | "vi"> {
  return (await getPlayerByEmail(email).catch(() => null))?.lang ?? "en";
}

export async function notifyOrderPlaced(order: Order): Promise<void> {
  const items = order.items.map((i) => i.label).join(", ");
  const vi = (await langFor(order.email)) === "vi";
  const cash = order.method === "cash";
  await Promise.allSettled([
    sendPlayerNoticeEmail({
      to: order.email,
      subject: vi
        ? cash ? "Đã giữ hàng cho bạn: trả tiền mặt tại buổi chơi" : "Cảm ơn bạn! Đơn hàng đã thanh toán"
        : cash ? "Reserved: bring cash to your next play day" : "Thanks! Your order is paid",
      heading: vi ? (cash ? "Đã giữ hàng" : "Đã thanh toán") : cash ? "Reserved for you" : "Order paid",
      lines: vi
        ? [items, cash ? `Mang ${money(order.totalCents)} tiền mặt đến buổi chơi tiếp theo. Giữ đến ${nzDate(order.holdExpiresAt)}.` : "Nhận hàng tại buổi chơi tiếp theo của bạn."]
        : [items, cash ? `Bring ${money(order.totalCents)} cash to your next play day. Held until ${nzDate(order.holdExpiresAt)}.` : "Collect it at your next play day."],
      cta: { label: vi ? "Xem đơn hàng" : "View my order", path: "/profile#shop" },
    }),
    sendAdminAlertEmail({
      subject: `Shop ${cash ? "reservation (cash)" : "order (paid)"}: ${order.name || order.email}`,
      heading: cash ? "New cash reservation" : "New paid order",
      lines: [`${order.name || order.email} — ${items} — ${money(order.totalCents)}`, cash ? `Pay at the play day; held until ${nzDate(order.holdExpiresAt)}.` : "Paid by card. Hand it over at the next play day."],
      cta: { label: "Open shop orders", path: "/admin/shop" },
    }),
  ]);
}

export async function notifyOversold(order: Order): Promise<void> {
  await sendAdminAlertEmail({
    subject: `Shop: paid order #${order.id} but that size is out of stock`,
    heading: "A late payment found the size sold out",
    lines: [
      `${order.name || order.email} paid ${money(order.totalCents)} for ${order.items.map((i) => i.label).join(", ")} after their checkout hold had lapsed, and that size has since sold out.`,
      "Please contact them: swap the size or refund the payment from Stripe.",
    ],
    cta: { label: "Open shop orders", path: "/admin/shop" },
  }).catch((err) => console.error("[shop] oversold alert failed:", err));
}

/**
 * Daily (reminders cron): heads-up for cash reservations lapsing within a
 * day, then release anything already lapsed and tell those players.
 */
export async function runShopDailyUpkeep(): Promise<{ reminded: number; released: number }> {
  let reminded = 0;
  for (const o of await cashOrdersExpiringSoon()) {
    const vi = (await langFor(o.email)) === "vi";
    try {
      await sendPlayerNoticeEmail({
        to: o.email,
        subject: vi ? "Nhắc nhở: hàng bạn giữ sắp hết hạn" : "Reminder: your shop reservation ends soon",
        heading: vi ? "Đừng quên mang tiền mặt" : "Don't forget your cash",
        lines: vi
          ? [`${o.items.map((i) => i.label).join(", ")} — ${money(o.totalCents)}.`, `Hàng được giữ đến ${nzDate(o.holdExpiresAt)}. Sau đó sẽ được trả lại cho người khác.`]
          : [`${o.items.map((i) => i.label).join(", ")} — ${money(o.totalCents)}.`, `It's held until ${nzDate(o.holdExpiresAt)}, then it goes back on the shelf for someone else.`],
        cta: { label: vi ? "Xem đơn hàng" : "View my order", path: "/profile#shop" },
      });
      await markReminderSent(o.id);
      reminded++;
    } catch (err) {
      console.error("[shop] reminder failed", o.id, err);
    }
  }
  const released = await releaseExpiredHolds();
  for (const o of released) {
    const vi = (await langFor(o.email)) === "vi";
    await sendPlayerNoticeEmail({
      to: o.email,
      subject: vi ? "Hàng giữ đã được trả lại" : "Your shop reservation has ended",
      heading: vi ? "Đã hết thời gian giữ hàng" : "Reservation ended",
      lines: vi
        ? [`${o.items.map((i) => i.label).join(", ")} đã được trả lại kho. Bạn có thể đặt lại trong hồ sơ nếu vẫn còn hàng.`]
        : [`${o.items.map((i) => i.label).join(", ")} went back on the shelf. You can reserve it again from your profile while stock lasts.`],
      cta: { label: vi ? "Mở cửa hàng" : "Open the shop", path: "/profile#shop" },
    }).catch(() => {});
  }
  return { reminded, released: released.length };
}
