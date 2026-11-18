import type { Metadata, Viewport } from "next";
/* Self-hosted; see app/layout.tsx for why next/font/google is not used. */
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@/mobile_app_kunal_backend/styles/mobile.css";
import { MobileShell } from "@/mobile_app_kunal_backend/MobileShell";

/**
 * Root of the gateway-backed mobile build.
 *
 * Mounted at /k so it runs alongside /m without touching it. Both import the
 * same scoped stylesheet — everything in it lives under .m-root — so the two
 * builds share a design system while reading entirely different backends.
 */
export const metadata: Metadata = {
  title: "UnityESS · Gateway",
  description: "NorthBound EMS gateway — 1-second BESS telemetry",
};

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

/**
 * Rendered per request, because the one fact this layout reads — whether the
 * proxy is gated — is a runtime environment variable and not a build input.
 *
 * The image is built without GW_APP_TOKEN: it is supplied by ~/portals/.env
 * through docker-compose, on the server, at start. Prerendered, this layout
 * would bake in the value from build time — always absent — and every
 * deployment would claim to be ungated no matter how it was actually
 * configured. There is nothing to cache here in any case; the page already
 * sends no-store.
 */
export const dynamic = "force-dynamic";

export default function GatewayMobileLayout({ children }: { children: React.ReactNode }) {
  /* Whether /api/gw demands an app token. The web page holds none — serving it
     one would hand it to everyone who loads the page, which is the decision
     recorded in docs/MOBILE_APP_HANDOFF.md §10 — so when the gate is on, the
     shell says so instead of offering a sign-in that cannot succeed. */
  const gated = Boolean(process.env.GW_APP_TOKEN);

  return (
    <div>
      <MobileShell gated={gated}>{children}</MobileShell>
    </div>
  );
}
