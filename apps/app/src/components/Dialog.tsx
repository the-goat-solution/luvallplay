// The app's modal: a native <dialog> that opens with its content and closes
// with Escape. Shared by every screen (the Arena, membership, the calendar,
// the shop), so it stays small and imports nothing of theirs.
import { useEffect, useRef, type ReactNode } from "react";

/** A modal <dialog> that opens with its content and closes with Escape. */
export function Dialog({ label, onClose, children, className }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className={`dialog${className ? ` ${className}` : ""}`} aria-label={label} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="stack">{children}</div>
    </dialog>
  );
}
