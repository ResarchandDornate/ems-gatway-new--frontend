import type { Metadata, Viewport } from "next";
/* Self-hosted; see app/layout.tsx for why next/font/google is not used. */
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@/mobile-app/styles/mobile.css";
import { MobileShell } from "@/mobile-app/MobileShell";

/**
 * The mobile app's root.
 *
 * Inter is loaded here rather than in app/layout.tsx so the web app keeps IBM
 * Plex and neither typeface is downloaded on a route that does not use it
 * (§7.3 specifies Inter for mobile).
 *
 * mobile.css is imported only here. Everything it declares is scoped to
 * `.m-root`, so the 13 web routes are untouched by this design system.
 */
export const metadata: Metadata = {
  title: "UnityESS",
  description: "BESS monitoring, control and advisory",
};

/** viewportFit=cover is what makes env(safe-area-inset-*) resolve on iOS. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)",  color: "#070B1A" },
    { media: "(prefers-color-scheme: light)", color: "#EDF1F9" },
  ],
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <MobileShell>{children}</MobileShell>
    </div>
  );
}
