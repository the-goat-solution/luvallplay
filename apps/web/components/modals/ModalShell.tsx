"use client";

import { useEffect, type ReactNode } from "react";

export function ModalShell({
  id,
  open,
  onClose,
  title,
  children,
  footer,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={`modal-bg${open ? " open" : ""}`}
      id={id}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3 className="modal-title">{title}</h3>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function StepBar({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <div className="steps-bar">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={[
            "step-seg",
            i < step - 1 ? "done" : "",
            i === step - 1 ? "active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ))}
    </div>
  );
}

export { StepBar };
