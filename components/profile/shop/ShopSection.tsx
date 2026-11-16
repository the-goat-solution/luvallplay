"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProfileT } from "@/lib/profile-i18n";
import { StripeCardForm } from "@/components/payment/StripeCardForm";
import type { Order, Product, Variant } from "@/lib/shop-db";
import { Sheet } from "../Sheet";
import styles from "../profile.module.css";
import shop from "./shop.module.css";
import { fmtMoney, postJson } from "../membership/format";

const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL"];

function fmtDateTime(iso: string | null, lang: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function ProductCard({ product, onOrdered }: { product: Product; onOrdered: (msg: string) => void }) {
  const { tr, lang } = useProfileT();
  const router = useRouter();
  const fits = product.hasFit ? (["men", "women"] as const) : (["unisex"] as const);
  const [fit, setFit] = useState<string>(fits[0]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [photo, setPhoto] = useState(0);
  const [sizeGuide, setSizeGuide] = useState(false);
  const [busy, setBusy] = useState<"card" | "cash" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<{ orderId: number; clientSecret: string } | null>(null);

  const variants = product.variants
    .filter((v) => v.fit === fit && (product.hasSizes ? SIZE_ORDER.includes(v.size) : true))
    .sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
  const selected: Variant | undefined = variants.find((v) => v.id === variantId);
  const price = fmtMoney(product.priceCents);
  const chart = fit === "women" ? product.sizeChartWomen : product.sizeChartMen;
  const name = lang === "vi" ? product.nameVi : product.nameEn;
  const desc = lang === "vi" ? product.descVi : product.descEn;

  // Single-variant products (no fit, no sizes) are selected automatically.
  const effectiveVariant = !product.hasFit && !product.hasSizes ? variants[0] : selected;

  const order = async (method: "card" | "cash") => {
    if (!effectiveVariant) return;
    setBusy(method);
    setError(null);
    const res = await postJson("/api/profile/shop/order", { variantId: effectiveVariant.id, method });
    setBusy(null);
    if (!res.ok) {
      setError(tr(res.data.error === "sold_out" ? "shop_sold_out_now" : "shop_failed"));
      if (res.data.error === "sold_out") router.refresh();
      return;
    }
    const o = res.data.order as Order;
    if (method === "cash") {
      onOrdered(tr("shop_reserved", { price, date: fmtDateTime(o.holdExpiresAt, lang) }));
      router.refresh();
      return;
    }
    setCheckout({ orderId: o.id, clientSecret: res.data.clientSecret as string });
  };

  const paid = async () => {
    if (!checkout) return;
    await postJson(`/api/profile/shop/order/${checkout.orderId}/confirm`);
    setCheckout(null);
    onOrdered(tr("shop_paid"));
    router.refresh();
  };

  const closeCheckout = async () => {
    if (checkout) await postJson(`/api/profile/shop/order/${checkout.orderId}/cancel`);
    setCheckout(null);
  };

  return (
    <article className={shop.product}>
      <div className={shop.gallery}>
        <div className={shop.photos} onScroll={(e) => {
          const el = e.currentTarget;
          setPhoto(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}>
          {product.images.map((src, i) => (
            <img key={src} src={src} alt={`${name} — ${tr("shop_photo", { n: i + 1 })}`} loading={i === 0 ? "eager" : "lazy"} decoding="async" />
          ))}
        </div>
        {product.images.length > 1 && (
          <div className={shop.dots} aria-hidden="true">
            {product.images.map((src, i) => (
              <span key={src} className={i === photo ? shop.dotActive : undefined} />
            ))}
          </div>
        )}
      </div>
      <div className={shop.info}>
        <h3 className={shop.name}>{name}</h3>
        <div className={shop.price}>{price}</div>
        <p className={styles.small} style={{ marginBottom: 14 }}>
          {desc}
        </p>

        {product.hasFit && (
          <div role="radiogroup" aria-label="Fit" className={shop.segment}>
            {fits.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={fit === f}
                className={fit === f ? shop.segmentOn : undefined}
                onClick={() => {
                  setFit(f);
                  setVariantId(null);
                }}
              >
                {tr(f === "men" ? "shop_men" : "shop_women")}
              </button>
            ))}
          </div>
        )}

        {product.hasSizes && (
          <>
            <div style={{ display: "flex", alignItems: "center", margin: "12px 0 8px" }}>
              <span className={styles.label}>{tr("shop_size")}</span>
              <button type="button" className={styles.linkBtn} style={{ marginLeft: "auto", fontSize: 13 }} onClick={() => setSizeGuide(true)}>
                {tr("shop_size_guide")}
              </button>
            </div>
            <div role="radiogroup" aria-label={tr("shop_size")} className={shop.sizes}>
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={variantId === v.id}
                  disabled={v.available <= 0}
                  className={`${shop.size} ${variantId === v.id ? shop.sizeOn : ""}`}
                  onClick={() => setVariantId(v.id)}
                >
                  <span>{v.size}</span>
                  <small>{v.available <= 0 ? tr("shop_sold_out") : v.available <= 3 ? tr("shop_left", { n: v.available }) : " "}</small>
                </button>
              ))}
            </div>
          </>
        )}

        {error && <div className={styles.error} style={{ marginTop: 12 }}>{error}</div>}

        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <button type="button" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={!effectiveVariant || busy !== null} onClick={() => order("card")}>
            {busy === "card" ? "…" : effectiveVariant ? tr("shop_pay_card", { price }) : tr("shop_pick_size")}
          </button>
          <button type="button" className={`${styles.btn} ${styles.secondary} ${styles.btnBlock}`} disabled={!effectiveVariant || busy !== null} onClick={() => order("cash")}>
            {busy === "cash" ? "…" : tr("shop_pay_cash")}
          </button>
        </div>
      </div>

      <Sheet open={sizeGuide} onClose={() => setSizeGuide(false)} title={`${tr("shop_size_guide")} · ${tr(fit === "women" ? "shop_women" : "shop_men")}`}>
        {chart ? <img src={chart} alt={tr("shop_size_guide")} style={{ width: "100%", borderRadius: 12 }} /> : <p className={styles.muted}>{tr("shop_size_guide_soon")}</p>}
      </Sheet>

      <Sheet open={Boolean(checkout)} onClose={closeCheckout} title={tr("shop_card_title")}>
        {checkout && (
          <>
            <p className={styles.muted} style={{ marginBottom: 12 }}>
              {name}
              {selected ? ` — ${product.hasFit ? `${tr(fit === "women" ? "shop_women" : "shop_men")} ` : ""}${selected.size}` : ""} · {price}
            </p>
            <StripeCardForm clientSecret={checkout.clientSecret} amountLabel={tr("mem_pay", { amount: (product.priceCents / 100).toString() })} onSuccess={paid} returnPath="/profile/membership#shop" />
          </>
        )}
      </Sheet>
    </article>
  );
}

