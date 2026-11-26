// The screen shown when a screen itself fails (an error while drawing it, or
// its code couldn't be fetched): said plainly, with "Try again" and "Reload
// the app". Without it the router showed its bare error text.
//
// After an update, a screen's code file from the build this page was loaded
// with may be gone from the server. The router reloads the page once for
// that by itself; if the file still can't be fetched, this screen shows, and
// "Try again" reloads (asking for the same file again can't work).
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useT } from "../hooks.tsx";

/** A screen's code file couldn't be fetched (each browser's own wording). */
export function isChunkError(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message ?? error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS/i.test(text);
}

export function Crash({ error, reset }: ErrorComponentProps) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="crash" data-testid="crash">
      <div className="card stack" role="alert">
        <h1>{t("crash_title")}</h1>
        <p className="muted">{t("crash_text")}</p>
        <div className="actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              if (isChunkError(error)) return location.reload();
              reset();
              void router.invalidate();
            }}
          >
            {t("retry")}
          </button>
          <button type="button" className="button" onClick={() => location.reload()}>{t("crash_reload")}</button>
        </div>
      </div>
    </div>
  );
}
