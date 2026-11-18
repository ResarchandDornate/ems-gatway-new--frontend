/**
 * The gateway the app is looking at right now.
 *
 * The site picker lists every gateway the backend reports; picking one sets it
 * here, and useAppConfig() hands it to every screen in place of the single
 * configured CENTRAL_GATEWAY_ID. A module store rather than React context so
 * useAppConfig can read it without depending on the station list, which is
 * itself built from the configured gateway. Persisted per browser.
 */

const KEY = "EMS_ACTIVE_GATEWAY";
let current: string | null = null;
const subs = new Set<() => void>();

function read(): string {
  if (current === null) {
    try {
      current = typeof window === "undefined" ? "" : (window.localStorage.getItem(KEY) ?? "");
    } catch {
      current = "";
    }
  }
  return current;
}

export const getActiveGateway = (): string => read();

export function setActiveGateway(id: string): void {
  if (read() === id) return;
  current = id;
  try { window.localStorage.setItem(KEY, id); } catch { /* private mode: session only */ }
  subs.forEach((f) => f());
}

export function subscribeActiveGateway(f: () => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
