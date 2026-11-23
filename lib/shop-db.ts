import { db, sql } from "./database";
import { ensureTables, addDays } from "./db";
import { ensurePlayerTables } from "./player-db";
import { getClubToday } from "./dates";
import { onceThisDeploy } from "./schema-gate";

// Club shop: the jersey now, more merchandise later. Nothing here is
// jersey-specific: a product has a price, photos, optional men's/women's
// fits and sizes, and stock per fit × size.
//
// Stock accounting per variant:
//   stock    = units on hand that aren't sold yet
//   reserved = units held for a checkout in progress (card, 15 minutes) or a
//              "pay cash at a play day" reservation
//   available = stock − reserved
// Reserving is a single conditional UPDATE, so two people can't both get the
// last shirt.

export const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"] as const;
export const FITS = ["men", "women"] as const;
export type Fit = (typeof FITS)[number] | "unisex";
export const CARD_HOLD_MINUTES = 15;
export const CASH_HOLD_FALLBACK_DAYS = 14;

let ensurePromise: Promise<void> | null = null;

export function ensureShopTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = onceThisDeploy("shop", async () => {
      await ensureTables();
      await ensurePlayerTables();
      await sql`
        CREATE TABLE IF NOT EXISTS shop_products (
          id SERIAL PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL DEFAULT 'merch',
          name_en TEXT NOT NULL,
          name_vi TEXT NOT NULL DEFAULT '',
          desc_en TEXT NOT NULL DEFAULT '',
          desc_vi TEXT NOT NULL DEFAULT '',
          price_cents INT NOT NULL,
          images JSONB NOT NULL DEFAULT '[]'::jsonb,
          has_fit BOOLEAN NOT NULL DEFAULT TRUE,
          has_sizes BOOLEAN NOT NULL DEFAULT TRUE,
          size_chart_men TEXT,
          size_chart_women TEXT,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          sort INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS shop_variants (
          id SERIAL PRIMARY KEY,
          product_id INT NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
          fit TEXT NOT NULL,
          size TEXT NOT NULL,
          stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
          reserved INT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
          sold INT NOT NULL DEFAULT 0,
          UNIQUE (product_id, fit, size)
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS shop_orders (
          id SERIAL PRIMARY KEY,
          player_id INT REFERENCES players(id) ON DELETE SET NULL,
          email TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK (status IN ('pending_payment', 'reserved_cash', 'paid', 'collected', 'cancelled', 'expired', 'refunded')),
          payment_method TEXT NOT NULL CHECK (payment_method IN ('card', 'cash')),
          total_cents INT NOT NULL,
          stripe_payment_intent_id TEXT UNIQUE,
          cash_invoice_id TEXT,
          hold_expires_at TIMESTAMPTZ,
          reminder_sent_at TIMESTAMPTZ,
          paid_at TIMESTAMPTZ,
          collected_at TIMESTAMPTZ,
          cancelled_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS shop_order_items (
          id SERIAL PRIMARY KEY,
          order_id INT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
          product_id INT NOT NULL,
          variant_id INT NOT NULL,
          qty INT NOT NULL,
          unit_price_cents INT NOT NULL,
          label TEXT NOT NULL
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS shop_stock_log (
          id SERIAL PRIMARY KEY,
          variant_id INT NOT NULL,
          change TEXT NOT NULL,
          stock_after INT NOT NULL,
          by_whom TEXT NOT NULL DEFAULT 'admin',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
      await seedJersey();
    }).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

/** The current club jersey, added once with zero stock until an admin enters it. */
async function seedJersey(): Promise<void> {
  const { rows } = await sql`
    INSERT INTO shop_products (slug, kind, name_en, name_vi, desc_en, desc_vi, price_cents, images, has_fit, has_sizes, sort)
    VALUES (
      'club-jersey-port-hills-dawn', 'jersey',
      'Club Jersey · Port Hills Dawn',
      'Áo CLB · Port Hills Dawn',
      'The official Three Wolves jersey on the Yonex crew V-neck: a sunrise fade from rose to amber, navy side panels and the Three Wolves crest. Collect it at your next play day.',
      'Áo đấu chính thức của Three Wolves trên nền áo Yonex cổ tim: chuyển màu bình minh từ hồng đến hổ phách, viền xanh navy và logo Three Wolves. Nhận áo tại buổi chơi tiếp theo.',
      3000,
      '["/uploads/shop/jersey-port-hills-dawn-front.webp", "/uploads/shop/jersey-port-hills-dawn-back.webp"]'::jsonb,
      TRUE, TRUE, 0
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING id;
  `;
  const id = rows[0]?.id as number | undefined;
  if (!id) return;
  for (const fit of FITS) {
    for (const size of SIZES) {
      await sql`INSERT INTO shop_variants (product_id, fit, size) VALUES (${id}, ${fit}, ${size}) ON CONFLICT DO NOTHING;`;
    }
  }
}

export type Variant = { id: number; fit: Fit; size: string; stock: number; reserved: number; sold: number; available: number };

export type Product = {
  id: number;
  slug: string;
  kind: string;
  nameEn: string;
  nameVi: string;
  descEn: string;
  descVi: string;
  priceCents: number;
  images: string[];
  hasFit: boolean;
  hasSizes: boolean;
  sizeChartMen: string | null;
  sizeChartWomen: string | null;
  active: boolean;
  sort: number;
  variants: Variant[];
  available: number;
};

function sizeOrder(size: string): number {
  const i = (SIZES as readonly string[]).indexOf(size);
  return i === -1 ? 99 : i;
}

async function loadProducts(where: string): Promise<Product[]> {
  const { rows } = await sql.query(`SELECT * FROM shop_products ${where} ORDER BY sort, id;`);
  if (rows.length === 0) return [];
  const { rows: vrows } = await sql.query(
    `SELECT id, product_id, fit, size, stock, reserved, sold FROM shop_variants WHERE product_id = ANY($1::int[]);`,
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => {
    const variants: Variant[] = vrows
      .filter((v) => v.product_id === r.id)
      .map((v) => ({
        id: v.id as number,
        fit: v.fit as Fit,
        size: v.size as string,
        stock: v.stock as number,
        reserved: v.reserved as number,
        sold: v.sold as number,
        available: Math.max(0, (v.stock as number) - (v.reserved as number)),
      }))
      .sort((a, b) => a.fit.localeCompare(b.fit) || sizeOrder(a.size) - sizeOrder(b.size));
    return {
      id: r.id as number,
      slug: r.slug as string,
      kind: r.kind as string,
      nameEn: r.name_en as string,
      nameVi: (r.name_vi as string) || (r.name_en as string),
      descEn: r.desc_en as string,
      descVi: (r.desc_vi as string) || (r.desc_en as string),
      priceCents: r.price_cents as number,
      images: (r.images as string[]) ?? [],
      hasFit: r.has_fit as boolean,
      hasSizes: r.has_sizes as boolean,
      sizeChartMen: (r.size_chart_men as string | null) ?? null,
      sizeChartWomen: (r.size_chart_women as string | null) ?? null,
      active: r.active as boolean,
      sort: r.sort as number,
      variants,
      available: variants.reduce((s, v) => s + v.available, 0),
    };
  });
}

/** Active products with something left ("while stock lasts"). */
export async function listShopProductsForPlayer(): Promise<Product[]> {
  if (!process.env.POSTGRES_URL) return [];
  try {
    await ensureShopTables();
    await releaseExpiredHolds();
    return (await loadProducts("WHERE active")).filter((p) => p.available > 0);
  } catch (err) {
    console.error("[shop] product list failed:", err);
    return [];
  }
}

export async function listProductsForAdmin(): Promise<Product[]> {
  await ensureShopTables();
  await releaseExpiredHolds();
  return loadProducts("");
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderStatus = "pending_payment" | "reserved_cash" | "paid" | "collected" | "cancelled" | "expired" | "refunded";

export type Order = {
  id: number;
  playerId: number | null;
  email: string;
  name: string;
  status: OrderStatus;
  method: "card" | "cash";
  totalCents: number;
  holdExpiresAt: string | null;
  paidAt: string | null;
  collectedAt: string | null;
  createdAt: string;
  items: { label: string; qty: number; unitPriceCents: number; variantId: number }[];
  stripePaymentIntentId: string | null;
};

async function loadOrders(where: string, params: unknown[]): Promise<Order[]> {
  const { rows } = await sql.query(`SELECT * FROM shop_orders ${where} ORDER BY created_at DESC LIMIT 500;`, params);
  if (rows.length === 0) return [];
  const { rows: items } = await sql.query(
    `SELECT order_id, label, qty, unit_price_cents, variant_id FROM shop_order_items WHERE order_id = ANY($1::int[]);`,
    [rows.map((r) => r.id)],
  );
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return rows.map((r) => ({
    id: r.id as number,
    playerId: (r.player_id as number | null) ?? null,
    email: r.email as string,
    name: r.name as string,
    status: r.status as OrderStatus,
    method: r.payment_method as "card" | "cash",
    totalCents: r.total_cents as number,
    holdExpiresAt: iso(r.hold_expires_at as Date | null),
    paidAt: iso(r.paid_at as Date | null),
    collectedAt: iso(r.collected_at as Date | null),
    createdAt: new Date(r.created_at as Date).toISOString(),
    stripePaymentIntentId: (r.stripe_payment_intent_id as string | null) ?? null,
    items: items
      .filter((i) => i.order_id === r.id)
      .map((i) => ({ label: i.label as string, qty: i.qty as number, unitPriceCents: i.unit_price_cents as number, variantId: i.variant_id as number })),
  }));
}

export async function listOrdersForPlayer(playerId: number): Promise<Order[]> {
  if (!process.env.POSTGRES_URL) return [];
  try {
    await ensureShopTables();
    return loadOrders(`WHERE player_id = $1 AND status IN ('reserved_cash', 'paid', 'collected')`, [playerId]);
  } catch (err) {
    console.error("[shop] orders failed:", err);
    return [];
  }
}

export async function listOrdersForAdmin(filter: "open" | "collected" | "all"): Promise<Order[]> {
  await ensureShopTables();
  await releaseExpiredHolds();
  const where =
    filter === "open"
      ? `WHERE status IN ('reserved_cash', 'paid')`
      : filter === "collected"
        ? `WHERE status = 'collected'`
        : `WHERE status <> 'pending_payment'`;
  return loadOrders(where, []);
}

export async function getOrder(id: number): Promise<Order | null> {
  await ensureShopTables();
  return (await loadOrders(`WHERE id = $1`, [id]))[0] ?? null;
}

export class ShopError extends Error {
  code: "sold_out" | "not_found" | "invalid" | "inactive";
  constructor(code: "sold_out" | "not_found" | "invalid" | "inactive") {
    super(code);
    this.code = code;
  }
}

/**
 * Holds one unit and creates the order. Card orders are held 15 minutes
 * for checkout; cash reservations until `cashHoldUntil`.
 */
export async function createOrder(input: {
  playerId: number;
  email: string;
  name: string;
  variantId: number;
  method: "card" | "cash";
  cashHoldUntil: Date;
}): Promise<Order> {
  await ensureShopTables();
  await releaseExpiredHolds();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT v.id, v.fit, v.size, p.id AS product_id, p.name_en, p.price_cents, p.active, p.has_fit, p.has_sizes
       FROM shop_variants v JOIN shop_products p ON p.id = v.product_id WHERE v.id = $1;`,
      [input.variantId],
    );
    const v = rows[0];
    if (!v) throw new ShopError("not_found");
    if (!v.active) throw new ShopError("inactive");
    const held = await client.query(
      `UPDATE shop_variants SET reserved = reserved + 1 WHERE id = $1 AND stock - reserved >= 1 RETURNING id;`,
      [input.variantId],
    );
    if (held.rowCount === 0) throw new ShopError("sold_out");
    const holdUntil =
      input.method === "card" ? new Date(Date.now() + CARD_HOLD_MINUTES * 60_000) : input.cashHoldUntil;
    const order = await client.query(
      `INSERT INTO shop_orders (player_id, email, name, status, payment_method, total_cents, hold_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id;`,
      [
        input.playerId,
        input.email,
        input.name,
        input.method === "card" ? "pending_payment" : "reserved_cash",
        input.method,
        v.price_cents,
        holdUntil.toISOString(),
      ],
    );
    const fitLabel = v.has_fit ? (v.fit === "women" ? "Women's" : v.fit === "men" ? "Men's" : "") : "";
    const label = [v.name_en, [fitLabel, v.has_sizes ? v.size : ""].filter(Boolean).join(" ")].filter(Boolean).join(" — ");
    await client.query(
      `INSERT INTO shop_order_items (order_id, product_id, variant_id, qty, unit_price_cents, label) VALUES ($1, $2, $3, 1, $4, $5);`,
      [order.rows[0].id, v.product_id, input.variantId, v.price_cents, label],
    );
    await client.query("COMMIT");
    return (await getOrder(order.rows[0].id as number))!;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function attachPaymentIntent(orderId: number, paymentIntentId: string): Promise<void> {
  await sql`UPDATE shop_orders SET stripe_payment_intent_id = ${paymentIntentId} WHERE id = ${orderId};`;
}

/**
 * Card payment succeeded (webhook, or the browser's own confirmation).
 * Idempotent. If the 15-minute hold had already lapsed, the stock is taken
 * again if it's still there; if not, the order is flagged as oversold.
 */
export async function markOrderPaidByCard(orderId: number): Promise<"paid" | "already" | "oversold" | "missing"> {
  await ensureShopTables();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT status FROM shop_orders WHERE id = $1 FOR UPDATE;`, [orderId]);
    const status = rows[0]?.status as OrderStatus | undefined;
    if (!status) {
      await client.query("ROLLBACK");
      return "missing";
    }
    if (status === "paid" || status === "collected" || status === "refunded") {
      await client.query("ROLLBACK");
      return "already";
    }
    const { rows: items } = await client.query(`SELECT variant_id, qty FROM shop_order_items WHERE order_id = $1;`, [orderId]);
    let oversold = false;
    for (const it of items) {
      if (status === "pending_payment") {
        await client.query(
          `UPDATE shop_variants SET reserved = reserved - $2, stock = stock - $2, sold = sold + $2 WHERE id = $1;`,
          [it.variant_id, it.qty],
        );
      } else {
        const took = await client.query(
          `UPDATE shop_variants SET stock = stock - $2, sold = sold + $2 WHERE id = $1 AND stock - reserved >= $2 RETURNING id;`,
          [it.variant_id, it.qty],
        );
        if (took.rowCount === 0) oversold = true;
      }
    }
    await client.query(`UPDATE shop_orders SET status = 'paid', paid_at = NOW(), hold_expires_at = NULL WHERE id = $1;`, [orderId]);
    await client.query("COMMIT");
    return oversold ? "oversold" : "paid";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Cash reservation paid and handed over at a play day (admin). */
export async function markCashPaidAndCollected(orderId: number, cashInvoiceId: string | null): Promise<boolean> {
  await ensureShopTables();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT status FROM shop_orders WHERE id = $1 FOR UPDATE;`, [orderId]);
    if (rows[0]?.status !== "reserved_cash") {
      await client.query("ROLLBACK");
      return false;
    }
    const { rows: items } = await client.query(`SELECT variant_id, qty FROM shop_order_items WHERE order_id = $1;`, [orderId]);
    for (const it of items) {
      await client.query(
        `UPDATE shop_variants SET reserved = reserved - $2, stock = stock - $2, sold = sold + $2 WHERE id = $1;`,
        [it.variant_id, it.qty],
      );
    }
    await client.query(
      `UPDATE shop_orders SET status = 'collected', paid_at = NOW(), collected_at = NOW(), hold_expires_at = NULL, cash_invoice_id = $2 WHERE id = $1;`,
      [orderId, cashInvoiceId],
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function markCollected(orderId: number): Promise<void> {
  await ensureShopTables();
  await sql`UPDATE shop_orders SET status = 'collected', collected_at = NOW() WHERE id = ${orderId} AND status = 'paid';`;
}

/** Cancels an unpaid hold or cash reservation and returns the stock. */
export async function cancelOrder(orderId: number, playerId?: number): Promise<boolean> {
  await ensureShopTables();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT status, player_id FROM shop_orders WHERE id = $1 FOR UPDATE;`,
      [orderId],
    );
    const o = rows[0];
    if (!o || (playerId !== undefined && o.player_id !== playerId) || !["reserved_cash", "pending_payment"].includes(o.status)) {
      await client.query("ROLLBACK");
      return false;
    }
    const { rows: items } = await client.query(`SELECT variant_id, qty FROM shop_order_items WHERE order_id = $1;`, [orderId]);
    for (const it of items) {
      await client.query(`UPDATE shop_variants SET reserved = GREATEST(0, reserved - $2) WHERE id = $1;`, [it.variant_id, it.qty]);
    }
    await client.query(`UPDATE shop_orders SET status = 'cancelled', cancelled_at = NOW(), hold_expires_at = NULL WHERE id = $1;`, [orderId]);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** A refunded card order: puts the unit back on the shelf. */
export async function markRefunded(orderId: number): Promise<void> {
  await ensureShopTables();
  const order = await getOrder(orderId);
  if (!order || !["paid", "collected"].includes(order.status)) return;
  for (const it of order.items) {
    if (order.status === "paid") {
      await sql`UPDATE shop_variants SET stock = stock + ${it.qty}, sold = GREATEST(0, sold - ${it.qty}) WHERE id = ${it.variantId};`;
    }
  }
  await sql`UPDATE shop_orders SET status = 'refunded' WHERE id = ${orderId};`;
}

/**
 * Releases lapsed holds: abandoned card checkouts after 15 minutes and cash
 * reservations after their play day. Returns the released cash orders so
 * the caller can email the players.
 */
export async function releaseExpiredHolds(): Promise<Order[]> {
  const { rows } = await sql`
    SELECT id FROM shop_orders
    WHERE status IN ('pending_payment', 'reserved_cash') AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW();
  `;
  const releasedCash: Order[] = [];
  for (const r of rows) {
    const order = await getOrder(r.id as number);
    if (!order) continue;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query(`SELECT status FROM shop_orders WHERE id = $1 FOR UPDATE;`, [order.id]);
      if (!["pending_payment", "reserved_cash"].includes(cur.rows[0]?.status)) {
        await client.query("ROLLBACK");
        continue;
      }
      for (const it of order.items) {
        await client.query(`UPDATE shop_variants SET reserved = GREATEST(0, reserved - $2) WHERE id = $1;`, [it.variantId, it.qty]);
      }
      await client.query(`UPDATE shop_orders SET status = 'expired', hold_expires_at = NULL WHERE id = $1;`, [order.id]);
      await client.query("COMMIT");
      if (order.method === "cash") releasedCash.push(order);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return releasedCash;
}

/** Cash reservations that lapse today and haven't had their heads-up yet. */
export async function cashOrdersExpiringSoon(): Promise<Order[]> {
  await ensureShopTables();
  const orders = await loadOrders(
    `WHERE status = 'reserved_cash' AND reminder_sent_at IS NULL AND hold_expires_at < NOW() + INTERVAL '24 hours'`,
    [],
  );
  return orders;
}

export async function markReminderSent(orderId: number): Promise<void> {
  await sql`UPDATE shop_orders SET reminder_sent_at = NOW() WHERE id = ${orderId};`;
}

/**
 * How long a cash reservation is held: to the end of the player's next play
 * day (a membership day or a casual booking), or 14 days if none is booked.
 */
export async function cashHoldUntil(email: string): Promise<{ until: Date; playDay: string | null }> {
  const today = getClubToday().dateKey;
  const horizon = addDays(today, CASH_HOLD_FALLBACK_DAYS);
  const { rows } = await sql.query(
    `SELECT min(d)::text AS d FROM (
       SELECT b.session_date AS d FROM bookings b
         WHERE lower(trim(b.email)) = $1 AND b.status = 'confirmed' AND b.session_date >= $2::date
       UNION ALL
       SELECT s.date AS d FROM sessions s JOIN memberships m
         ON lower(trim(m.email)) = $1 AND m.status = 'active'
        AND m.day = CASE EXTRACT(DOW FROM s.date) WHEN 5 THEN 'friday' WHEN 3 THEN 'wednesday' END
        AND m.period_start <= s.date AND (m.period_end >= s.date OR (m.recurring AND NOT m.cancel_at_period_end))
       WHERE s.date >= $2::date AND s.date <= $3::date AND s.google_event_id IS NOT NULL
     ) x;`,
    [email.trim().toLowerCase(), today, horizon],
  );
  const playDay = (rows[0]?.d as string | null) ?? null;
  return { until: endOfClubDay(playDay ?? horizon), playDay };
}

/** 11:59 PM in New Zealand on a club date, whichever of NZST/NZDT applies. */
export function endOfClubDay(dateKey: string): Date {
  for (const offset of ["+12:00", "+13:00"]) {
    const candidate = new Date(`${dateKey}T23:59:00${offset}`);
    if (getClubToday(candidate).dateKey === dateKey) return candidate;
  }
  return new Date(`${dateKey}T23:59:00+13:00`);
}

// ---------------------------------------------------------------------------
// Admin: products and stock
// ---------------------------------------------------------------------------

export async function setVariantStock(variantId: number, stock: number, byWhom = "admin"): Promise<void> {
  await ensureShopTables();
  const clean = Math.max(0, Math.floor(stock));
  const { rows } = await sql`
    UPDATE shop_variants SET stock = GREATEST(${clean}, reserved) WHERE id = ${variantId} RETURNING stock;
  `;
  if (rows[0]) {
    await sql`
      INSERT INTO shop_stock_log (variant_id, change, stock_after, by_whom)
      VALUES (${variantId}, ${`set ${clean}`}, ${rows[0].stock as number}, ${byWhom});
    `;
  }
}

export async function saveProduct(input: {
  id?: number;
  nameEn: string;
  nameVi: string;
  descEn: string;
  descVi: string;
  priceCents: number;
  hasFit: boolean;
  hasSizes: boolean;
  active: boolean;
  sort: number;
  images: string[];
}): Promise<number> {
  await ensureShopTables();
  if (input.id) {
    await sql.query(
      `UPDATE shop_products SET name_en = $2, name_vi = $3, desc_en = $4, desc_vi = $5, price_cents = $6,
         has_fit = $7, has_sizes = $8, active = $9, sort = $10, images = $11::jsonb WHERE id = $1;`,
      [input.id, input.nameEn, input.nameVi, input.descEn, input.descVi, input.priceCents, input.hasFit, input.hasSizes, input.active, input.sort, JSON.stringify(input.images)],
    );
    await ensureVariants(input.id, input.hasFit, input.hasSizes);
    return input.id;
  }
  const slug = `${input.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item"}-${Date.now().toString(36)}`;
  const { rows } = await sql.query(
    `INSERT INTO shop_products (slug, name_en, name_vi, desc_en, desc_vi, price_cents, has_fit, has_sizes, active, sort, images)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING id;`,
    [slug, input.nameEn, input.nameVi, input.descEn, input.descVi, input.priceCents, input.hasFit, input.hasSizes, input.active, input.sort, JSON.stringify(input.images)],
  );
  const id = rows[0].id as number;
  await ensureVariants(id, input.hasFit, input.hasSizes);
  return id;
}

async function ensureVariants(productId: number, hasFit: boolean, hasSizes: boolean): Promise<void> {
  const fits: string[] = hasFit ? [...FITS] : ["unisex"];
  const sizes: string[] = hasSizes ? [...SIZES] : ["One size"];
  for (const fit of fits) {
    for (const size of sizes) {
      await sql`INSERT INTO shop_variants (product_id, fit, size) VALUES (${productId}, ${fit}, ${size}) ON CONFLICT DO NOTHING;`;
    }
  }
}

export async function setSizeChart(productId: number, fit: "men" | "women", url: string | null): Promise<void> {
  await ensureShopTables();
  if (fit === "men") await sql`UPDATE shop_products SET size_chart_men = ${url} WHERE id = ${productId};`;
  else await sql`UPDATE shop_products SET size_chart_women = ${url} WHERE id = ${productId};`;
}

export async function getProduct(id: number): Promise<Product | null> {
  await ensureShopTables();
  return (await loadProducts(`WHERE id = ${Number(id) | 0}`))[0] ?? null;
}
