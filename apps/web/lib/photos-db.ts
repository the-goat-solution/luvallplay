import { sql } from "./database";

// Photos players share from their profile. Approved photos join the main
// site Gallery pool. Every upload is checked by Google Cloud Vision
// SafeSearch first (lib/photo-moderation.ts); anything unchecked or doubtful
// waits for an admin, and blocked photos never appear anywhere public.
//
// A photo also says what it is for (`purpose`, migration 0024): the Gallery
// (every photo shared from a profile), a Social post or a Marketplace
// listing. Everything about the Gallery here (the public pool, "my photos",
// the 20 a day, a player's own delete, featuring) reads Gallery photos only.
// The admin's review (the lists, the count, approve and block, the storage
// total) covers every purpose: a held photo for a post waits in the same
// queue. Photos for posts and listings are written by lib/social/photos.ts.

export const PHOTOS_PER_DAY = 20;

export type PhotoStatus = "pending" | "approved" | "needs_review" | "rejected" | "hidden";
export type PhotoPurpose = "gallery" | "social" | "market";

export type Photo = {
  id: number;
  playerId: number;
  originalUrl: string;
  displayUrl: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  bytes: number;
  status: PhotoStatus;
  purpose: PhotoPurpose;
  safesearch: Record<string, string> | null;
  caption: string | null;
  featured: boolean;
  createdAt: string;
  reviewedAt: string | null;
};

type PhotoRow = {
  id: number;
  player_id: number;
  original_url: string;
  display_url: string;
  thumb_url: string;
  width: number | null;
  height: number | null;
  bytes: string | number;
  status: string;
  purpose: string;
  safesearch: Record<string, string> | null;
  caption: string | null;
  featured: boolean;
  created_at: Date;
  reviewed_at: Date | null;
};

function mapPhoto(r: PhotoRow): Photo {
  return {
    id: r.id,
    playerId: r.player_id,
    originalUrl: r.original_url,
    displayUrl: r.display_url,
    thumbUrl: r.thumb_url,
    width: r.width,
    height: r.height,
    bytes: Number(r.bytes),
    status: r.status as PhotoStatus,
    purpose: r.purpose as PhotoPurpose,
    safesearch: r.safesearch,
    caption: r.caption,
    featured: r.featured,
    createdAt: new Date(r.created_at).toISOString(),
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
  };
}

/** How many Gallery photos this player shared in the last day (photos for posts and listings have their own count). */
export async function countPhotosToday(playerId: number): Promise<number> {
  const { rows } = await sql`
    SELECT count(*)::int AS n FROM player_photos
    WHERE player_id = ${playerId} AND purpose = 'gallery' AND created_at > NOW() - INTERVAL '24 hours';
  `;
  return (rows[0]?.n as number) ?? 0;
}

/** Stores a Gallery photo (the purpose is the column's default). */
export async function insertPhoto(input: {
  playerId: number;
  originalUrl: string;
  displayUrl: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  bytes: number;
  caption: string | null;
}): Promise<number> {
  const { rows } = await sql`
    INSERT INTO player_photos (player_id, original_url, display_url, thumb_url, width, height, bytes, caption, consent_at)
    VALUES (${input.playerId}, ${input.originalUrl}, ${input.displayUrl}, ${input.thumbUrl}, ${input.width}, ${input.height},
      ${input.bytes}, ${input.caption}, NOW())
    RETURNING id;
  `;
  return rows[0].id as number;
}

export async function setPhotoModeration(id: number, status: PhotoStatus, safesearch: Record<string, string> | null): Promise<void> {
  await sql`
    UPDATE player_photos SET status = ${status}, safesearch = ${safesearch ? JSON.stringify(safesearch) : null}::jsonb
    WHERE id = ${id};
  `;
}

/** A player's own Gallery photos ("My photos"). */
export async function listPhotosForPlayer(playerId: number): Promise<Photo[]> {
  if (!process.env.POSTGRES_URL) return [];
  const { rows } = await sql`
    SELECT * FROM player_photos WHERE player_id = ${playerId} AND purpose = 'gallery' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200;
  `;
  return rows.map((r) => mapPhoto(r as PhotoRow));
}

