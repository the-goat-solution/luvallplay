// The club shop (the website's Me → Club shop).
import { z } from "zod";
import { clubParams } from "./clubs.ts";

export const variantSchema = z.object({
  id: z.number().int(),
  fit: z.enum(["men", "women", "unisex"]),
  size: z.string(),
  /** How many can still be bought (stock less reserved and sold). */
  available: z.number().int(),
});
export const productSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  kind: z.string(),
  nameEn: z.string(),
  nameVi: z.string(),
  descEn: z.string(),
  descVi: z.string(),
  /** Minor units of the club's currency. */
  priceCents: z.number().int(),
  images: z.array(z.string()),
  hasFit: z.boolean(),
  hasSizes: z.boolean(),
  sizeChartMen: z.string().nullable(),
  sizeChartWomen: z.string().nullable(),
  variants: z.array(variantSchema),
  available: z.number().int(),
});
export const ORDER_STATUSES = ["pending_payment", "reserved_cash", "paid", "collected", "cancelled", "expired", "refunded"] as const;
export const orderSchema = z.object({
  id: z.number().int(),
  status: z.enum(ORDER_STATUSES),
  method: z.enum(["card", "cash"]),
  totalCents: z.number().int(),
  /** A cash reservation is kept until then. */
  holdExpiresAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  collectedAt: z.string().nullable(),
  createdAt: z.string(),
  items: z.array(z.object({ label: z.string(), qty: z.number().int(), unitPriceCents: z.number().int() })),
});
export const shopResponse = z.object({
  products: z.array(productSchema),
  /** Reserved, paid and collected orders. */
  orders: z.array(orderSchema),
  /** Whether "reserve and pay cash" is offered (the club checks cash payments). */
  cash: z.boolean(),
});
export const shopOrderRequest = z.object({ variantId: z.number().int().positive().max(2147483647), method: z.enum(["card", "cash"]) });
export const shopOrderResponse = z.object({
  order: orderSchema,
  /** Card: confirm this payment in the browser with the card provider, then call confirm. */
  clientSecret: z.string().nullable(),
  /** Cash: the play day to bring it to. */
  playDay: z.string().nullable(),
});
export const orderParams = clubParams.extend({ id: z.coerce.number().int().positive().max(2147483647) });
export const orderResponse = z.object({ order: orderSchema });
