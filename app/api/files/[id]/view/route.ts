import { driveOfFile, resolveDownload } from "@/lib/store";
import { presignInline } from "@/lib/r2";
import { getDrive } from "@/lib/drives";
import { requireDriveAccess } from "@/lib/auth";
import { fail } from "@/lib/api";
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
    const versionId = new URL(req.url).searchParams.get("version");

    // The drive is looked up from the file, since the URL never names one, and
    // the check happens before the signature is minted: a signed URL handed to
    // the wrong person discloses the object exactly as fully as sending it.
    const owner = await driveOfFile(id);
    const brand = owner ? await getDrive(owner) : null;
    if (!brand) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    await requireDriveAccess(brand);

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
