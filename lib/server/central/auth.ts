/**
 * Who is asking, for the server's own routes (history, acknowledgements).
 *
 * The bearer the browser already holds is checked against the central
 * backend's /auth/me — the same check the drawings route makes — and the
 * answer is remembered for five minutes so a page polling three routes does
 * not cost three round trips to the backend every few seconds.
 */

import { createHash } from "node:crypto";

export const CENTRAL_BASE = (process.env.CENTRAL_BASE_URL ?? "https://bess-ems-api.unityess.cloud").replace(/\/+$/, "");

export interface CentralUser { id: string; username: string; email?: string }

const cache = new Map<string, { at: number; user: CentralUser | null }>();
const TTL_MS = 5 * 60_000;

/** The signed-in user, null when the token is refused, "unreachable" when the backend is down. */
export async function verifyBearer(auth: string | null): Promise<CentralUser | null | "unreachable"> {
  if (!auth || !/^Bearer\s+\S+/i.test(auth)) return null;
  const key = createHash("sha256").update(auth).digest("hex");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.user;
  let r: Response;
  try {
    r = await fetch(`${CENTRAL_BASE}/api/v1/auth/me`, { headers: { authorization: auth, accept: "application/json" }, cache: "no-store" });
  } catch {
    return "unreachable";
  }
  let user: CentralUser | null = null;
  if (r.ok) {
    const u = (await r.json().catch(() => ({}))) as { id?: string; username?: string; email?: string };
    user = { id: String(u.id ?? ""), username: u.username ?? u.email ?? "user", email: u.email };
  }
  cache.set(key, { at: Date.now(), user });
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k);
  return user;
}
