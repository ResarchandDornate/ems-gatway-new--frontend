"use client";

/**
 * BottomSheet and Modal — the two overlay surfaces.
 *
 * Both are glass, both trap focus, both close on Escape and on a scrim tap.
 * The sheet is the default on mobile: it arrives from the thumb end of the
 * screen and can be dismissed without reaching for a corner.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

function useDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    // Prevent the page behind from scrolling under the sheet.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

/** Portals into the mobile root so the sheet inherits `.m-root` tokens. */
function Portal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  const host = document.querySelector(".m-root") ?? document.body;
  return createPortal(children, host);
}

export function BottomSheet({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useDismiss(open, onClose);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (!open) return null;

  return (
    <Portal>
      <div className="m-scrim" onClick={onClose} aria-hidden />
      <div
        className="m-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <span className="m-sheet-grip" aria-hidden />
        <div className="m-spread" style={{ padding: "0 4px 14px" }}>
          <span className="m-h2 m-ink">{title}</span>
          <button className="m-iconbtn" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div style={{ overflowY: "auto", overscrollBehavior: "contain" }}>{children}</div>
      </div>
    </Portal>
  );
}

export function Modal({
  open, onClose, title, children, footer,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useDismiss(open, onClose);
  if (!open) return null;

  return (
    <Portal>
      <div className="m-scrim" onClick={onClose} aria-hidden />
      <div className="m-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="m-h2 m-ink" style={{ marginBottom: 10 }}>{title}</div>
        <div className="m-body m-ink2">{children}</div>
        {footer && <div style={{ display: "flex", gap: 10, marginTop: 22 }}>{footer}</div>}
      </div>
    </Portal>
  );
}
