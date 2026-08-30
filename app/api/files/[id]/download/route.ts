import { resolveDownload } from "@/lib/store";
import { presignDownload } from "@/lib/r2";
import { fail } from "@/lib/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Redirect to a short-lived signed R2 URL. `?version=<id>` fetches a specific
 * revision; without it you get the current one. Readable by anyone who can see
 * the drive — the drive itself is the public artifact; only management is gated.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const versionId = new URL(req.url).searchParams.get("version");

    const target = await resolveDownload(id, versionId);
    if (!target) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Name the download for the revision it actually is, so three downloads of
    // the same document don't all land as one filename.
    const dot = target.name.lastIndexOf(".");
    const filename =
      versionId && dot > 0
        ? `${target.name.slice(0, dot)} (v${target.version})${target.name.slice(dot)}`
        : versionId
          ? `${target.name} (v${target.version})`
          : target.name;

    const url = await presignDownload(target.r2Key, filename);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return fail(err);
  }
}
