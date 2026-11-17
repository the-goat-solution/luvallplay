import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminLink } from "@/components/admin/AdminLink";
import { AdminToastBridge } from "@/components/admin/AdminToastBridge";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { btn, btnDanger, btnSecondary, card, formatNz, input, pill, td, th } from "@/components/admin/ui";
import {
  FITS,
  SIZES,
  cancelOrder,
  getOrder,
  getProduct,
  listOrdersForAdmin,
  listProductsForAdmin,
  markCashPaidAndCollected,
  markCollected,
  markRefunded,
  saveProduct,
  setSizeChart,
  setVariantStock,
  type Order,
  type Product,
} from "@/lib/shop-db";
import { getStripe } from "@/lib/stripe";
import { publicBlobConfigured, uploadPublicImage } from "@/lib/public-blob";

export const dynamic = "force-dynamic";

function back(param: "toast" | "toastError", message: string, extra = ""): never {
  redirect(`/admin/shop?${param}=${encodeURIComponent(message)}${extra}`);
}

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

/** Records the cash in Stripe (invoice paid out of band) so Financials imports it as Cash. */
async function recordCashInStripe(order: Order): Promise<string | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  const stripe = getStripe();
  const customers = await stripe.customers.list({ email: order.email, limit: 1 });
  const customer = customers.data[0] ?? (await stripe.customers.create({ email: order.email, name: order.name || undefined }));
  const items = order.items.map((i) => i.label).join(", ");
  await stripe.invoiceItems.create({ customer: customer.id, amount: order.totalCents, currency: "nzd", description: `Three Wolves shop — ${items} — cash` });
  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: 1,
    auto_advance: false,
    pending_invoice_items_behavior: "include",
    metadata: { type: "shop", source: "cash", orderId: String(order.id), items: items.slice(0, 450), email: order.email },
  });
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id!);
  await stripe.invoices.pay(finalized.id!, { paid_out_of_band: true });
  return finalized.id!;
}

async function cashCollected(orderId: number) {
  "use server";
  const order = await getOrder(orderId);
  if (!order || order.status !== "reserved_cash") back("toastError", "That reservation isn't waiting for cash any more.");
  let invoiceId: string | null = null;
  try {
    invoiceId = await recordCashInStripe(order);
  } catch (err) {
    back("toastError", `Couldn't record the cash in Stripe: ${(err as Error).message}`);
  }
  await markCashPaidAndCollected(orderId, invoiceId);
  revalidatePath("/admin/shop");
  back("toast", `Order #${orderId}: cash received and handed over.`);
}

async function collected(orderId: number) {
  "use server";
  await markCollected(orderId);
  revalidatePath("/admin/shop");
  back("toast", `Order #${orderId} handed over.`);
}

async function cancel(orderId: number) {
  "use server";
  const ok = await cancelOrder(orderId);
  revalidatePath("/admin/shop");
  if (!ok) back("toastError", "Only unpaid reservations can be cancelled. Use Refund for paid orders.");
  back("toast", `Reservation #${orderId} cancelled; the item is back in stock.`);
}

async function refund(orderId: number) {
  "use server";
  const order = await getOrder(orderId);
  if (!order || !order.stripePaymentIntentId) back("toastError", "Only card orders can be refunded here. Refund cash in person.");
  try {
    await getStripe().refunds.create({ payment_intent: order.stripePaymentIntentId });
  } catch (err) {
    back("toastError", `Stripe refund failed: ${(err as Error).message}`);
  }
  await markRefunded(orderId);
  revalidatePath("/admin/shop");
  back("toast", `Order #${orderId} refunded.`);
}

