/**
 * Stands in for `next/server`, aliased in tsconfig.json.
 *
 * ── Why this exists at all ────────────────────────────────────────────────
 * Nothing in the bundle runs this. The shared source's server modules —
 * proxy.ts, series.ts, backfill.ts — execute only inside the Next app, and
 * Vite never puts one in a chunk. But the Android project type-checks the
 * whole shared tree, and TypeScript follows an `import type` the same way it
 * follows a real one: client.ts type-imports SeriesResponse from series.ts,
 * series.ts imports proxy.ts, and proxy.ts imports `next/server`. The chain is
 * erased at runtime and fully live at check time.
 *
 * `exclude` cannot break it — that only stops a file being a ROOT file, and an
 * excluded file something imports is still checked. And on a developer machine
 * the error hides: TypeScript walks up from the importing file and finds the
 * real `next` in the repo root's node_modules. CI installs only this project,
 * so there is nothing to walk up to, and the failure appears there and nowhere
 * else. That is the same trap the `three` and `clsx` mappings in tsconfig.json
 * were added for.
 *
 * ── What it promises ──────────────────────────────────────────────────────
 * Only the surface proxy.ts actually touches: NextRequest as a Request with
 * `nextUrl`, and NextResponse with the `json` helper and a Response-shaped
 * constructor. It is deliberately not a faithful reproduction — an incomplete
 * shim that fails to compile when someone reaches for a new part of the real
 * API is doing its job, because that code would not run here anyway.
 *
 * If a screen ever genuinely needs one of these at runtime, that is the signal
 * that server code has been pulled into the bundle, and the fix is to move the
 * shared type out of the server module rather than to flesh this file out.
 */

export interface NextURL extends URL {}

export interface NextRequest extends Request {
  /** Next's parsed URL. proxy.ts reads `searchParams` and `pathname` off it. */
  readonly nextUrl: NextURL;
}

/**
 * `Response` plus the static `json` helper.
 *
 * Declared as a class rather than an interface because proxy.ts both
 * constructs it (`new NextResponse(null, { status: 204 })`) and calls the
 * static (`NextResponse.json(body, init)`), and only a class declaration
 * carries both halves.
 */
export declare class NextResponse<Body = unknown> extends Response {
  constructor(body?: BodyInit | null, init?: ResponseInit);
  static json<T>(body: T, init?: ResponseInit): NextResponse<T>;
}
