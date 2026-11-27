import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminLink } from "@/components/admin/AdminLink";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { formatNz } from "@/components/admin/ui";
import { Badge, EmptyState, Notice, PageHeader, Tabs, kit } from "@/components/admin/kit";
import { attentionCount } from "@/lib/admin-attention";
import {
  adminSetFeatured,
  adminSetPhotoStatus,
  listPhotosForAdmin,
  photoStorageBytes,
  type PhotoPurpose,
  type PhotoStatus,
} from "@/lib/photos-db";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "review", label: "Needs review" },
  { key: "approved", label: "In the Gallery" },
  { key: "hidden", label: "Hidden" },
  { key: "blocked", label: "Blocked" },
] as const;
type Tab = (typeof TABS)[number]["key"];

// Free Hobby allowance for Vercel Blob; switch to Cloudflare R2 past ~700 MB
// (System check has the details).
const STORAGE_FREE_BYTES = 1024 * 1024 * 1024;

const LIKELIHOOD: Record<string, string> = {
  VERY_UNLIKELY: "very unlikely",
  UNLIKELY: "unlikely",
  POSSIBLE: "possible",
  LIKELY: "likely",
  VERY_LIKELY: "very likely",
  UNKNOWN: "unknown",
};
const CHECK_LABEL: Record<string, string> = { adult: "Adult content", racy: "Racy", violence: "Violence" };
// A photo uploaded for a post or a listing is reviewed here and never joins the Gallery.
const PURPOSE_LABEL: Record<Exclude<PhotoPurpose, "gallery">, string> = { social: "For a post", market: "For a listing" };

async function setStatus(id: number, status: PhotoStatus, tab: Tab, purpose: PhotoPurpose) {
  "use server";
  await adminSetPhotoStatus(id, status);
  revalidatePath("/admin/photos");
  if (purpose === "gallery") {
    revalidatePath("/");
    revalidatePath("/gallery");
  }
  const label =
    purpose === "gallery"
      ? status === "approved" ? "Approved: it's in the Gallery." : status === "rejected" ? "Blocked." : "Hidden from the Gallery."
      : status === "approved" ? "Approved: it can be shown." : status === "rejected" ? "Blocked." : "Hidden.";
  redirect(`/admin/photos?tab=${tab}&toast=${encodeURIComponent(label)}`);
}

async function feature(id: number, on: boolean, tab: Tab) {
  "use server";
  await adminSetFeatured(id, on);
  revalidatePath("/");
  redirect(`/admin/photos?tab=${tab}&toast=${encodeURIComponent(on ? "Featured: shown first in the Gallery." : "No longer featured.")}`);
}

