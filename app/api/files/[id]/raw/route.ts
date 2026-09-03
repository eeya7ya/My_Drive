import { resolveDownload } from "@/lib/store";
import { getObjectStream } from "@/lib/r2";
import { fail, requireFileAccess } from "@/lib/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Formats the viewer must parse in JS, so it has to fetch() the bytes. */
const MAX_PROXY_BYTES = 25 * 1024 * 1024;

/**
 * Stream a file's bytes back same-origin.
 *
 * Markdown, text, .docx and spreadsheets are parsed in JavaScript, which means
 * fetch() — and fetch against R2 directly would need the bucket's CORS policy
 * to name this exact origin. Proxying keeps those previews working even when
 * CORS is wrong, which is the failure mode most likely to bite in practice.
 *
 * Media does NOT come through here: images, video, audio and PDFs go straight
 * from R2 via /view, so the large payloads never touch Vercel's bandwidth.
 * Capped, because this path does.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireFileAccess(id);
    const versionId = new URL(req.url).searchParams.get("version");

    const target = await resolveDownload(id, versionId);
    if (!target) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (target.sizeBytes > MAX_PROXY_BYTES) {
      return NextResponse.json(
        { error: "File is too large to preview — download it instead." },
        { status: 413 }
      );
    }

    const object = await getObjectStream(target.r2Key);
    if (!object.Body) {
      return NextResponse.json({ error: "File is empty" }, { status: 404 });
    }

    return new NextResponse(
      object.Body.transformToWebStream() as ReadableStream,
      {
        headers: {
          "Content-Type": target.contentType || "application/octet-stream",
          "Content-Length": String(target.sizeBytes),
          "Cache-Control": "private, max-age=60",
        },
      }
    );
  } catch (err) {
    return fail(err);
  }
}
