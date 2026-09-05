import type { MetadataRoute } from "next";
import { SITE } from "@/lib/brand";

/**
 * The site's manifest: installing the portal gives an app that opens on the
 * dashboard, from which any drive can be reached. Each drive has its own at
 * /<slug>/manifest.webmanifest, so someone who only uses one drive can install
 * that drive instead and land straight in it.
 *
 * The brand mark is a single 2000px square; listing several sizes against the
 * one file lets each platform pick and downscale, which avoids shipping
 * near-duplicate icons for a logo that is already square.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.title,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f2f2f3",
    theme_color: "#5980a6",
    icons: [
      {
        src: "/assets/espark-bright.png",
        sizes: "192x192 512x512 2000x2000",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/assets/espark-bright.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
