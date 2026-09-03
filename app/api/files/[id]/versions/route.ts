import { listVersions } from "@/lib/store";
import { ok, fail, requireFileAccess } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One file's revision history, newest first.
 *
 * Deliberately a separate call rather than part of /api/drive: history is only
 * read when someone opens it, and then only that file's rows via the
 * (file_id, version) index — so browsing the drive never pays for revisions
 * nobody looked at.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireFileAccess(id);
    const versions = await listVersions(id);
    return ok({ versions });
  } catch (err) {
    return fail(err);
  }
}
