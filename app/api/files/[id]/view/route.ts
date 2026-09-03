import { resolveDownload } from "@/lib/store";
import { presignInline } from "@/lib/r2";
import { fail, requireFileAccess } from "@/lib/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Redirect to a signed R2 URL served *inline*, for <img>, <video>, <audio>
 * and the PDF <iframe>.
 *
 * The download route signs the same object with Content-Disposition:
 * attachment, which makes a browser save it instead of rendering it — the
 * whole point here is the opposite, so it needs its own signature.
 *
 * Those elements do not enforce CORS, so previewing media works regardless of
 * the bucket's CORS policy, and the bytes go straight from R2 to the viewer
 * without passing through Vercel.
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

    const url = await presignInline(
      target.r2Key,
      target.name,
      target.contentType
    );
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return fail(err);
  }
}
