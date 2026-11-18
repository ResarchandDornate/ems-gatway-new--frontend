/**
 * Stands in for `next/dynamic`, aliased in vite.config.ts.
 *
 * One call site: DashboardScreen defers ../viz/SocCore, the three.js battery,
 * so the dashboard paints before the 3D bundle arrives. That matters more on a
 * phone than it did on the web — SocCore pulls in three, fiber and drei, which
 * are together the largest thing this app ships.
 *
 * `ssr` is accepted and ignored. There is no server to render on, so every
 * component here is already client-only, and rejecting the option would mean
 * editing the shared source for no behavioural gain.
 */

import { lazy, Suspense, type ComponentType } from "react";

interface DynamicOptions {
  ssr?: boolean;
  loading?: ComponentType<Record<string, never>>;
}

export default function dynamic<P extends object>(
  loader: () => Promise<ComponentType<P>>,
  options: DynamicOptions = {},
): ComponentType<P> {
  /* Next's loader resolves to the component itself — callers write
     `import(...).then(m => m.SocCore)` — while React.lazy wants a module with
     a default export. Wrapping here keeps the shared call site unchanged.

     The assertion is load-bearing: lazy() rewrites the props type to fold in
     a forwarded ref, and that reformulation does not accept a bare generic P.
     The runtime contract is unchanged — these are the same props the caller
     declared — so the cast restates what lazy() erased rather than hiding a
     mismatch. */
  const Lazy = lazy(async () => ({ default: await loader() })) as unknown as ComponentType<P>;
  const Loading = options.loading;

  return function Dynamic(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
