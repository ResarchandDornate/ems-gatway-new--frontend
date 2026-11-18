import type { MetadataRoute } from "next";

/**
 * Web app manifest. Lets the site be added to a phone's Home Screen as an app,
 * which iPhone requires before it allows lock-screen alarm alerts (Web Push).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UnityESS · Energy Management System",
    short_name: "UnityESS",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#070B1A",
    theme_color: "#070B1A",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