export function ShopSection({ products, orders }: { products: Product[]; orders: Order[] }) {
  const { tr, lang } = useProfileT();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  if (products.length === 0 && orders.length === 0) return null;

  const cancel = async (id: number) => {
    await postJson(`/api/profile/shop/order/${id}/cancel`);
    router.refresh();
  };

  return (
    <section id="shop" className={styles.card} aria-labelledby="shop-title">
      <h2 id="shop-title" className={styles.cardTitle}>
        {tr("shop_title")}
      </h2>
      <p className={styles.small} style={{ marginBottom: 14 }}>
        {tr("shop_sub")}
      </p>
      {message && <div className={styles.success}>{message}</div>}

      {orders.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className={styles.label} style={{ marginBottom: 6 }}>
            {tr("shop_my_orders")}
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
            {orders.map((o) => (
              <li key={o.id} className={styles.row} style={{ background: "var(--cream)", borderRadius: 12, padding: "8px 12px" }}>
                <span className={styles.rowText}>
                  <strong style={{ fontSize: 14 }}>{o.items.map((i) => i.label).join(", ")}</strong>
                  <span className={styles.small}>
                    {o.status === "reserved_cash"
                      ? tr("shop_status_reserved", { price: fmtMoney(o.totalCents), date: fmtDateTime(o.holdExpiresAt, lang) })
                      : o.status === "collected"
                        ? `✓ ${tr("shop_status_collected")}`
                        : tr("shop_status_paid")}
                  </span>
                </span>
                {o.status === "reserved_cash" && (
                  <button type="button" className={`${styles.btn} ${styles.ghost}`} style={{ fontSize: 13 }} onClick={() => cancel(o.id)}>
                    {tr("shop_cancel_reservation")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={shop.grid}>
        {products.map((p) => (
          <ProductCard key={p.id} product={p} onOrdered={setMessage} />
        ))}
      </div>
    </section>
  );
}
