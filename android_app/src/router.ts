/**
 * Routing for the bundled app.
 *
 * Hash-based, not History-based, and that is a device decision rather than a
 * stylistic one. A Capacitor build is a folder of files with no server behind
 * it, so a History URL like /k/history survives navigation but not a reload:
 * the WebView asks the filesystem for that path and gets nothing. A hash never
 * leaves index.html, so reload, restore-from-background and the hardware back
 * button all land somewhere real.
 *
 * Paths keep the /k prefix the web build uses. That is what lets the dock in
 * ../mobile_app_kunal_backend/components/FloatingNavigation.tsx compile here
 * untouched — it matches against a hardcoded BASE of "/k", and a shim that
 * reported bare "/history" would light the wrong tab.
 *
 * Implemented as an external store rather than a context so the shims can read
 * it without every consumer needing a provider above it, which in turn keeps
 * MobileShell's tree identical to the web build's.
 */

export const BASE = "/k";

type Listener = () => void;
const listeners = new Set<Listener>();

function readHash(): string {
  const raw = window.location.hash.slice(1);
  if (!raw || raw === "/") return BASE;
  // A hash that predates a deep link, or one a user typed, should not render
  // an empty screen — fall back to the dashboard the same way ScreenRouter does.
  return raw.startsWith(BASE) ? raw.replace(/\/+$/, "") || BASE : BASE;
}

let snapshot = typeof window === "undefined" ? BASE : readHash();

function onHashChange() {
  const next = readHash();
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", onHashChange);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): string {
  return snapshot;
}

/** Accepts the "/k/signals" form the dock already emits. */
export function push(path: string): void {
  const next = path.startsWith(BASE) ? path : BASE + path;
  if (next === snapshot) return;
  window.location.hash = next;
}

export function replace(path: string): void {
  const next = path.startsWith(BASE) ? path : BASE + path;
  if (next === snapshot) return;
  const url = new URL(window.location.href);
  url.hash = next;
  window.history.replaceState(null, "", url.toString());
  onHashChange();
}

/** "/k/history" → ["history"], which is the shape ScreenRouter expects. */
export function slugFrom(pathname: string): string[] {
  return pathname.slice(BASE.length).split("/").filter(Boolean);
}

/** Normalise the address bar on cold start so the dock has a path to match. */
export function ensureHash(): void {
  if (!window.location.hash) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${BASE}`);
    snapshot = BASE;
  }
}
