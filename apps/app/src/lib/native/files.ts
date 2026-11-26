// Handing the person a file (their data export). In a browser that is a
// download. The store app's web view can't download, so there the file is
// written to the app's own cache and offered through the phone's share
// sheet: save to Files or Drive, send by email, and so on.
import { plugin } from "./platform.ts";

type FilesystemPlugin = { writeFile(options: { path: string; data: string; directory: "CACHE"; encoding: "utf8" }): Promise<{ uri: string }> };
type SharePlugin = { share(options: { title?: string; files: string[] }): Promise<unknown> };
export type FilePlugins = { filesystem: FilesystemPlugin; share: SharePlugin };

function plugins(): FilePlugins | undefined {
  const filesystem = plugin<FilesystemPlugin>("Filesystem");
  const share = plugin<SharePlugin>("Share");
  return filesystem && share ? { filesystem, share } : undefined;
}

/** A plain file name: nothing that could walk out of the cache folder. */
export function safeFileName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "");
  return clean || "file";
}

/** The person closed the share sheet without choosing: not a failure. */
export function isShareCancel(err: unknown): boolean {
  return /cancel/i.test(String((err as { message?: unknown })?.message ?? err));
}

function download(name: string, text: string, mime: string): void {
  const a = document.createElement("a");
  a.href = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

/**
 * Gives the person `text` as a file called `name`: the share sheet in the
 * store app, a download in a browser.
 */
export async function saveFile(name: string, text: string, mime: string, native: FilePlugins | undefined = plugins(), fallback: (name: string, text: string, mime: string) => void = download): Promise<void> {
  const file = safeFileName(name);
  if (!native) return fallback(file, text, mime);
  const { uri } = await native.filesystem.writeFile({ path: file, data: text, directory: "CACHE", encoding: "utf8" });
  try {
    await native.share.share({ title: file, files: [uri] });
  } catch (err) {
    if (!isShareCancel(err)) throw err;
  }
}
