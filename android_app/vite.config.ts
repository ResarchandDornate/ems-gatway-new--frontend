import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Build harness for the Android app.
 *
 * This project deliberately contains no screens of its own. The UI is the one
 * already serving /k out of ../mobile_app_kunal_backend, compiled here into a
 * static bundle that Capacitor can ship. Copying those 3,500 lines into this
 * folder would have created a second source of truth, and the whole reason
 * tokens.json exists is that this product cannot afford one — the copy drifts,
 * and the web and Android builds stop being the same app.
 *
 * So the only things here are the pieces Next was supplying: a router, a lazy
 * loader, a font, and an API base URL. Three aliases below stand in for Next;
 * everything else resolves straight into the shared source.
 */

const shim = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * `"use client"` is a Next directive and means nothing to Rollup, which warns
 * once per file that carries one — 27 warnings that would bury a real one.
 * The regex is anchored to the top of the module because that is the only
 * place the directive is legal, so a string mentioning it in prose survives.
 */
function stripUseClient(): Plugin {
  return {
    name: "strip-use-client",
    enforce: "pre",
    transform(code, id) {
      if (!/\.[jt]sx?$/.test(id) || !code.includes("use client")) return null;
      return {
        code: code.replace(/^\s*(["'])use client\1;?[ \t]*\r?\n?/, ""),
        map: null,
      };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    plugins: [stripUseClient(), react()],

    resolve: {
      /* The shared UI lives outside this project's root, next to the Next
         app's own node_modules. Node resolution therefore hands it the
         PARENT's copy of react and @tanstack/react-query, while src/ gets the
         local one — two instances of each, so every context lookup crosses a
         boundary and finds nothing. It surfaces as "No QueryClient set" from a
         provider that is demonstrably mounted, and "Invalid hook call" from a
         component that breaks no rule.
         Everything stateful enough to be a singleton is listed here. */
      dedupe: [
        "react",
        "react-dom",
        "scheduler",
        "@tanstack/react-query",
        "@tanstack/react-query-persist-client",
        "three",
        "@react-three/fiber",
        "@react-three/drei",
        /* Not singletons, but listed for the resolution problem rather than the
           identity one: the shared source's bare imports resolve upward into
           the repo root, which only has a node_modules when the Next app is
           installed too. Naming them pins them to this project. */
        "clsx",
        "lucide-react",
        "recharts",
      ],
      alias: [
        {
          find: /^next\/navigation$/,
          replacement: shim("./src/shims/next-navigation.ts"),
        },
        {
          find: /^next\/dynamic$/,
          replacement: shim("./src/shims/next-dynamic.tsx"),
        },
        /* `@/` is the Next app's own root alias, and the shared source now uses
           it: the energy scene lives in ../components/energy3d and its data
           contract in ../lib/energy, both shared with the web dashboard rather
           than copied here. Without this the mobile build cannot resolve them.

           It maps to the repo root, which is wider than what is actually
           imported — but narrowing it to two folders would be a second list to
           keep in step with the imports, and Rollup only bundles what is
           reached. What IS reached is deliberately transport-free: the scene
           reads lib/energy/context, not lib/energy/EnergyProvider, so the UGX
           poller and its API client stay out of this bundle. */
        {
          find: /^@\//,
          replacement: shim("../") + "/",
        },
      ],
    },

    /* The shared UI lives one level up, outside this project's root, so the dev
     server has to be told it may read it. The proxy lets `npm run dev` borrow
     the running Next app's /api/gw — same-origin from the browser's point of
     view, so the real gateway is reachable here without touching CORS or
     duplicating the proxy's login logic. */
    server: {
      fs: { allow: [".."] },
      port: 5180,
      proxy: env.VITE_DEV_PROXY
        ? { "/api/gw": { target: env.VITE_DEV_PROXY, changeOrigin: true } }
        : undefined,
    },

    /* Capacitor serves the bundle from the filesystem, not a web root, so every
     asset reference has to be relative. An absolute "/assets/..." resolves
     against the WebView origin and 404s on device while working perfectly in
     `vite preview` — which makes it exactly the kind of bug that reaches a
     store build. */
    base: "./",

    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "es2020",
      /* No manualChunks, deliberately.
       *
       * three, fiber and drei are reachable only through SocCore, which
       * DashboardScreen loads with dynamic(). Left alone, Rollup puts all of
       * it in that one lazy chunk and the dashboard paints without it.
       *
       * Naming a `three` chunk here looks like an optimisation and is the
       * opposite: it promotes three to a shared chunk, Vite emits a
       * <link rel="modulepreload"> for it in index.html, and 1.1 MB that was
       * deferred starts downloading before first paint. Measured, not
       * assumed — the preload tag was in the built index.html. */
      chunkSizeWarningLimit: 1200,
    },
  };
});
