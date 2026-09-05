import { canOpenDrive } from "@/lib/auth";
import { resolveDriveSlug } from "@/lib/drives";

export const dynamic = "force-dynamic";

/**
 * A drive's own web app manifest, so installing it to a home screen gives an
 * app named after that drive which opens at its address rather than at the
 * dashboard. Next's manifest.ts convention only covers the app root — that one
 * is the site's now — so each drive's is a plain route keyed on the slug.
 *
 * A drive the caller may not open gets a 404 rather than its manifest: the file
 * carries the drive's name and description, which is exactly what the unlock
 * gate exists to withhold.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ drive: string }> }) {
  const { drive } = await params;
  const hit = await resolveDriveSlug(drive);

  if (!hit || !(await canOpenDrive(hit.brand))) {
    return new Response("Not found", { status: 404 });
  }

  const b = hit.brand;
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
