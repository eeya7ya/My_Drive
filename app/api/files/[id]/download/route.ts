import { getFile } from "@/lib/store";
import { presignDownload } from "@/lib/r2";
import { fail } from "@/lib/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Redirect to a short-lived signed R2 URL. Readable by anyone who can see the
 * drive — the drive itself is the public artifact; only management is gated.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const file = await getFile(id);

    if (!file || !file.uploaded) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const url = await presignDownload(file.r2_key, file.name);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return fail(err);
  }
}
