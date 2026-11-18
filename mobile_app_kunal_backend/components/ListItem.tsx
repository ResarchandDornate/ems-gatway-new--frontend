"use client";

/**
 * ListItem — a row inside a card. Leading slot, title/subtitle, trailing slot.
 *
 * Rows are separated by hairlines rather than by borders or by their own card
 * each: a list of eight alarms as eight floating cards is noise, and the
 * reference groups related rows onto one surface.
 */

import type { ReactNode } from "react";
import { clsx } from "clsx";

export function ListItem({
  leading, title, subtitle, trailing, onClick, className, wrap,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
  /**
   * Let the title run to two lines instead of ellipsing.
   *
   * Off by default, because a settings row reads better as one clean line.
   * On where the text IS the content — an alarm truncated to "Chiller high
   * dischar…" has thrown away the only part an operator needed.
   */
  wrap?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      className={clsx("m-row", wrap && "is-wrap", onClick && "m-row-tap", className)}
      onClick={onClick}
      type={onClick ? "button" : undefined}
    >
      {leading && <span className="m-row-lead">{leading}</span>}
      <span className="m-row-body">
        <span className="m-label m-ink m-row-title">{title}</span>
        {subtitle && <span className="m-row-sub m-ink3">{subtitle}</span>}
      </span>
      {trailing && <span className="m-row-trail">{trailing}</span>}
    </Tag>
  );
}
