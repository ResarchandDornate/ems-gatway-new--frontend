import { cn } from "@/lib/utils";

/**
 * The dashboard card.
 *
 * Header is title-left / action-right on one baseline (`.card-head`), which is
 * what lets a row of cards align their headings even when their bodies are
 * wildly different heights. Anything passed as `action` — a segmented control,
 * a headline figure, a status pill — sits on that same baseline.
 *
 * `padding={false}` is for content that must bleed to the card's edge, such as
 * a visualisation or a full-bleed table.
 */
export function Card({
  title, subtitle, action, children, className, padding = true, glow = false,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
  glow?: boolean;
}) {
  const hasHead = Boolean(title || action);

  return (
    <div className={cn(
      "surface-card overflow-hidden",
      glow && "shadow-glow-brand-sm",
      className
    )}>
      {hasHead && (
        <div className="card-head">
          <div className="min-w-0">
            {title && <h3 className="card-title truncate">{title}</h3>}
            {subtitle && <p className="card-eyebrow mt-1.5 block">{subtitle}</p>}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn(padding && (hasHead ? "px-[var(--pad)] pb-[var(--pad)] pt-3" : "p-[var(--pad)]"))}>
        {children}
      </div>
    </div>
  );
}

/**
 * A labelled figure. Label sits *under* the value: the number is what the eye
 * is looking for, so it leads and the label confirms what was found.
 */
export function Stat({
  value, label, unit, accent, size = "md",
}: { value: React.ReactNode; label: string; unit?: string; accent?: boolean; size?: "sm" | "md" | "lg" }) {
  const sizeMap = {
    sm: "text-[17px]",
    md: "text-[23px]",
    lg: "text-[30px]",
  };
  return (
    <div>
      <div className={cn(
        // 600, not 700: at these sizes the heavier weight reads as shouting,
        // and the tight tracking is already doing the work of making it solid.
        "font-semibold tracking-[-0.025em] leading-none tabular-nums",
        sizeMap[size],
        accent ? "text-accent" : "text-ink"
      )}>
        {value}
        {unit && <span className="text-[12px] font-medium text-muted ml-1.5 tracking-normal">{unit}</span>}
      </div>
      <div className="card-eyebrow mt-2 block">{label}</div>
    </div>
  );
}