/** Soft-deletes a player's own Gallery photo; returns its URLs so the files can go too. A photo in a post goes with the post, not from "My photos". */
export async function deletePlayerPhoto(playerId: number, id: number): Promise<Photo | null> {
  const { rows } = await sql`
    UPDATE player_photos SET deleted_at = NOW()
    WHERE id = ${id} AND player_id = ${playerId} AND purpose = 'gallery' AND deleted_at IS NULL
    RETURNING *;
  `;
  return rows[0] ? mapPhoto(rows[0] as PhotoRow) : null;
}

export type GalleryPhoto = {
  id: number;
  displayUrl: string;
  thumbUrl: string;
  originalUrl: string;
  caption: string | null;
  credit: string;
  featured: boolean;
};

/** Approved, visible player photos for the main site Gallery. Never a photo uploaded for a post or a listing. */
export async function listGalleryPhotos(limit = 300): Promise<GalleryPhoto[]> {
  if (!process.env.POSTGRES_URL) return [];
  try {
    const { rows } = await sql.query(
      `SELECT ph.id, ph.display_url, ph.thumb_url, ph.original_url, ph.caption, ph.featured,
         coalesce(nullif(trim(p.display_name), ''),
           p.first_name || CASE WHEN p.last_name <> '' THEN ' ' || upper(left(p.last_name, 1)) || '.' ELSE '' END) AS credit
       FROM player_photos ph JOIN players p ON p.id = ph.player_id
       WHERE ph.status = 'approved' AND ph.purpose = 'gallery' AND ph.deleted_at IS NULL AND p.deleted_at IS NULL
       ORDER BY ph.featured DESC, ph.created_at DESC
       LIMIT $1;`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id as number,
      displayUrl: r.display_url as string,
      thumbUrl: r.thumb_url as string,
      originalUrl: r.original_url as string,
      caption: (r.caption as string | null) ?? null,
      credit: (r.credit as string) || "Three Wolves",
      featured: Boolean(r.featured),
    }));
  } catch (err) {
    console.error("[photos] gallery query failed:", err);
    return [];
  }
}

export type AdminPhoto = Photo & { playerName: string; playerEmail: string };

/** The admin's lists, for every purpose: a photo held for a post or a listing is reviewed here too. */
export async function listPhotosForAdmin(filter: "review" | "blocked" | "approved" | "hidden"): Promise<AdminPhoto[]> {
  const statuses =
    filter === "review" ? ["needs_review", "pending"] : filter === "blocked" ? ["rejected"] : filter === "hidden" ? ["hidden"] : ["approved"];
  const { rows } = await sql.query(
    `SELECT ph.*, p.email, trim(p.first_name || ' ' || p.last_name) AS player_name
     FROM player_photos ph JOIN players p ON p.id = ph.player_id
     WHERE ph.status = ANY($1::text[]) AND ph.deleted_at IS NULL
     ORDER BY ph.created_at DESC LIMIT 300;`,
    [statuses],
  );
  return rows.map((r) => ({
    ...mapPhoto(r as PhotoRow),
    playerName: (r.player_name as string) || (r.email as string),
    playerEmail: r.email as string,
  }));
}

/** Photos waiting for an admin, for every purpose. */
export async function countPhotosNeedingReview(): Promise<number> {
  if (!process.env.POSTGRES_URL) return 0;
  const { rows } = await sql`
    SELECT count(*)::int AS n FROM player_photos WHERE status IN ('needs_review', 'pending') AND deleted_at IS NULL;
  `;
  return (rows[0]?.n as number) ?? 0;
}

export async function adminSetPhotoStatus(id: number, status: PhotoStatus): Promise<void> {
  await sql`UPDATE player_photos SET status = ${status}, reviewed_at = NOW(), reviewed_by = 'admin' WHERE id = ${id};`;
}

/** Featured means "first in the Gallery", so only a Gallery photo can be. */
export async function adminSetFeatured(id: number, featured: boolean): Promise<void> {
  await sql`UPDATE player_photos SET featured = ${featured} WHERE id = ${id} AND purpose = 'gallery';`;
}

export async function getPhotoById(id: number): Promise<Photo | null> {
  const { rows } = await sql`SELECT * FROM player_photos WHERE id = ${id};`;
  return rows[0] ? mapPhoto(rows[0] as PhotoRow) : null;
}

/** Bytes stored, for every purpose: they all sit in the same store. */
export async function photoStorageBytes(): Promise<number> {
  const { rows } = await sql`SELECT coalesce(sum(bytes), 0)::bigint AS b FROM player_photos WHERE deleted_at IS NULL;`;
  return Number(rows[0]?.b ?? 0);
}
