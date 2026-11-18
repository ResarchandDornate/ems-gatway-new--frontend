/**
 * The gateway id the demo sign-in (`customer` / `customer`) is given.
 *
 * Not the real gateway, so every cache the browser keys by gateway — IndexedDB,
 * localStorage, React Query — keeps the demo plant apart from the real site,
 * and the site overlay can name it. Shared by the server (lib/server/central/
 * demo.ts, app/api/app-config) and the overlay; nothing else should need it.
 */
export const DEMO_GATEWAY_ID = "00000000-0000-4000-8000-00000000de30";
