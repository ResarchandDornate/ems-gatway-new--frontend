"use client";

/**
 * MobileShell — the root of the mobile app.
 *
 * Establishes, in order: the token scope (`.m-root`, which is what keeps this
 * design system away from the 13 web routes), the station context the
 * telemetry hooks read from, Layer 1's ambient background, and the dock.
 *
 * StationProvider is reused rather than reimplemented because usePlantConfig —
 * and therefore useBessLive, and therefore every live reading on the dashboard
 * — resolves its device through it. A separate mobile station store would have
 * been a second source of truth for which device is being watched.
 */

import type { ReactNode } from "react";
import { StationProvider } from "@/lib/context/StationContext";
import { AppBackground, FloatingNavigation } from "./components";
import { ThemeProvider } from "./useTheme";

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="m-root">
      <ThemeProvider>
      <StationProvider>
        <AppBackground>{children}</AppBackground>
        {/* Control is permission-gated per §7.7. Wired to a real role claim
            when the BFF issues one; until then the slot is present so the
            layout being validated is the one operators will get. */}
        <FloatingNavigation canControl />
      </StationProvider>
      </ThemeProvider>
    </div>
  );
}
