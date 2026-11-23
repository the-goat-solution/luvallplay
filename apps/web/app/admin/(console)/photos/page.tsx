import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AdminLink } from "@/components/admin/AdminLink";
import { SubmitButton } from "@/components/admin/SubmitButton";
import adminStyles from "@/components/admin/admin.module.css";
import { btn, btnDanger, btnSecondary, card, formatNz, pill } from "@/components/admin/ui";
import {
  adminSetFeatured,
  adminSetPhotoStatus,
  getPhotoById,
  listPhotosForAdmin,
  photoStorageBytes,
  type PhotoStatus,
} from "@/lib/photos-db";
import { createThread } from "@/lib/messages-db";
import { getPlayerById } from "@/lib/player-db";
import { notifyPlayerOfReply } from "@/lib/message-notify";
import { publicBlobConfigured } from "@/lib/public-blob";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "review", label: "Needs review" },
  { key: "blocked", label: "Blocked" },
  { key: "approved", label: "In Gallery" },
  { key: "hidden", label: "Hidden" },
] as const;
type Tab = (typeof TABS)[number]["key"];

// Free Hobby allowance for Vercel Blob; switch to Cloudflare R2 past ~700 MB.
const STORAGE_FREE_BYTES = 1024 * 1024 * 1024;

async function setStatus(id: number, status: PhotoStatus, tab: Tab) {
  "use server";
  await adminSetPhotoStatus(id, status);
  revalidatePath("/admin/photos");
  revalidatePath("/");
  revalidatePath("/gallery");
  const label = status === "approved" ? "Approved: it's in the Gallery." : status === "rejected" ? "Blocked." : "Hidden from the Gallery.";
  redirect(`/admin/photos?tab=${tab}&toast=${encodeURIComponent(label)}`);
}

async function feature(id: number, on: boolean, tab: Tab) {
  "use server";
  await adminSetFeatured(id, on);
  revalidatePath("/");
  redirect(`/admin/photos?tab=${tab}&toast=${encodeURIComponent(on ? "Featured: shown first in the Gallery." : "No longer featured.")}`);
}

async function messageUploader(id: number) {
  "use server";
  const photo = await getPhotoById(id);
  const player = photo ? await getPlayerById(photo.playerId) : null;
  if (!photo || !player) redirect("/admin/photos?toastError=" + encodeURIComponent("Player not found."));
  const subject = "About a photo you shared";
  const body =
    player.lang === "vi"
      ? "Chào bạn, chúng tôi muốn trao đổi về một ảnh bạn đã chia sẻ trên Three Wolves."
      : "Hi! We'd like to talk about a photo you shared on Three Wolves.";
  const threadId = await createThread({ playerId: player.id, subject, body, startedBy: "admin" });
  await notifyPlayerOfReply({ to: player.email, lang: player.lang, threadId, subject, body });
  redirect(`/admin/inbox/${threadId}?toast=${encodeURIComponent("Conversation started. Add more detail below.")}`);
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
        <h1 className={adminStyles.title}>Photos</h1>
        <p>Database is not configured.</p>
      </div>
    );
  }
  const [photos, used] = await Promise.all([listPhotosForAdmin(tab), photoStorageBytes()]);
  const pct = Math.round((used / STORAGE_FREE_BYTES) * 100);

  return (
    <div className={adminStyles.page}>
      <h1 className={adminStyles.title}>Photos</h1>
      <p className={adminStyles.subtitle}>
        Photos players share from their profile. Google SafeSearch checks each one: clear photos go straight to the Gallery, doubtful ones wait here, and
        inappropriate ones are blocked (and you get an email).
      </p>

      <p style={{ fontSize: 13, color: pct > 70 ? "#a12a2a" : "#666", marginTop: 0 }}>
        Storage used: {mb(used)} of the free 1 GB ({pct}%).
        {pct > 70 ? " Time to move photos to Cloudflare R2 (10 GB free) — see the README." : ""}
        {!publicBlobConfigured() && " Photo sharing is off until the public Blob store is connected (prefix PHOTO)."}
        {process.env.GOOGLE_VISION_ENABLED !== "1" && " SafeSearch is off (GOOGLE_VISION_ENABLED), so every photo waits for review."}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <AdminLink
            key={t.key}
            href={`/admin/photos?tab=${t.key}`}
            style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid #ccc", textDecoration: "none", fontSize: 13, background: t.key === tab ? "#1a2a4a" : "#fff", color: t.key === tab ? "#fff" : "#333" }}
          >
            {t.label}
          </AdminLink>
        ))}
      </div>

      {photos.length === 0 ? (
        <p style={{ color: "#888" }}>Nothing here.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {photos.map((ph) => (
            <div key={ph.id} style={{ ...card, padding: 10, marginBottom: 0 }}>
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
                <strong>{ph.playerName}</strong> {ph.featured && <span style={pill("#fff4e5", "#8a4b00")}>Featured</span>}
                <div style={{ color: "#888", fontSize: 12 }}>{formatNz(ph.createdAt, true)}</div>
                {ph.caption && <div style={{ color: "#555", marginTop: 4 }}>“{ph.caption}”</div>}
                {ph.safesearch && (
                  <div style={{ color: "#888", fontSize: 11, marginTop: 4 }}>
                    {Object.entries(ph.safesearch)
                      .filter(([k]) => ["adult", "racy", "violence"].includes(k))
                      .map(([k, v]) => `${k}: ${v.toLowerCase().replace("_", " ")}`)
                      .join(" · ")}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {ph.status !== "approved" && (
                  <form action={setStatus.bind(null, ph.id, "approved", tab)}>
                    <SubmitButton loadingText="…" style={btn} confirmMessage={ph.status === "rejected" ? "This photo was blocked by SafeSearch. Approve it for the Gallery anyway?" : undefined}>
                      Approve
                    </SubmitButton>
                  </form>
                )}
                {ph.status === "approved" && (
                  <>
                    <form action={feature.bind(null, ph.id, !ph.featured, tab)}>
                      <SubmitButton loadingText="…" style={btnSecondary}>
                        {ph.featured ? "Unfeature" : "Feature"}
                      </SubmitButton>
                    </form>
                    <form action={setStatus.bind(null, ph.id, "hidden", tab)}>
                      <SubmitButton loadingText="…" style={btnSecondary}>
                        Hide
                      </SubmitButton>
                    </form>
                  </>
                )}
                {ph.status !== "rejected" && (
                  <form action={setStatus.bind(null, ph.id, "rejected", tab)}>
                    <SubmitButton loadingText="…" style={btnDanger}>
                      Block
                    </SubmitButton>
                  </form>
                )}
                <form action={messageUploader.bind(null, ph.id)}>
                  <SubmitButton loadingText="…" style={btnSecondary}>
                    Message uploader
                  </SubmitButton>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
