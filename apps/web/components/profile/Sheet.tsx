"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./profile.module.css";

const noopSubscribe = () => () => {};
const clientTrue = () => true;
const serverFalse = () => false;

/**
 * Bottom sheet on phones (swipe down to close), centred dialog on tablets.
 * Traps focus while open, closes on Escape or a tap on the backdrop.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  labelledBy,
  header,
  onHoldChange,
  dismissible = true,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  labelledBy?: string;
  /** Rendered above the title, e.g. a progress bar. */
  header?: ReactNode;
  /** Called with true while a finger/pointer is held on the sheet. */
  onHoldChange?: (holding: boolean) => void;
  dismissible?: boolean;
  /** Tablets: a wider dialog (the inbox's list + thread side by side). */
  wide?: boolean;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  // false on the server and during hydration (no document.body to portal into).
  const mounted = useSyncExternalStore(noopSubscribe, clientTrue, serverFalse);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => {
      const first = sheetRef.current?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      first?.focus({ preventScroll: true });
    }, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
      if (e.key === "Tab" && sheetRef.current) {
        const items = Array.from(
          sheetRef.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])",
          ),
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, dismissible]);

  if (!open || !mounted) return null;

  const onTouchStart = (e: React.TouchEvent) => {
    onHoldChange?.(true);
    // Only start a swipe-to-close from the top of the sheet's scroll.
    if ((sheetRef.current?.scrollTop ?? 0) <= 0) dragStart.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStart.current === null || !dismissible) return;
    const dy = e.touches[0].clientY - dragStart.current;
    setDragY(dy > 0 ? dy : 0);
  };
  const onTouchEnd = () => {
    onHoldChange?.(false);
    if (dragY > 110 && dismissible) onClose();
    dragStart.current = null;
    setDragY(0);
  };

  return createPortal(
    <div
      className={styles.sheetBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={`${styles.sheet} ${wide ? styles.sheetWide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onMouseDown={() => onHoldChange?.(true)}
        onMouseUp={() => onHoldChange?.(false)}
        onMouseLeave={() => onHoldChange?.(false)}
      >
        {header}
        <div className={styles.sheetHandle} aria-hidden="true" />
        {dismissible && (
          <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
        {title && (
          <h2 id={titleId} className={styles.sheetTitle}>
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
