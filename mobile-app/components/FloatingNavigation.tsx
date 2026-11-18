"use client";

/**
 * FloatingNavigation — the dock.
 *
 * A translucent pill inset from the bottom safe area, not a full-width bar
 * (§7.7). The active item is a disc: light on dark ground, navy on light
 * ground, per the reference.
 *
 * The disc is one absolutely-positioned element that translates between slots
 * rather than a background painted on whichever item is selected. That is the
 * difference between the state *moving* and the state *jumping*, and it is the
 * most-seen animation in the app.
 *
 * Slots are permission-gated (§7.7): a read-only customer sees three
 * destinations and the dock re-centres, because it is sized by its contents.
 */

import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { clsx } from "clsx";
import { LayoutGrid, SlidersHorizontal, Sparkles, Bell, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface DockSlot {
  /** Relative to the mount point, so the dock works at /m and /m/demo alike. */
  path: string;
  label: string;
  icon: LucideIcon;
}

/** Every destination the dock can show, in order. */
export const ALL_SLOTS: DockSlot[] = [
  { path: "",          label: "Home",    icon: LayoutGrid },
  { path: "/control",  label: "Control", icon: SlidersHorizontal },
  { path: "/advisor",  label: "Advisor", icon: Sparkles },
  { path: "/alarms",   label: "Alarms",  icon: Bell },
  { path: "/settings", label: "Settings",icon: Settings },
];

/** Destinations that require write permission, and so can be absent. */
const GATED = new Set(["/control"]);

export function FloatingNavigation({ canControl = true }: { canControl?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  // Where this dock is mounted. Demo screens live one level deeper, and the
  // dock has to keep you inside whichever of the two you entered.
  const base = pathname.startsWith("/m/demo") ? "/m/demo" : "/m";

  const slots = useMemo(
    () => ALL_SLOTS.filter((s) => canControl || !GATED.has(s.path)),
    [canControl],
  );

  // Longest-prefix match, so /m/alarms/123 still lights the Alarms slot while
  // the root does not win every route by being a prefix of all of them.
  const activeIndex = useMemo(() => {
    let best = 0;
    let bestLen = -1;
    slots.forEach((s, i) => {
      const href = base + s.path;
      const hit = s.path === "" ? pathname === base : pathname.startsWith(href);
      if (hit && s.path.length > bestLen) { best = i; bestLen = s.path.length; }
    });
    return best;
  }, [pathname, slots, base]);

  const SLOT_W = 58;

  return (
    <nav className="m-dock-wrap" aria-label="Primary">
      <div className="m-dock">
        {/* One disc for the whole dock; it slides between slots. */}
        <span
          className="m-dock-disc"
          aria-hidden
          style={{
            left: 8,
            transform: `translateX(${activeIndex * (SLOT_W + 2) + (SLOT_W - 46) / 2}px)`,
          }}
        />
        {slots.map((s, i) => {
          const Icon = s.icon;
          const on = i === activeIndex;
          return (
            <button
              key={s.path}
              className={clsx("m-dock-item", on && "is-on")}
              aria-current={on ? "page" : undefined}
              onClick={() => router.push(base + s.path)}
            >
              <Icon size={19} strokeWidth={on ? 2.2 : 1.8} />
              <span className="m-dock-label">{s.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
