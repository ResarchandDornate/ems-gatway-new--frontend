"use client";

/**
 * The dock, mounted at /k.
 *
 * Six destinations for a customer.
 *
 * Advisor was removed from this dock once, and the reasoning was recorded
 * here: this build had no inference service, and an advisor with nothing to
 * advise is a worse screen than no advisor. That reasoning was right and it
 * has stopped applying. The historian holds a real window now, and the screen
 * draws its findings from rules over those readings rather than from a model
 * — so it has something to say, it costs nothing to say it, and it says the
 * same thing whether or not a deployment ever configures inference.
 *
 * Alongside it are Signals and Energy, which are the two things the gateway
 * can directly answer: what all 63 points read right now, and what the plant
 * moved over a period. History — the same historian read as rolling spans
 * rather than as calendar periods — is one tap on from Energy; see ALL_SLOTS
 * for why it is not both.
 *
 * A sixth is the Control slot. Whether it is drawn is decided in one place
 * below, next to the constant that decides it — this header used to assert it
 * was internal_admin-only while the code twenty lines down showed it to
 * everybody, which is worse than either arrangement on its own.
 *
 * Whatever the dock draws is a visibility decision and nothing more. The
 * Control screen re-checks the role, the proxy refuses the write unless
 * GW_ALLOW_WRITES is set, and the gateway enforces internal_admin on every
 * request regardless of what this dock chose to draw.
 */

import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { clsx } from "clsx";
import { LayoutGrid, Activity, BarChart3, Bell, Settings, SlidersHorizontal, Lightbulb } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useIsDispatcher } from "../data";
import { DASH_SECTIONS } from "../screens/DashboardScreen";

export interface DockSlot { path: string; label: string; icon: LucideIcon }

/**
 * Energy holds the slot History used to.
 *
 * Both are views of the same historian and neither was dropped — History is
 * still routed, and Energy links to it from the bottom of every charted
 * period. What changed is which of the two a customer meets first, and Energy
 * is the better answer to that: it is named days and weeks and kWh, which is
 * how somebody who owns a plant thinks about it. History is spans, buckets,
 * coverage and a query box — the operator's view, and worth one more tap.
 *
 * It is a swap rather than a seventh slot because the dock has no seventh slot
 * to give. At 20px gutters a 375pt phone leaves 335px, and six slots at 52px
 * already occupy 338 of it; the dispatcher's seven at 46px overflow by more.
 * Adding one more would have meant shrinking every icon on every phone to make
 * room for a screen most accounts would rarely open.
 *
 * To put History back, swap the two paths in this array. Nothing else refers
 * to their order.
 */
export const ALL_SLOTS: DockSlot[] = [
  { path: "",          label: "Home",    icon: LayoutGrid },
  { path: "/signals",  label: "Signals", icon: Activity },
  { path: "/energy",   label: "Energy",  icon: BarChart3 },
  { path: "/alarms",   label: "Alarms",  icon: Bell },
  { path: "/advisor",  label: "Advisor", icon: Lightbulb },
  { path: "/settings", label: "System",  icon: Settings },
];

/** Appended only for a dispatcher. Never part of a customer's dock. */
export const CONTROL_SLOT: DockSlot = {
  path: "/control", label: "Control", icon: SlidersHorizontal,
};

const BASE = "/k";

/**
 * Who is offered the Control slot.
 *
 * `false` — a dispatcher only — is what the vendor's own handover requires.
 * README_FOR_IT_TEAM.md in the package of 10 Aug 2026 states it without
 * qualification: "Control and command endpoints must remain internal-admin
 * only", and §11 of the API Reference classifies dispatch as "never public
 * customer UI".
 *
 * This was `true` at one point, on a standing instruction to show Control to
 * every account. That is reversed here because the handover is explicit and
 * the instruction predates anyone reading it. Set it back to `true` to restore
 * the previous behaviour — it is one line, and it is the only line involved.
 *
 * Either way this decides visibility and nothing more. An account without the
 * role that reaches /k/control by typing it is told so by the screen, refused
 * by the proxy unless GW_ALLOW_WRITES is set, and refused again by the gateway.
 * Three independent checks, none of which is this constant.
 */
const SHOW_CONTROL_TO_EVERY_ACCOUNT = false;

export function FloatingNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { isDispatcher } = useIsDispatcher();
  const slots = useMemo(
    () =>
      SHOW_CONTROL_TO_EVERY_ACCOUNT || isDispatcher
        ? [...ALL_SLOTS, CONTROL_SLOT]
        : ALL_SLOTS,
    [isDispatcher],
  );

  /* -1 when the current route is not a dock destination, rather than 0.

     `best` started at 0 and stayed there on no match, so every screen outside
     the dock lit the Home slot — and Site is exactly that: reached from the
     unit picker, deliberately not a dock slot. Standing on /k/site with Home
     highlighted tells the reader they are somewhere they are not. */
  const activeIndex = useMemo(() => {
    let best = -1, bestLen = -1;
    slots.forEach((s, i) => {
      const href = BASE + s.path;
      /* Home covers the dashboard's detail sections too.

         Without this, opening Battery or Inverter left the whole dock unlit —
         the reader is one tap inside Home and the dock said they were nowhere.
         That is the right answer for /k/site, which is deliberately not a dock
         destination, and the wrong one for a section of the screen Home owns. */
      const hit = s.path === ""
        ? pathname === BASE || DASH_SECTIONS.some((k) => pathname === `${BASE}/${k}`)
        : pathname.startsWith(href);
      if (hit && s.path.length > bestLen) { best = i; bestLen = s.path.length; }
    });
    return best;
  }, [pathname, slots]);

  /* Slots are a fixed width so the disc can be translated between them rather
     than measured. Six of them at 58px is 374px of dock, which does not fit
     inside the gutters of a 375pt phone — so the width steps down as slots are
     added. Six is now the customer default and seven the dispatcher's, and at
     46px seven is 336px, which clears the gutters. The disc is 46px and is not
     scaled: at the narrowest step it exactly fills its slot, which reads as a
     full-width selection rather than as a mistake. */
  const SLOT_W = slots.length > 6 ? 46 : slots.length > 5 ? 52 : 58;

  return (
    <nav className="m-dock-wrap" aria-label="Primary">
      <div className="m-dock" style={{ ["--m-dock-slot" as string]: `${SLOT_W}px` }}>
        {/* The disc marks a destination. Off the dock there is none to mark,
            so it is not drawn rather than parked under an arbitrary slot. */}
        {activeIndex >= 0 && (
          <span
            className="m-dock-disc"
            aria-hidden
            style={{ left: 8, transform: `translateX(${activeIndex * (SLOT_W + 2) + (SLOT_W - 46) / 2}px)` }}
          />
        )}
        {slots.map((s, i) => {
          const Icon = s.icon;
          const on = i === activeIndex;
          return (
            <button
              key={s.path}
              className={clsx("m-dock-item", on && "is-on")}
              aria-current={on ? "page" : undefined}
              onClick={() => router.push(BASE + s.path)}
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
