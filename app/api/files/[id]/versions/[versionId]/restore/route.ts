import { requireVersionOwner } from "@/lib/owner";
import { restoreVersion } from "@/lib/store";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; versionId: string }> };

/**
 * Make an older revision current again. Moves a pointer; copies no bytes.
 * The drive's owner only: which revision the drive shows is a decision about
 * the drive's contents.
 */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { id, versionId } = await params;
    await requireVersionOwner(versionId);
    await restoreVersion(id, versionId);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
