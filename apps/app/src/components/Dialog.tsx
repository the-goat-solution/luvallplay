// The app's modal: a native <dialog> that opens with its content and closes
// with Escape. Shared by every screen (the Arena, membership, the calendar,
// the shop), so it stays small and imports nothing of theirs.
import { useEffect, useRef, type ReactNode } from "react";

/**
 * A modal <dialog> that opens with its content and closes with Escape. On
 * closing, focus goes back to what opened it: the browser would do that on
 * close(), but React has already taken the dialog out of the page by then.
 */
export function Dialog({ label, onClose, children, className }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (d && !d.open) d.showModal();
    return () => {
      d?.close();
      if (opener?.isConnected && !d?.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={ref} className={`dialog${className ? ` ${className}` : ""}`} aria-label={label} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="stack">{children}</div>
    </dialog>
  );
}
