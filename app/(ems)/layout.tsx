"use client";

import { useEffect, useRef } from "react";
import { TopBar } from "@/components/TopBar";
import { SubHeader } from "@/components/SubHeader";
import { StationProvider, useStation } from "@/lib/context/StationContext";
import { UnitProvider } from "@/lib/context/UnitContext";


function EmsShell({ children }: { children: React.ReactNode }) {
  const { sel, setSel } = useStation();
  const chromeRef = useRef<HTMLDivElement>(null);

  // The top bar and station bar wrap onto extra rows on narrow screens, so their
  // height is measured rather than assumed. Pages that fill the screen size
  // themselves from --chrome-h (see .page-fill).
  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;
    const sync = () => document.documentElement.style.setProperty("--chrome-h", `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative h-dvh overflow-hidden">

      <div className="relative z-10 h-full flex flex-col">
        <div ref={chromeRef} className="flex-none">
          <TopBar />
          <SubHeader value={sel} onChange={setSel} />
        </div>

        {/*
          The dashboard canvas. Scrolling moves here rather than on <main>'s
          parent so the header and context bar stay pinned, and .app-shell
          supplies the one max-width and gutter every route shares — modules
          used to each pick their own padding, which is why section edges never
          lined up down the page.

          `overflow-y-auto`, not `overflow-hidden`. This said hidden while the
          comment above described a scrolling canvas, and hidden is what actually
          ran: anything taller than the viewport was cut off with no way to reach
          it. That is not a rare case — browser zoom shrinks the viewport in CSS
          pixels, so a reader at 150% got a dashboard with its lower half simply
          gone, and below 1279px the layout deliberately becomes a scrolling
          stack that could not scroll. `auto` shows a scrollbar only when there
          is something to reach, so a page that already fits is unchanged.
        */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          {/* min-h-full, not h-full. Pinning the shell to exactly the viewport
              height is what stopped <main> from scrolling: content taller than
              the pin overflowed a box that could not grow, so it never became
              scrollable overflow and simply vanished below the fold. Growing past
              100% keeps the one-screen dashboard (which still gets a full-height
              box to resolve against whenever it fits) and lets every taller page
              scroll. */}
          <div className="app-shell min-h-full py-2.5">
            {children}
          </div>
        </main>

        {/*
          The footer is gone, and the height it held goes back to the charts.

          It was ~41px of fixed chrome — a wordmark and a country of origin —
          taken off the top of a layout whose whole job is to fit one screen.
          Every time the cockpit needed room it came out of the chart row
          instead, which fell 172 → 160 → 148 across a few passes and left the
          plots visibly squatter each time. Reclaiming the chrome is what stops
          that: the charts are back above their original floor and the two rows
          are no longer competing for the same forty pixels.

          Nothing here was load-bearing. If the version string is wanted back,
          it belongs somewhere that does not cost the layout height — the
          profile menu, or a title attribute on the wordmark.
        */}
      </div>
    </div>
  );
}

export default function EmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <StationProvider>
      <UnitProvider>
        <EmsShell>{children}</EmsShell>
      </UnitProvider>
    </StationProvider>
  );
}
