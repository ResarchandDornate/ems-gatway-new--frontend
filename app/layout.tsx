import type { Metadata } from "next";
/**
 * Chivo for text, Chivo Mono for readings and identifiers — one family, so a
 * timestamp or a register name sits comfortably next to a heading. Chivo has
 * tabular figures, so a column of live readings stays aligned as it ticks.
 *
 * Self-hosted rather than next/font/google. That helper downloads the font at
 * build time, and a production deploy failed on exactly that: fonts.googleapis
 * .com answered the deploy host in 11 s against 0.8 s for github, Turbopack
 * gave up on all three families, and the image never built. A build that needs
 * Google reachable is a build that fails on someone else's bad afternoon.
 *
 * Latin subsets only — the app has no glyph outside them.
 *
 * --font-sans and --font-mono are declared in globals.css rather than generated
 * here, so every consumer keeps reading the same variable it always did.
 */
import "@fontsource/chivo/latin-400.css";
import "@fontsource/chivo/latin-500.css";
import "@fontsource/chivo/latin-600.css";
import "@fontsource/chivo/latin-700.css";
import "@fontsource/chivo-mono/latin-400.css";
import "@fontsource/chivo-mono/latin-500.css";
import "@fontsource/chivo-mono/latin-600.css";

import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "UnityESS · Energy Management System",
  description: "Battery Energy Storage System operations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Inline script runs before paint — prevents flash of wrong theme */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ems-theme');if(t==='light')document.documentElement.classList.add('light');}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans"><Providers>{children}</Providers></body>
    </html>
  );
}
