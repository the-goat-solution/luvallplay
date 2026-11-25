// My photos: the list, sharing (prepared on the device, uploaded straight to
// the club's photo store, then registered and checked), and deleting.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResponseOf } from "@luvallplay/api/contract";
import { API_PREFIX } from "@luvallplay/api/routes";
import { apiForClub, clubHost, store } from "../../app.ts";
import { useCurrentClub, usePrefs } from "../../hooks.tsx";

export type MyPhotos = ResponseOf<"photos.list">;
export type PhotoStatus = MyPhotos["photos"][number]["status"];

function useClub() {
  const { token } = usePrefs();
  const { current, slug, config } = useCurrentClub();
  const on = !!config && config.modules.includes("gallery");
  return { token, slug: slug as string, current, ready: !!token && !!slug && !!current && on, api: apiForClub(current?.apiBase) };
}

export function usePhotos() {
  const { token, slug, ready, api } = useClub();
  return useQuery({ queryKey: ["photos", slug, token], queryFn: ({ signal }) => api.photos.list({ club: slug }, { signal }), enabled: ready, staleTime: 30_000 });
}

export function useDeletePhoto() {
  const { slug, api } = useClub();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.photos.delete({ club: slug, id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["photos"] }),
  });
}

/** Shares one photo; resolves to its status after the check. */
export function useSharePhoto() {
  const { slug, current, api } = useClub();
  return async (file: File, opts: { playerId: number; index: number; caption: string; presigned: boolean }): Promise<PhotoStatus> => {
    const [blob, { preparePhoto }] = await Promise.all([import("@vercel/blob/client"), import("../../lib/image-prep.ts")]);
    const prepared = await preparePhoto(file);
    const token = store.get().token;
    const upload = opts.presigned ? blob.uploadPresigned : blob.upload;
    const common = {
      access: "public" as const,
      handleUploadUrl: `${clubHost(current?.apiBase) || window.location.origin}${API_PREFIX}/clubs/${encodeURIComponent(slug)}/me/photos/upload`,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    };
    const base = `photos/${opts.playerId}/${Date.now()}-${opts.index}`;
    const ext = (b: Blob) => (b.type === "image/webp" ? "webp" : "jpg");
    const [original, display, thumb] = await Promise.all([
      upload(`${base}-original.jpg`, prepared.original, { ...common, multipart: !opts.presigned && prepared.original.size > 8 * 1024 * 1024 }),
      upload(`${base}-display.${ext(prepared.display)}`, prepared.display, common),
      upload(`${base}-thumb.${ext(prepared.thumb)}`, prepared.thumb, common),
    ]);
    const r = await api.photos.add({ club: slug }, {
      originalUrl: original.url,
      displayUrl: display.url,
      thumbUrl: thumb.url,
      width: prepared.width,
      height: prepared.height,
      bytes: prepared.original.size + prepared.display.size + prepared.thumb.size,
      caption: opts.caption.trim() || null,
      consent: true,
    });
    return r.status;
  };
}
