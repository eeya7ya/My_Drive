import { driveOfFile, listVersions } from "@/lib/store";
import { getDrive } from "@/lib/drives";
import { requireDriveAccess } from "@/lib/auth";
import { ok, fail } from "@/lib/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One file's revision history, newest first.
 *
 * Deliberately a separate call rather than part of /api/drive: history is only
 * read when someone opens it, and then only that file's rows via the
 * (file_id, version) index — so browsing the drive never pays for revisions
 * nobody looked at.
 *
 * History is drive content too — sizes, dates and how often a document was
 * revised — so it is gated with the bytes rather than treated as metadata.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;

    const owner = await driveOfFile(id);
    const brand = owner ? await getDrive(owner) : null;
    if (!brand) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    await requireDriveAccess(brand);

    const versions = await listVersions(id);
    return ok({ versions });
  } catch (err) {
    return fail(err);
  }
}
