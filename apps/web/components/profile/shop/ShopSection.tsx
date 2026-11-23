"use client";

import { CLUB_TIME_ZONE } from "@/lib/constants";
import { useEffect, useRef, useState } from "react";
import { useProfileT } from "@/lib/profile-i18n";
import { StripeCardForm } from "../LazyStripeCardForm";
import type { Order, Product, Variant } from "@/lib/shop-db";
import { Sheet } from "../Sheet";
import { BusyLabel } from "../BusyLabel";
import { useBusyAction } from "../useBusyAction";
import styles from "../profile.module.css";
import shop from "./shop.module.css";
import { fmtMoney, postJson } from "../membership/format";

const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL"];

function fmtDateTime(iso: string | null, lang: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-NZ", {
    timeZone: CLUB_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Full-screen photo viewer: swipe or arrows between photos, Esc or ✕ to close, pinch to zoom. */
function PhotoViewer({ images, start, alt, onClose }: { images: string[]; start: number; alt: (i: number) => string; onClose: () => void }) {
  const { tr } = useProfileT();
  const [i, setI] = useState(start);
  const strip = useRef<HTMLDivElement>(null);
  const go = (n: number) => {
    const next = (n + images.length) % images.length;
    setI(next);
    strip.current?.scrollTo({ left: next * strip.current.clientWidth, behavior: "smooth" });
  };
  useEffect(() => {
    strip.current?.scrollTo({ left: start * strip.current.clientWidth });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);
  return (
    <div className={shop.viewer} role="dialog" aria-modal="true" aria-label={alt(i)} onClick={onClose}>
      <button type="button" className={shop.viewerClose} onClick={onClose} aria-label={tr("close")}>
        ✕
      </button>
      <div
        ref={strip}
        className={shop.viewerStrip}
        onClick={(e) => e.stopPropagation()}
        onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
      >
        {images.map((src, n) => (
          <div key={src} className={shop.viewerSlide} onClick={onClose}>
            <img src={src} alt={alt(n)} onClick={(e) => e.stopPropagation()} />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <>
          <button type="button" className={`${shop.viewerNav} ${shop.viewerPrev}`} onClick={(e) => (e.stopPropagation(), go(i - 1))} aria-label={tr("shop_prev_photo")}>
            ‹
          </button>
          <button type="button" className={`${shop.viewerNav} ${shop.viewerNext}`} onClick={(e) => (e.stopPropagation(), go(i + 1))} aria-label={tr("shop_next_photo")}>
            ›
          </button>
          <div className={shop.viewerCount}>
            {i + 1} / {images.length}
          </div>
        </>
      )}
    </div>
  );
}

function ProductCard({ product, onOrdered }: { product: Product; onOrdered: (msg: string) => void }) {
  const { tr, lang } = useProfileT();
  const { refresh, refreshing } = useBusyAction();
  const fits = product.hasFit ? (["men", "women"] as const) : (["unisex"] as const);
  const [fit, setFit] = useState<string>(fits[0]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [photo, setPhoto] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
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
      if (res.data.error === "sold_out") refresh();
      return;
    }
    const o = res.data.order as Order;
    if (method === "cash") {
      onOrdered(tr("shop_reserved", { price, date: fmtDateTime(o.holdExpiresAt, lang) }));
      refresh();
      return;
    }
    setCheckout({ orderId: o.id, clientSecret: res.data.clientSecret as string });
  };

  const paid = async () => {
    if (!checkout) return;
    await postJson(`/api/profile/shop/order/${checkout.orderId}/confirm`);
    setCheckout(null);
    onOrdered(tr("shop_paid"));
    refresh();
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
            <button key={src} type="button" className={shop.photoBtn} onClick={() => setViewing(i)} aria-label={tr("shop_view_photo", { n: i + 1 })}>
              <img src={src} alt={`${name} — ${tr("shop_photo", { n: i + 1 })}`} loading={i === 0 ? "eager" : "lazy"} decoding="async" />
              <span className={shop.zoomHint} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="M16 16l4.5 4.5M11 8v6M8 11h6" />
                </svg>
              </span>
            </button>
          ))}
        </div>
        {viewing !== null && (
          <PhotoViewer images={product.images} start={viewing} alt={(i) => `${name} — ${tr("shop_photo", { n: i + 1 })}`} onClose={() => setViewing(null)} />
        )}
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
          <button type="button" className={`${styles.btn} ${styles.primary} ${styles.btnBlock}`} disabled={!effectiveVariant || busy !== null || refreshing} aria-busy={busy === "card"} onClick={() => order("card")}>
            <BusyLabel busy={busy === "card"}>{effectiveVariant ? tr("shop_pay_card", { price }) : tr("shop_pick_size")}</BusyLabel>
          </button>
          <button type="button" className={`${styles.btn} ${styles.secondary} ${styles.btnBlock}`} disabled={!effectiveVariant || busy !== null || refreshing} aria-busy={busy === "cash" || (refreshing && busy === null)} onClick={() => order("cash")}>
            <BusyLabel busy={busy === "cash"}>{tr("shop_pay_cash")}</BusyLabel>
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
            <StripeCardForm clientSecret={checkout.clientSecret} amountLabel={tr("mem_pay", { amount: (product.priceCents / 100).toString() })} onSuccess={paid} returnPath="/profile#shop" />
          </>
        )}
      </Sheet>
    </article>
  );
}

export function ShopSection({ products, orders }: { products: Product[]; orders: Order[] }) {
  const { tr, lang } = useProfileT();
  const { busy, run, refresh } = useBusyAction();
  const [message, setMessage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  if (products.length === 0 && orders.length === 0) return null;

  const cancel = async (id: number) => {
    setCancelling(id);
    await run(() => postJson(`/api/profile/shop/order/${id}/cancel`));
    refresh();
  };
  // Spinner from the tap until the refreshed list arrives.
  const cancelBusy = (id: number) => busy && cancelling === id;

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
                  <button type="button" className={`${styles.btn} ${styles.ghost}`} style={{ fontSize: 13 }} disabled={busy} aria-busy={cancelBusy(o.id)} onClick={() => cancel(o.id)}>
                    <BusyLabel busy={cancelBusy(o.id)}>{tr("shop_cancel_reservation")}</BusyLabel>
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
