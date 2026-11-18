/* Must precede any import that reaches the gateway client. */
import "./config";

/* Inter, bundled rather than fetched. The web build gets it from next/font at
   the server; a phone that is offline, or on a site with no route to Google's
   CDN, still has to render — and a field EMS app is used in exactly those
   places. mobile.css reads it through --font-inter, defined in app.css.
 *
 * Latin subsets only. The bare "@fontsource/inter/400.css" entry point pulls
 * Cyrillic, Greek and Vietnamese as well — 20 files and roughly 600 kB of
 * font this UI has no glyph for, carried in every APK. latin-ext is kept for
 * the ° and × that appear in units and for European names on the alarms
 * screen; add a subset here if the app is ever localised. */
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-ext-400.css";
import "@fontsource/inter/latin-ext-500.css";
import "@fontsource/inter/latin-ext-600.css";
import "@fontsource/inter/latin-ext-700.css";

import "../../mobile_app_kunal_backend/styles/mobile.css";
import "./styles/app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { wireBackButton } from "./native";

/* Registered before the first render so a back press during startup is
   already handled rather than closing the app. */
wireBackButton();

const host = document.getElementById("root");
if (!host) throw new Error("#root missing from index.html");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
