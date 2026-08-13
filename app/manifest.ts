import type { MetadataRoute } from "next";

/**
 * PWA manifest. start_url is "/" — NOT /scan — because iOS standalone web
 * apps re-prompt for camera permission on every launch (open WebKit
 * limitation); the broken path must not be the front door.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trace",
    short_name: "Trace",
    description:
      "Scan almost any product to trace the people, places, materials, and movements behind it.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF9F6",
    theme_color: "#FAF9F6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
