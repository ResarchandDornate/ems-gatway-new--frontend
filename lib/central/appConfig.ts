/**
 * The init for GET /api/app-config. Carries the bearer so the demo sign-in
 * is answered with its own gateway id (lib/server/central/demo.ts); a real
 * session gets the configured gateway, as before.
 */
import { getSession } from "./session";

export function appConfigInit(): RequestInit {
  const s = getSession();
  return { cache: "no-store", headers: s ? { authorization: `Bearer ${s.token}` } : undefined };
}
