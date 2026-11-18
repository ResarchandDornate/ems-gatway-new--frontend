/**
 * Server startup hook.
 *
 * Next calls register() once per server process, before it takes traffic. It is
 * the only place in this app where something can be started that is not a
 * response to a request, which is exactly what the history backfill is.
 *
 * Guarded on the runtime: this file is also evaluated for the edge runtime,
 * where there is no filesystem for the chunk store and no long-lived process
 * for the worker to live in. The import is dynamic so that node-only modules
 * are never pulled into a bundle that cannot hold them.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackfill } = await import("./mobile_app_kunal_backend/gateway/backfill");
  startBackfill();
  /* The central backend's collector — see lib/server/central/collector.ts.
     Off unless its read-only account is configured. */
  const { startCollector, serviceToken } = await import("./lib/server/central/collector");
  startCollector();
  /* Lock-screen alarm alerts — see lib/server/push/push.ts. Off unless its
     VAPID keys and the collector's account are configured. */
  const { startPushWatcher } = await import("./lib/server/push/push");
  startPushWatcher(serviceToken);
}