function mb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export default async function PhotosAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS.map((t) => t.key) as string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "review";
  if (!process.env.POSTGRES_URL) {
    return (
      <div className={adminStyles.page}>
        <PageHeader title="Photos" />
        <EmptyState>Database is not configured.</EmptyState>
      </div>
    );
  }
  const [photos, used, toReview] = await Promise.all([listPhotosForAdmin(tab), photoStorageBytes(), attentionCount("photos")]);
  const pct = Math.round((used / STORAGE_FREE_BYTES) * 100);
  const EMPTY: Record<Tab, string> = {
    review: "Nothing waiting for review.",
    approved: "No photos in the Gallery yet.",
    hidden: "No hidden photos.",
    blocked: "No blocked photos.",
  };

  return (
    <div className={adminStyles.page}>
      <PageHeader
        title="Photos"
        subtitle="Photos players share from their profile. An automatic safety check sends clear ones straight to the Gallery; doubtful ones wait here for you."
      />
      {pct > 70 && (
        <Notice>
          Photo storage is {pct}% full ({mb(used)} of the free 1 GB). See <AdminLink href="/admin/setup">System check</AdminLink> for what to do.
        </Notice>
      )}

      <Tabs
        label="Photos"
        current={tab}
        items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/admin/photos?tab=${t.key}`, count: t.key === "review" ? toReview : undefined }))}
      />
      <p className={kit.muted} style={{ fontSize: 13, marginTop: -6 }}>
        <strong>Hidden</strong>: taken out of the Gallery by an admin. <strong>Blocked</strong>: flagged as inappropriate; the uploader can&apos;t see it in
        the Gallery and it stays blurred here.
      </p>

      {photos.length === 0 ? (
        <EmptyState>{EMPTY[tab]}</EmptyState>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {photos.map((ph) => {
            const checks = ph.safesearch ? Object.entries(ph.safesearch).filter(([k]) => k in CHECK_LABEL) : [];
            return (
              <div key={ph.id} className={kit.section} style={{ padding: 10, marginBottom: 0 }}>
                <a href={ph.displayUrl} target="_blank" rel="noopener">
                  <img
                    src={ph.thumbUrl}
                    alt={ph.caption ?? ""}
                    loading="lazy"
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      objectFit: "cover",
                      borderRadius: 6,
                      // Blocked photos are blurred until you choose to open them.
                      filter: ph.status === "rejected" ? "blur(18px)" : undefined,
                    }}
                  />
                </a>
                <div style={{ fontSize: 13, marginTop: 8 }}>
                  <strong>{ph.playerName}</strong> {ph.featured && <Badge tone="warn">Featured</Badge>}
                  {ph.purpose !== "gallery" && <Badge>{PURPOSE_LABEL[ph.purpose]}</Badge>}
                  <span className={kit.sub}>{formatNz(ph.createdAt, true)}</span>
                  {ph.caption && <div style={{ color: "#555", marginTop: 4 }}>&ldquo;{ph.caption}&rdquo;</div>}
                  {checks.length > 0 && (
                    <details style={{ marginTop: 4 }}>
                      <summary className={kit.muted} style={{ cursor: "pointer" }}>
                        Why is it here?
                      </summary>
                      <div className={kit.muted} style={{ marginTop: 4 }}>
                        Safety check:{" "}
                        {checks.map(([k, v]) => `${CHECK_LABEL[k]} ${LIKELIHOOD[String(v)] ?? String(v).toLowerCase()}`).join(" · ")}
                      </div>
                    </details>
                  )}
                </div>
                <div className={kit.rowActions} style={{ marginTop: 8 }}>
                  {ph.status !== "approved" && (
                    <form action={setStatus.bind(null, ph.id, "approved", tab, ph.purpose)}>
                      <SubmitButton
                        className={kit.btn}
                        loadingText="Saving…"
                        confirmMessage={
                          ph.status !== "rejected"
                            ? undefined
                            : ph.purpose === "gallery"
                              ? "This photo was blocked as inappropriate. Put it in the Gallery anyway?"
                              : "This photo was blocked as inappropriate. Approve it anyway?"
                        }
                      >
                        Approve
                      </SubmitButton>
                    </form>
                  )}
                  {ph.status === "approved" && (
                    <>
                      {ph.purpose === "gallery" && (
                        <form action={feature.bind(null, ph.id, !ph.featured, tab)}>
                          <SubmitButton className={kit.btnSecondary} loadingText="Saving…">
                            {ph.featured ? "Unfeature" : "Feature"}
                          </SubmitButton>
                        </form>
                      )}
                      <form action={setStatus.bind(null, ph.id, "hidden", tab, ph.purpose)}>
                        <SubmitButton
                          className={kit.btnSecondary}
                          loadingText="Saving…"
                          confirmMessage={ph.purpose === "gallery" ? "Take this photo out of the Gallery?" : "Hide this photo? It drops out of the post or listing it is in."}
                        >
                          Hide
                        </SubmitButton>
                      </form>
                    </>
                  )}
                  {ph.status !== "rejected" && (
                    <form action={setStatus.bind(null, ph.id, "rejected", tab, ph.purpose)}>
                      <SubmitButton className={kit.btnDanger} loadingText="Saving…" confirmMessage="Block this photo as inappropriate?">
                        Block
                      </SubmitButton>
                    </form>
                  )}
                  <AdminLink
                    href={`/admin/inbox?to=${encodeURIComponent(ph.playerEmail)}&subject=${encodeURIComponent("About a photo you shared")}#new`}
                    className={kit.btnSecondary}
                  >
                    Message uploader
                  </AdminLink>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
