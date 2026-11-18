"use client";

/**
 * Demo mount point.
 *
 * Everything under here renders fixtures instead of UGX telemetry. The live
 * app at /m does not include this provider and cannot reach it, so there is no
 * way for demo data to appear on a real screen.
 */

import { DemoProvider } from "@/mobile-app/demo/DemoContext";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoProvider>{children}</DemoProvider>;
}
