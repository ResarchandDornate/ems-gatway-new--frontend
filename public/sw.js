/*
 * Service worker for lock-screen alarm alerts.
 *
 * It does one thing: show the alarm notification the server pushes
 * (lib/server/push/push.ts), and open the Alarms page when it is tapped. No
 * caching and no fetch handler — the app is a live monitor, and a cached copy
 * of it would be a stale one.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data && event.data.text() }; }
  const title = msg.title || "UnityESS alarm";
  event.waitUntil(self.registration.showNotification(title, {
    body: msg.body || "",
    tag: msg.tag || "ems-alarm",
    /* Same tag replaces the last alert instead of stacking; renotify makes the
       replacement sound and vibrate again. */
    renotify: true,
    /* Stays until it is dealt with, where the platform allows it. */
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 400],
    icon: "/icon.png",
    badge: "/icon.png",
    data: { url: msg.url || "/alarms" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/alarms", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && "focus" in w) {
        await w.focus();
        if ("navigate" in w) await w.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
