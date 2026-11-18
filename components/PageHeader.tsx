"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * The one page header every route opens with: title and an optional status pill
 * on the left, the page's framing figures on the right, on a single row.
 *
 * The description a page used to print under its title goes in `info` instead,
 * behind an icon, so every header is the same height whatever the page has to say.
 * Stats are passed as children, using the `.ps-stat-k` / `.ps-stat-v` pair or
 * <PageStat>.
 */
export function PageHeader({
  title,
  status,
  info,
  children,
}: {
  title: ReactNode;
  status?: ReactNode;
  info?: string;
  children?: ReactNode;
}) {
  return (
    <div className="surface-card ps-hero">
      <div className="ps-hero-id">
        <h1 className="ps-hero-title">{title}</h1>
        {status}
        {info && <InfoPopover text={info} />}
      </div>
      {children && <div className="ps-hero-stats">{children}</div>}
    </div>
  );
}

/** Opens on click or tap, closes on a second tap, outside tap or Escape. A
 *  native `title` tooltip would never show on a touch screen. */
function InfoPopover({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="ps-hero-info"
    >
      <button
        type="button"
        aria-label="About this page"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={14} strokeWidth={2} />
      </button>
      {open && <span role="tooltip" className="ps-hero-pop">{text}</span>}
    </span>
  );
}

export function PageStat({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div>
      <div className="ps-stat-k">{label}</div>
      <div className="ps-stat-v" style={{ color: color ?? "var(--ink)" }}>{value}</div>
    </div>
  );
}
