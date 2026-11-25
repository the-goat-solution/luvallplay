// The club shop on Me, as on the website: pick a fit and size, then pay by
// card (Stripe, the item held 15 minutes meanwhile) or reserve and pay cash
// at your next play day; your orders below.
import { useMemo, useState } from "react";
import { useCurrentClub, useLang, useT } from "../../hooks.tsx";
import { dayLabel, localeOf, money } from "../../lib/format.ts";
import { CardPayment } from "../../components/CardPayment.tsx";
import { Dialog } from "../arena/Dialogs.tsx";
import { useShop, useShopActions, type Order, type Product } from "./data.ts";

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

function ProductCard({ p, cash }: { p: Product; cash: boolean }) {
  const { config } = useCurrentClub();
  const t = useT(config);
  const lang = useLang();
  const { order, confirm, cancel } = useShopActions();
  const currency = config?.club.currency ?? "NZD";
  const fits = p.hasFit ? (["men", "women"] as const) : (["unisex"] as const);
  const [fit, setFit] = useState<(typeof fits)[number]>(fits[0]);
  const sizes = useMemo(() => p.variants.filter((v) => v.fit === fit).sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size)), [p, fit]);
  const [variantId, setVariantId] = useState<number | null>(!p.hasFit && !p.hasSizes ? (p.variants[0]?.id ?? null) : null);
  const [checkout, setCheckout] = useState<{ id: number; clientSecret: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const web = config?.club.webUrl ?? "";
  const src = (u: string) => (u.startsWith("/") ? `${web}${u}` : u);
  const name = lang === "vi" ? p.nameVi || p.nameEn : p.nameEn;
  const desc = lang === "vi" ? p.descVi || p.descEn : p.descEn;
  const price = money(p.priceCents, currency);
  const failed = (e: unknown) => setMessage({ ok: false, text: (e as { code?: string }).code === "sold_out" ? t("shop_sold_out_now") : t("shop_failed") });

  const buy = (method: "card" | "cash") => {
    if (!variantId) return;
    setMessage(null);
    order.mutate(
      { variantId, method },
      {
        onSuccess: (r) => {
          if (method === "card") {
            if (r.clientSecret) setCheckout({ id: r.order.id, clientSecret: r.clientSecret });
            else setMessage({ ok: false, text: t("card_unavailable") });
          } else {
            setMessage({ ok: true, text: t("shop_reserved", { price, date: r.playDay ? dayLabel(r.playDay, localeOf(lang, config?.club.country ?? "")) : "" }) });
            setVariantId(!p.hasFit && !p.hasSizes ? variantId : null);
          }
        },
        onError: failed,
      },
    );
  };
  const abandon = () => {
    if (checkout) cancel.mutate(checkout.id);
    setCheckout(null);
  };

  return (
    <article className="card stack product" aria-labelledby={`product-${p.id}`}>
      {p.images.length > 0 && (
        <div className="product-photos">
          {p.images.map((u, i) => (
            <img key={u} src={src(u)} alt={`${name} — ${t("shop_photo", { n: i + 1 })}`} loading={i === 0 ? "eager" : "lazy"} decoding="async" />
          ))}
        </div>
      )}
      <div className="card-head">
        <h3 id={`product-${p.id}`}>{name}</h3>
        <strong className="product-price">{price}</strong>
      </div>
      {desc && <p className="muted small">{desc}</p>}
      {p.hasFit && (
        <div className="segmented" role="group" aria-label={t("shop_size")}>
          {fits.map((f) => (
            <button key={f} type="button" aria-pressed={fit === f} onClick={() => { setFit(f); setVariantId(null); }}>
              {t(f === "men" ? "shop_men" : "shop_women")}
            </button>
          ))}
        </div>
      )}
      {p.hasSizes && (
        <fieldset className="stack-tight">
          <legend className="small">{t("shop_size")}</legend>
          <div className="chips">
            {sizes.map((v) => (
              <button key={v.id} type="button" className="chip-button" aria-pressed={variantId === v.id} disabled={v.available <= 0} onClick={() => setVariantId(v.id)}>
                {v.size}
                {v.available <= 0 ? ` · ${t("shop_sold_out")}` : v.available <= 3 ? ` · ${t("shop_left", { n: v.available })}` : ""}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="actions">
        <button type="button" className="button button-primary" disabled={!variantId || order.isPending} onClick={() => buy("card")}>
          {variantId ? t("shop_pay_card", { price }) : t("shop_pick_size")}
        </button>
        {cash && (
          <button type="button" className="button" disabled={!variantId || order.isPending} onClick={() => buy("cash")}>
            {t("shop_pay_cash")}
          </button>
        )}
      </div>
      {message && <p className={`notice${message.ok ? "" : " notice-error"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      {checkout && (
        <Dialog label={t("shop_card_title")} onClose={abandon}>
          <h2>{t("shop_card_title")}</h2>
          <p className="muted">{name} · {price}</p>
          <CardPayment
            clientSecret={checkout.clientSecret}
            label={t("shop_pay_card", { price })}
            returnPath="/me"
            onDone={() => {
              const id = checkout.id;
              setCheckout(null);
              confirm.mutate(id, {
                onSuccess: () => setMessage({ ok: true, text: t("shop_paid") }),
                // The webhook marks it paid even if this answer is slow.
                onError: () => setMessage({ ok: true, text: t("shop_paid") }),
              });
            }}
          />
          <div><button type="button" className="button button-quiet" onClick={abandon}>{t("cancel")}</button></div>
        </Dialog>
      )}
    </article>
  );
}

function OrderRow({ o }: { o: Order }) {
  const { config } = useCurrentClub();
  const t = useT(config);
  const lang = useLang();
  const { cancel } = useShopActions();
  const price = money(o.totalCents, config?.club.currency ?? "NZD");
  const until = o.holdExpiresAt ? new Date(o.holdExpiresAt).toLocaleDateString(localeOf(lang, config?.club.country ?? ""), { weekday: "short", day: "numeric", month: "short" }) : "";
  return (
    <li className="row">
      <span className="row-text">
        <strong>{o.items.map((i) => i.label).join(", ")}</strong>
        <span className="muted small">
          {o.status === "reserved_cash" ? t("shop_status_reserved", { price, date: until }) : o.status === "collected" ? t("shop_status_collected") : t("shop_status_paid")}
        </span>
      </span>
      {o.status === "reserved_cash" && (
        <button type="button" className="button button-quiet button-small" disabled={cancel.isPending} onClick={() => cancel.mutate(o.id)}>
          {t("shop_cancel_reservation")}
        </button>
      )}
    </li>
  );
}

export function ShopSection() {
  const { config } = useCurrentClub();
  const t = useT(config);
  const shop = useShop();
  const s = shop.data;
  if (!config?.modules.includes("shop") || !s || (s.products.length === 0 && s.orders.length === 0)) return null;
  return (
    <section className="stack" aria-labelledby="shop-title" id="shop">
      <div>
        <h2 id="shop-title">{t("shop_title")}</h2>
        <p className="muted small">{t("shop_sub")}</p>
      </div>
      {s.products.map((p) => <ProductCard key={p.id} p={p} cash={s.cash} />)}
      {s.orders.length > 0 && (
        <div className="card stack">
          <h3>{t("shop_my_orders")}</h3>
          <ul className="rows">{s.orders.map((o) => <OrderRow key={o.id} o={o} />)}</ul>
        </div>
      )}
    </section>
  );
}