async function saveStock(productId: number, formData: FormData) {
  "use server";
  const product = await getProduct(productId);
  if (!product) back("toastError", "Product not found.");
  let changed = 0;
  for (const v of product.variants) {
    const raw = formData.get(`stock_${v.id}`);
    if (raw === null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    if (n !== v.stock) {
      await setVariantStock(v.id, n);
      changed++;
    }
  }
  revalidatePath("/admin/shop");
  revalidatePath("/profile/membership");
  back("toast", changed ? `Stock updated (${changed} size${changed === 1 ? "" : "s"}).` : "No stock changes.");
}

async function saveProductAction(productId: number | null, formData: FormData) {
  "use server";
  const nameEn = String(formData.get("nameEn") ?? "").trim();
  const price = Number(formData.get("price"));
  if (!nameEn || !Number.isFinite(price) || price <= 0) back("toastError", "A name and a price are needed.");
  const existing = productId ? await getProduct(productId) : null;
  let images = String(formData.get("images") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const upload = formData.get("upload");
  if (upload instanceof File && upload.size > 0) {
    try {
      images = [...images, await uploadPublicImage(upload, "shop")];
    } catch (err) {
      back("toastError", (err as Error).message);
    }
  }
  const id = await saveProduct({
    id: productId ?? undefined,
    nameEn,
    nameVi: String(formData.get("nameVi") ?? "").trim(),
    descEn: String(formData.get("descEn") ?? "").trim(),
    descVi: String(formData.get("descVi") ?? "").trim(),
    priceCents: Math.round(price * 100),
    hasFit: formData.get("hasFit") === "on",
    hasSizes: formData.get("hasSizes") === "on",
    active: formData.get("active") === "on",
    sort: Number(formData.get("sort") ?? existing?.sort ?? 0) || 0,
    images,
  });
  revalidatePath("/admin/shop");
  revalidatePath("/profile/membership");
  back("toast", productId ? "Product saved." : "Product added. Enter its stock below.", `#product-${id}`);
}

async function uploadSizeChart(productId: number, fit: "men" | "women", formData: FormData) {
  "use server";
  const file = formData.get("chart");
  if (!(file instanceof File) || file.size === 0) back("toastError", "Choose an image first.");
  let url: string;
  try {
    url = await uploadPublicImage(file, `size-charts/${productId}`);
  } catch (err) {
    back("toastError", (err as Error).message);
  }
  await setSizeChart(productId, fit, url);
  revalidatePath("/admin/shop");
  back("toast", `${fit === "men" ? "Men's" : "Women's"} size chart uploaded.`);
}

async function removeSizeChart(productId: number, fit: "men" | "women") {
  "use server";
  await setSizeChart(productId, fit, null);
  revalidatePath("/admin/shop");
  back("toast", "Size chart removed.");
}

const STATUS_PILL: Record<string, [string, string, string]> = {
  reserved_cash: ["Reserved · cash", "#fff4e5", "#8a4b00"],
  paid: ["Paid · card", "#e9f6ee", "#1d6b3d"],
  collected: ["Collected", "#eee", "#555"],
  cancelled: ["Cancelled", "#eee", "#888"],
  expired: ["Expired", "#eee", "#888"],
  refunded: ["Refunded", "#fdecec", "#a12a2a"],
};

function StockGrid({ product }: { product: Product }) {
  const fits: string[] = product.hasFit ? [...FITS] : ["unisex"];
  const sizes: string[] = product.hasSizes ? [...SIZES] : ["One size"];
  const find = (fit: string, size: string) => product.variants.find((v) => v.fit === fit && v.size === size);
  return (
    <form action={saveStock.bind(null, product.id)}>
      <div className={adminStyles.tableWrap}>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}></th>
              {sizes.map((s) => (
                <th key={s} style={{ ...th, textAlign: "center" }}>
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fits.map((fit) => (
              <tr key={fit} style={{ borderTop: "1px solid #eee" }}>
                <th style={th}>{fit === "men" ? "Men's" : fit === "women" ? "Women's" : "Stock"}</th>
                {sizes.map((size) => {
                  const v = find(fit, size);
                  if (!v) return <td key={size} style={td} />;
                  const low = v.available <= 2;
                  return (
                    <td key={size} style={{ ...td, textAlign: "center", background: low ? "#fff7ed" : undefined }}>
                      <input
                        name={`stock_${v.id}`}
                        type="number"
                        min={v.reserved}
                        defaultValue={v.stock}
                        inputMode="numeric"
                        style={{ ...input, width: 64, textAlign: "center" }}
                        aria-label={`${fit} ${size} stock`}
                      />
                      <div style={{ fontSize: 11, color: "#888", marginTop: 3, whiteSpace: "nowrap" }}>
                        {v.reserved > 0 ? `${v.reserved} held · ` : ""}
                        {v.sold} sold
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: "#888", fontSize: 12, margin: "6px 0 10px" }}>
        Stock = units on hand not yet sold. “Held” are reserved for a checkout or a cash reservation and can&apos;t be removed. Orange = 2 or fewer left.
      </p>
      <SubmitButton loadingText="Saving…" style={btn}>
        Save stock
      </SubmitButton>
    </form>
  );
}

function ProductForm({ product }: { product: Product | null }) {
  return (
    <form action={saveProductAction.bind(null, product?.id ?? null)} style={{ display: "grid", gap: 8, maxWidth: 640 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input name="nameEn" defaultValue={product?.nameEn} placeholder="Name (English)" required style={input} />
        <input name="nameVi" defaultValue={product?.nameVi} placeholder="Name (Vietnamese)" style={input} />
      </div>
      <textarea name="descEn" defaultValue={product?.descEn} placeholder="Description (English)" rows={3} style={{ ...input, fontFamily: "inherit" }} />
      <textarea name="descVi" defaultValue={product?.descVi} placeholder="Description (Vietnamese)" rows={3} style={{ ...input, fontFamily: "inherit" }} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <label>
          Price $ <input name="price" type="number" step="0.01" min="0.5" defaultValue={product ? product.priceCents / 100 : ""} required style={{ ...input, width: 90 }} />
        </label>
        <label>
          Order <input name="sort" type="number" defaultValue={product?.sort ?? 0} style={{ ...input, width: 60 }} />
        </label>
        <label>
          <input name="hasFit" type="checkbox" defaultChecked={product?.hasFit ?? true} /> Men&apos;s / Women&apos;s
        </label>
        <label>
          <input name="hasSizes" type="checkbox" defaultChecked={product?.hasSizes ?? true} /> Sizes S–3XL
        </label>
        <label>
          <input name="active" type="checkbox" defaultChecked={product?.active ?? true} /> On sale
        </label>
      </div>
      <label style={{ fontSize: 13 }}>
        Photos (one URL per line, first is the main photo)
        <textarea name="images" defaultValue={product?.images.join("\n")} rows={3} style={{ ...input, width: "100%", fontFamily: "monospace", fontSize: 12 }} />
      </label>
      {publicBlobConfigured() ? (
        <label style={{ fontSize: 13 }}>
          Add a photo: <input name="upload" type="file" accept="image/*" />
        </label>
      ) : (
        <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Photo uploads need the public Blob store (connected with the prefix PHOTO); until then paste image URLs.</p>
      )}
      <div>
        <SubmitButton loadingText="Saving…" style={btn}>
          {product ? "Save product" : "Add product"}
        </SubmitButton>
      </div>
    </form>
  );
}

export default async function ShopAdminPage({ searchParams }: { searchParams: Promise<{ orders?: string; edit?: string }> }) {
  const { orders: rawFilter, edit } = await searchParams;
  const filter = rawFilter === "collected" || rawFilter === "all" ? rawFilter : "open";
  if (!process.env.POSTGRES_URL) {
    return (
      <div className={adminStyles.page}>
        <h1 className={adminStyles.title}>Shop</h1>
        <AdminNav active="shop" />
        <p>Database is not configured.</p>
      </div>
    );
  }
  const [products, orders] = await Promise.all([listProductsForAdmin(), listOrdersForAdmin(filter)]);
  const editing = edit === "new" ? "new" : Number(edit) || null;

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Shop</h1>
      <p className={adminStyles.subtitle}>Club jersey and merchandise in the profile&apos;s Membership tab. Players pay by card online or reserve and pay cash at a play day.</p>
      <AdminNav active="shop" />
      <AdminToastBridge />

      <section style={card}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Orders</h2>
          {(["open", "collected", "all"] as const).map((f) => (
            <AdminLink
              key={f}
              href={`/admin/shop?orders=${f}`}
              style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #ccc", textDecoration: "none", fontSize: 12, background: f === filter ? "#1a2a4a" : "#fff", color: f === filter ? "#fff" : "#333" }}
            >
              {f === "open" ? "To hand over" : f[0].toUpperCase() + f.slice(1)}
            </AdminLink>
          ))}
          <a href={`/api/admin/shop/export?orders=${filter}`} style={{ ...btnSecondary, marginLeft: "auto", textDecoration: "none" }}>
            Export to Excel
          </a>
        </div>
        {orders.length === 0 ? (
          <p style={{ color: "#888", margin: 0 }}>No orders here.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {orders.map((o) => {
              const [label, bg, color] = STATUS_PILL[o.status] ?? [o.status, "#eee", "#555"];
              return (
                <div key={o.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: "10px 12px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      #{o.id} · {o.name || o.email} <span style={pill(bg, color)}>{label}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#555" }}>
                      {o.items.map((i) => i.label).join(", ")} · {money(o.totalCents)}
                    </div>
                    <div style={{ fontSize: 12, color: "#888" }}>
                      {formatNz(o.createdAt, true)}
                      {o.status === "reserved_cash" && o.holdExpiresAt ? ` · held until ${formatNz(o.holdExpiresAt, true)}` : ""}
                      {o.collectedAt ? ` · collected ${formatNz(o.collectedAt)}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {o.status === "reserved_cash" && (
                      <>
                        <form action={cashCollected.bind(null, o.id)}>
                          <SubmitButton loadingText="Saving…" style={{ ...btn, padding: "10px 14px" }} confirmMessage={`Received ${money(o.totalCents)} cash from ${o.name || o.email} and handed over the item?`}>
                            Paid cash &amp; collected
                          </SubmitButton>
                        </form>
                        <form action={cancel.bind(null, o.id)}>
                          <SubmitButton loadingText="…" style={btnSecondary} confirmMessage="Cancel this reservation and put the item back in stock?">
                            Cancel
                          </SubmitButton>
                        </form>
                      </>
                    )}
                    {o.status === "paid" && (
                      <form action={collected.bind(null, o.id)}>
                        <SubmitButton loadingText="Saving…" style={{ ...btn, padding: "10px 14px" }}>
                          Collected
                        </SubmitButton>
                      </form>
                    )}
                    {(o.status === "paid" || o.status === "collected") && o.method === "card" && (
                      <form action={refund.bind(null, o.id)}>
                        <SubmitButton loadingText="…" style={btnDanger} confirmMessage={`Refund ${money(o.totalCents)} to ${o.name || o.email}'s card?`}>
                          Refund
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {products.map((p) => (
        <section key={p.id} id={`product-${p.id}`} style={card}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
            {p.images[0] && <img src={p.images[0]} alt="" width={96} height={96} style={{ objectFit: "cover", borderRadius: 8, background: "#eee" }} />}
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>
                {p.nameEn} {!p.active && <span style={pill("#eee", "#666")}>Not on sale</span>} {p.active && p.available === 0 && <span style={pill("#fdecec", "#a12a2a")}>Sold out: hidden from players</span>}
              </h2>
              <div style={{ fontSize: 13, color: "#666" }}>
                {money(p.priceCents)} · {p.available} available · {p.variants.reduce((s, v) => s + v.sold, 0)} sold
              </div>
              <AdminLink href={editing === p.id ? "/admin/shop" : `/admin/shop?edit=${p.id}#product-${p.id}`} style={{ fontSize: 13 }}>
                {editing === p.id ? "Close editor" : "Edit details & photos"}
              </AdminLink>
            </div>
          </div>
          {editing === p.id && (
            <div style={{ marginTop: 12 }}>
              <ProductForm product={p} />
            </div>
          )}
          <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Stock per size</h3>
          <StockGrid product={p} />
          {p.hasFit && (
            <>
              <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Size charts</h3>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {(["men", "women"] as const).map((fit) => {
                  const url = fit === "men" ? p.sizeChartMen : p.sizeChartWomen;
                  return (
                    <div key={fit} style={{ fontSize: 13 }}>
                      <strong>{fit === "men" ? "Men's" : "Women's"}:</strong>{" "}
                      {url ? (
                        <>
                          <a href={url} target="_blank" rel="noopener">
                            view
                          </a>{" "}
                          <form action={removeSizeChart.bind(null, p.id, fit)} style={{ display: "inline" }}>
                            <SubmitButton loadingText="Removing…" style={{ ...btnSecondary, padding: "2px 8px", fontSize: 12 }}>
                              Remove
                            </SubmitButton>
                          </form>
                        </>
                      ) : (
                        <span style={{ color: "#888" }}>none yet (players see “Size guide coming soon”)</span>
                      )}
                      {publicBlobConfigured() && (
                        <form action={uploadSizeChart.bind(null, p.id, fit)} style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <input name="chart" type="file" accept="image/*" required />
                          <SubmitButton loadingText="Uploading…" style={btnSecondary}>
                            Upload
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      ))}

      <section style={card}>
        {editing === "new" ? (
          <>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>New product</h2>
            <ProductForm product={null} />
          </>
        ) : (
          <AdminLink href="/admin/shop?edit=new#new" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
            + Add a product
          </AdminLink>
        )}
      </section>
    </div>
  );
}
