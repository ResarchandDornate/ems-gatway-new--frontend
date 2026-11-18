"use client";

/**
 * AppBackground — Layer 1.
 *
 * The ambient environment: three pools of blue light over a vertical gradient,
 * fixed so they stay put while content scrolls past them. Content is capped at
 * 520 px and centred, so a tablet or a desktop browser gets the phone
 * composition rather than a stretched one — this is a mobile design and it
 * should not pretend otherwise at width.
 *
 * The gradient itself lives in mobile.css; this component only establishes the
 * two layers and the safe-area-aware padding.
 */

import type { ReactNode } from "react";

export function AppBackground({ children }: { children: ReactNode }) {
  return (
    <div className="m-app">
      <div className="m-content">{children}</div>
    </div>
  );
}
