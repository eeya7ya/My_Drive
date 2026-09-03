import { driveFor } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * The eSpark drive's web app manifest, so installing it to a home screen
 * gives an app called eSpark that opens at /espark. Next's manifest.ts
 * convention only covers the app root, hence a plain route here.
 */
export function GET() {
  const b = driveFor("espark");
  const manifest = {
    name: b.title,
    short_name: b.shortName,
    description: b.description,
    start_url: b.basePath,
    scope: b.basePath + "/",
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
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
