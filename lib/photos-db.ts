import { sql } from "@vercel/postgres";
import { ensurePlayerTables } from "./player-db";
import { onceThisDeploy } from "./schema-gate";

// Photos players share from their profile. Approved photos join the main
// site Gallery pool. Every upload is checked by Google Cloud Vision
// SafeSearch first (lib/photo-moderation.ts); anything unchecked or doubtful
// waits for an admin, and blocked photos never appear anywhere public.

let ensurePromise: Promise<void> | null = null;

export function ensurePhotoTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = onceThisDeploy("photos", async () => {
      await ensurePlayerTables();
      await sql`
        CREATE TABLE IF NOT EXISTS player_photos (
          id SERIAL PRIMARY KEY,
          player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          original_url TEXT NOT NULL,
          display_url TEXT NOT NULL,
          thumb_url TEXT NOT NULL,
          width INT,
          height INT,
          bytes BIGINT NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'approved', 'needs_review', 'rejected', 'hidden')),
          safesearch JSONB,
          caption TEXT,
          featured BOOLEAN NOT NULL DEFAULT FALSE,
          consent_at TIMESTAMPTZ NOT NULL,
          reviewed_at TIMESTAMPTZ,
          reviewed_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at TIMESTAMPTZ
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS player_photos_player_idx ON player_photos (player_id, created_at DESC);`;
      await sql`CREATE INDEX IF NOT EXISTS player_photos_status_idx ON player_photos (status, created_at DESC);`;
    }).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

export const PHOTOS_PER_DAY = 20;

export type PhotoStatus = "pending" | "approved" | "needs_review" | "rejected" | "hidden";

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
    safesearch: r.safesearch,
    caption: r.caption,
    featured: r.featured,
    createdAt: new Date(r.created_at).toISOString(),
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
  };
}

export async function countPhotosToday(playerId: number): Promise<number> {
  await ensurePhotoTables();
  const { rows } = await sql`
    SELECT count(*)::int AS n FROM player_photos
    WHERE player_id = ${playerId} AND created_at > NOW() - INTERVAL '24 hours';
  `;
  return (rows[0]?.n as number) ?? 0;
}

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
  await ensurePhotoTables();
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

export async function listPhotosForPlayer(playerId: number): Promise<Photo[]> {
  if (!process.env.POSTGRES_URL) return [];
  await ensurePhotoTables();
  const { rows } = await sql`
    SELECT * FROM player_photos WHERE player_id = ${playerId} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200;
  `;
  return rows.map((r) => mapPhoto(r as PhotoRow));
}

/** Soft-deletes a player's own photo; returns its URLs so the files can go too. */
export async function deletePlayerPhoto(playerId: number, id: number): Promise<Photo | null> {
  await ensurePhotoTables();
  const { rows } = await sql`
    UPDATE player_photos SET deleted_at = NOW()
    WHERE id = ${id} AND player_id = ${playerId} AND deleted_at IS NULL
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

/** Approved, visible player photos for the main site Gallery. */
export async function listGalleryPhotos(limit = 300): Promise<GalleryPhoto[]> {
  if (!process.env.POSTGRES_URL) return [];
  try {
    await ensurePhotoTables();
    const { rows } = await sql.query(
      `SELECT ph.id, ph.display_url, ph.thumb_url, ph.original_url, ph.caption, ph.featured,
         coalesce(nullif(trim(p.display_name), ''),
           p.first_name || CASE WHEN p.last_name <> '' THEN ' ' || upper(left(p.last_name, 1)) || '.' ELSE '' END) AS credit
       FROM player_photos ph JOIN players p ON p.id = ph.player_id
       WHERE ph.status = 'approved' AND ph.deleted_at IS NULL AND p.deleted_at IS NULL
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

export async function listPhotosForAdmin(filter: "review" | "blocked" | "approved" | "hidden"): Promise<AdminPhoto[]> {
  await ensurePhotoTables();
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

export async function countPhotosNeedingReview(): Promise<number> {
  if (!process.env.POSTGRES_URL) return 0;
  await ensurePhotoTables();
  const { rows } = await sql`
    SELECT count(*)::int AS n FROM player_photos WHERE status IN ('needs_review', 'pending') AND deleted_at IS NULL;
  `;
  return (rows[0]?.n as number) ?? 0;
}

export async function adminSetPhotoStatus(id: number, status: PhotoStatus): Promise<void> {
  await ensurePhotoTables();
  await sql`UPDATE player_photos SET status = ${status}, reviewed_at = NOW(), reviewed_by = 'admin' WHERE id = ${id};`;
}

export async function adminSetFeatured(id: number, featured: boolean): Promise<void> {
  await ensurePhotoTables();
  await sql`UPDATE player_photos SET featured = ${featured} WHERE id = ${id};`;
}

export async function getPhotoById(id: number): Promise<Photo | null> {
  await ensurePhotoTables();
  const { rows } = await sql`SELECT * FROM player_photos WHERE id = ${id};`;
  return rows[0] ? mapPhoto(rows[0] as PhotoRow) : null;
}

export async function photoStorageBytes(): Promise<number> {
  await ensurePhotoTables();
  const { rows } = await sql`SELECT coalesce(sum(bytes), 0)::bigint AS b FROM player_photos WHERE deleted_at IS NULL;`;
  return Number(rows[0]?.b ?? 0);
}
