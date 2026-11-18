/**
 * Running the browser's central-backend readers on the server.
 *
 * The push watcher (lib/server/push/watcher.ts) has to see exactly the alarm
 * list the bell shows — same derivation, same raise times, so the same
 * acknowledgement keys. So rather than a second derivation it calls
 * fetchAlarms itself, inside a scope that supplies what the browser normally
 * would: a bearer token, and an origin to make the relative `/api/central`
 * and `/api/history` URLs absolute (the app's own server, so the requests go
 * through the same proxy and history routes).
 *
 * The scope is an AsyncLocalStorage the server installs on globalThis, so only
 * code called inside `runInScope` sees it — a page rendering on the server at
 * the same moment still has no session. Nothing here imports a Node module;
 * in the browser every function is a no-op.
 */

export interface ServerScope {
  token: string;
  /** e.g. http://127.0.0.1:3000 */
  origin: string;
}

interface Als { getStore(): ServerScope | undefined }

export function serverScope(): ServerScope | undefined {
  if (typeof window !== "undefined") return undefined;
  return (globalThis as { __centralScope?: Als }).__centralScope?.getStore();
}

/** `path` made absolute inside a server scope; unchanged in the browser. */
export function centralUrl(path: string): string {
  const s = serverScope();
  return s ? `${s.origin}${path}` : path;
}
