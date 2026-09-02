import type { MetadataRoute } from "next";
import { theme } from "@/lib/theme";

/**
 * Web app manifest — this gets opened from a phone and added to the home
 * screen, so it needs real icons rather than a scaled favicon.
 *
 * `theme_color` is the page cream rather than the brand accent on purpose: it
 * paints the status bar in standalone mode, sitting directly above `main`'s
 * bg-page, and the accent is reserved for deliberate emphasis (see theme.ts)
 * rather than large flat areas of chrome.
 *
 * The icons themselves come from scripts/generate-logo-assets.py — note the
 * separate maskable entry, which carries extra padding because Android crops
 * home-screen icons to a circle of 80% diameter.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Coach App",
    short_name: "Coach",
    description: "Eduardo's personal training dashboard",
    start_url: "/",
    display: "standalone",
    background_color: theme.page,
    theme_color: theme.page,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
