import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

// Read DRIVE_VARIANT when the manifest is requested, not when the app is
// built, so the same build can serve either drive.
export const dynamic = "force-dynamic";

/**
 * Installable to a phone's home screen, opening without browser chrome so the
 * drive behaves like an app rather than a page.
 *
 * The brand mark is a single 2000px square; listing several sizes against the
 * one file lets each platform pick and downscale, which avoids shipping
 * near-duplicate icons for a logo that is already square.
 */
export default function manifest(): MetadataRoute.Manifest {
  const b = brand();
  return {
    name: b.title,
    short_name: b.shortName,
    description: b.description,
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
