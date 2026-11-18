import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the static bundle Vite produces into an Android app.
 *
 * There is no separate mobile codebase: webDir points at the same dist/ that
 * `npm run build` emits from the shared /k source, so the phone and the web
 * app are the same screens compiled twice rather than two implementations to
 * keep in step.
 */
const config: CapacitorConfig = {
  /* Permanent. Play identifies an app by this string for its whole life — a
     published app cannot change it, and a different value is a different app
     with different users. Reverse-domain of ornatesolar.com, product last, so
     sibling apps can sit alongside it. */
  appId: "com.ornatesolar.unityess",
  appName: "UnityESS",
  webDir: "dist",

  server: {
    /* Serve from https://localhost rather than http:// or file://. Two reasons,
       both of which bite later if not set now:
         - Secure-context APIs. Anything this grows into that needs one —
           crypto.subtle for token storage, notifications, geolocation —
           silently refuses to work on an insecure origin.
         - Mixed content. An https origin cannot issue http subresource
           requests, which is what we want against a production API and which
           would otherwise fail only on device.
       It also fixes the WebView origin, which matters in Phase 3: requests to
       the deployed proxy are cross-origin from here, so that server must allow
       https://localhost explicitly. */
    androidScheme: "https",
  },

  android: {
    /* An https page must not pull http subresources. Left true, a misconfigured
       API base keeps working in development and fails Play's security review. */
    allowMixedContent: false,
  },

  plugins: {
    SplashScreen: {
      /* Held open until React has painted rather than hidden on a timer —
         src/native.ts calls hide(). A timer either clears early, showing an
         empty shell, or lingers after the app is ready. */
      launchAutoHide: false,
      /* Brand teal, matching the splash artwork and the launcher icon's ground.
         This is the letterbox colour behind the splash image: leave the two
         different and a device whose aspect ratio does not match the 1:1 source
         shows bands of the other colour down the sides.

         It no longer matches themeColor in app/k/layout.tsx or body in
         src/styles/app.css, which stay #070B1A. Launch is therefore teal and
         then dark rather than one continuous colour — a deliberate brand splash
         handing off to a dark app, not the three-way flash the single colour was
         originally chosen to avoid. */
      backgroundColor: "#12606B",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#070B1A",
      overlaysWebView: true,
    },
  },
};

export default config;
