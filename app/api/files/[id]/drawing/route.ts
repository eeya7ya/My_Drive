import { driveOfFile, resolveDownload } from "@/lib/store";
import { getDrive } from "@/lib/drives";
import { requireDriveAccess } from "@/lib/auth";
import { getObjectStream, putObject } from "@/lib/r2";
import { DwgUnreadableError, isDwgName, renderDwgToSvg, svgKeyFor } from "@/lib/dwg";
import { fail } from "@/lib/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Converting a drawing takes seconds, not milliseconds, and the default ceiling
 * is short enough to cut a large one off midway. This asks for room; a plan
 * that will not grant it caps the value rather than failing to deploy.
 */
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Beyond this the conversion is more likely to exhaust the function than finish. */
const MAX_DWG_BYTES = 64 * 1024 * 1024;

/**
 * A DWG as SVG, so the browser can show a drawing it cannot otherwise open.
 *
 * The conversion happens once per revision and the result is kept in R2 beside
 * the drawing, so the first reader pays for it and everyone after them gets a
 * stored file. `?version=` renders a specific revision; without it, the current
 * one.
 *
 * Served from here rather than by redirecting to a signed R2 URL, which is what
 * /view does for media. The viewer fetches this to put the SVG in the page, and
 * fetch enforces CORS, so the same-origin proxy is what keeps it working
 * regardless of the bucket's CORS policy — the same reasoning as /raw.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const versionId = new URL(req.url).searchParams.get("version");

    const driveKey = await driveOfFile(id);
    if (!driveKey) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const brand = await getDrive(driveKey);
    if (!brand) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    await requireDriveAccess(brand);

    const target = await resolveDownload(id, versionId);
    if (!target) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (!isDwgName(target.name)) {
      return NextResponse.json(
        { error: "That file is not a drawing." },
        { status: 400 }
      );
    }

    const svgKey = svgKeyFor(target.r2Key);

    // The cheap path, and the one almost every request takes.
    try {
      const cached = await getObjectStream(svgKey);
      if (cached.Body) {
        return new NextResponse(cached.Body.transformToWebStream(), {
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            // A revision's drawing never changes, and the key names the
            // revision, so this can be cached hard and privately — the drive
            // may be one nobody else is allowed to see.
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Drawing-Cache": "hit",
          },
        });
      }
    } catch {
      // Not stored yet. Falling through to convert is the whole point; a real
      // R2 outage will surface on the read of the drawing itself, below.
    }

    if (target.sizeBytes > MAX_DWG_BYTES) {
      return NextResponse.json(
        {
          error:
            "This drawing is too large to convert for viewing — download it and open it in a CAD program.",
        },
        { status: 413 }
      );
    }

    const source = await getObjectStream(target.r2Key);
    if (!source.Body) {
      return NextResponse.json({ error: "File is empty" }, { status: 404 });
    }
    const bytes = await source.Body.transformToByteArray();

    const render = await renderDwgToSvg(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    );

    // Storing is a cache fill, not the answer. If R2 refuses it the reader
    // should still get their drawing; the next reader simply converts again.
    try {
      await putObject(svgKey, render.svg, "image/svg+xml; charset=utf-8");
    } catch (err) {
      console.error("[drive] could not cache converted drawing", svgKey, err);
    }

    return new NextResponse(render.svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Drawing-Cache": "miss",
        "X-Drawing-Ms": String(render.ms),
        "X-Drawing-Entities": String(render.entityCount),
      },
    });
  } catch (err) {
    // A drawing this build cannot render is the file's problem, not the
    // server's, and the viewer says so differently — so it keeps its own status
    // rather than being reported as a fault.
    if (err instanceof DwgUnreadableError) {
      console.warn("[drive] drawing could not be rendered:", err.detail ?? err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return fail(err);
  }
}
