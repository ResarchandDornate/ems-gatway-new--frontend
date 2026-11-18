/**
 * The parts of the app that only exist because it is an app.
 *
 * Everything here is a no-op in a browser, so `npm run dev` behaves exactly as
 * it did before and one bundle serves both. Capacitor.isNativePlatform() is the
 * single gate; calling these plugins unguarded on the web throws.
 */

import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

import { BASE, getSnapshot, push } from "./router";
import { revalidateSession } from "../../mobile_app_kunal_backend/gateway/auth";

export const isNative = Capacitor.isNativePlatform();

/* Same two colours as themeColor in app/k/layout.tsx and body in app.css. */
const GROUND = { dark: "#070B1A", light: "#EDF1F9" } as const;

/**
 * Match the native status bar to the theme.
 *
 * Style.Dark means light icons for a dark ground, and Style.Light means dark
 * icons for a light one — the name describes the background it is designed
 * against, not the colour of the glyphs, which is the wrong way round often
 * enough to be worth stating.
 */
export async function syncStatusBar(theme: "dark" | "light"): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.setStyle({ style: theme === "light" ? Style.Light : Style.Dark });
    await StatusBar.setBackgroundColor({ color: GROUND[theme] });
  } catch {
    /* Some OEM skins refuse setBackgroundColor on a transparent bar. The app is
       readable either way; a themed status bar is not worth a crash. */
  }
}

/**
 * The Android back button.
 *
 * Without this the button closes the app from any screen, which is the single
 * clearest tell that an Android app is a web view. The dock is a flat set of
 * five destinations rather than a stack, so "back" from any of them means the
 * dashboard, and only from the dashboard does it leave.
 *
 * minimizeApp rather than exitApp: it backgrounds the app the way Home does, so
 * returning keeps the gateway data already on screen instead of paying for a
 * cold start and a fresh poll.
 */
export function wireBackButton(): void {
  if (!isNative) return;
  void CapacitorApp.addListener("backButton", () => {
    if (getSnapshot() !== BASE) push(BASE);
    else void CapacitorApp.minimizeApp();
  });
}

/**
 * Re-check the session whenever the app comes back to the foreground.
 *
 * Two separate things go wrong across a long suspend, and this handles both.
 *
 * The session may have expired while nothing was running to notice — a
 * suspended app keeps no timers and issues no requests — so it is re-read
 * from storage and dropped if dead.
 *
 * More commonly the session is fine and the *connection* is not. Observed
 * after roughly 21 hours suspended: every request failing while the device
 * itself had working network, the app retrying against a dead connection pool
 * indefinitely, and the screen stuck on "Can't reach the site, showing the
 * last reading from 13h ago". A relaunch fixed it, which is not something a
 * user should have to work out. `onResume` lets the query layer throw the
 * stale connections away and start again.
 */
export function wireSessionRevalidation(onResume?: () => void): () => void {
  if (!isNative) return () => {};

  /* Only a real absence counts. appStateChange fires on transitions that are
     not "the app was away for a while" — and the callback below refetches, so
     a chatty listener means refetching constantly. The history request takes
     ~33 s against this gateway; restarting it on every state change means it
     never finishes, and a superseded fetch is not an error, so the screen
     shows "no rows" with no indication anything went wrong. That is exactly
     what it did. */
  const AWAY_MS = 30_000;
  let leftAt: number | null = null;

  const handle = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) {
      leftAt = Date.now();
      return;
    }
    revalidateSession();
    const away = leftAt == null ? 0 : Date.now() - leftAt;
    leftAt = null;
    if (away >= AWAY_MS) onResume?.();
  });

  /* Removable. Without this every mount stacked another listener, so the
     refetch fired once per mount that had ever happened. */
  return () => { void handle.then((h) => h.remove()); };
}

/**
 * Dismiss the splash once React has actually painted.
 *
 * capacitor.config.ts sets launchAutoHide false, so this is the only thing that
 * hides it. rAF twice because one frame guarantees the commit, not the paint
 * that follows it.
 */
export function hideSplashAfterPaint(): void {
  if (!isNative) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      void SplashScreen.hide();
    }),
  );
}
