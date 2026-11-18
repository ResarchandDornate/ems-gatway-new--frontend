/**
 * Lock-screen alarm alerts, the browser's side: register the service worker
 * (public/sw.js), subscribe this device with the server's VAPID key, and tell
 * the server (app/api/push). See lib/server/push/push.ts for what is sent.
 *
 * iPhone and iPad allow Web Push only to a site added to the Home Screen and
 * opened from there (iOS 16.4+); in Safari proper there is no PushManager.
 */

import { getSession } from "@/lib/central";

export type PushState =
  | "unsupported"      // no service worker / PushManager here
  | "ios-needs-home"   // iOS Safari: add to Home Screen first
  | "unconfigured"     // the server has no VAPID keys
  | "denied"           // notifications blocked for this site
  | "off"
  | "on";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches
  || (navigator as unknown as { standalone?: boolean }).standalone === true;

async function publicKey(): Promise<string | null> {
  const r = await fetch("/api/push", { cache: "no-store" });
  if (!r.ok) return null;
  return ((await r.json()) as { publicKey: string | null }).publicKey;
}

const authHeaders = (): Record<string, string> => {
  const s = getSession();
  return { "content-type": "application/json", ...(s ? { authorization: `Bearer ${s.token}` } : {}) };
};

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return isIos() && !isStandalone() ? "ios-needs-home" : "unsupported";
  if (!(await publicKey().catch(() => null))) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Must be called from a tap or click: browsers ask for permission only then. */
export async function enablePush(): Promise<PushState> {
  const key = await publicKey();
  if (!key) return "unconfigured";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource });
  const r = await fetch("/api/push", { method: "POST", headers: authHeaders(), body: JSON.stringify({ subscription: sub.toJSON() }) });
  if (!r.ok) { await sub.unsubscribe().catch(() => {}); throw new Error(`Server answered ${r.status}`); }
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch("/api/push", { method: "DELETE", headers: authHeaders(), body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}

/** Sends this device the alert it would get now. */
export async function testPush(gatewayId: string): Promise<{ sent: number; ringing: number }> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) throw new Error("Not subscribed");
  const r = await fetch("/api/push/test", { method: "POST", headers: authHeaders(), body: JSON.stringify({ endpoint: sub.endpoint, gatewayId }) });
  if (!r.ok) throw new Error(`Server answered ${r.status}`);
  return r.json();
}
