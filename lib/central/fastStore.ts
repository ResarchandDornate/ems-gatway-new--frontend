/**
 * IndexedDB home for the fast-stream (S1) power/SOC cache in fastBess.ts, so a
 * page refresh resumes from what was already read instead of paging the day
 * again from the newest end.
 *
 * Not the React Query localStorage cache: a day of S1 at ~1 Hz is several MB
 * per cabinet, past localStorage's ~5 MB quota, and one oversized write there
 * stops the whole EMS_QUERY_CACHE from saving. IndexedDB holds it without
 * JSON. Best effort throughout: no IndexedDB (SSR, private mode, blocked
 * storage) reads as "nothing held" and writes are dropped.
 */

const DB = "ems-fast-cache";
const STORE = "intervals";
/* Bump when the stored shape changes; an old database is simply emptied. */
const VERSION = 1;

let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

export async function loadStored<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

export async function saveStored<T>(key: string, value: T): Promise<void> {
  const db = await open();
  if (!db) return;
  try { db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key); } catch { /* dropped */ }
}
