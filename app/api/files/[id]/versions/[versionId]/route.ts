import { requireAdmin } from "@/lib/auth";
import { deleteVersion } from "@/lib/store";
import { deleteObject } from "@/lib/r2";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; versionId: string }> };

/** Delete one older revision, freeing its R2 object. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id, versionId } = await params;

    const key = await deleteVersion(id, versionId);
    if (key) {
      try {
        await deleteObject(key);
      } catch (e) {
        console.error("[drive] R2 cleanup failed for revision", versionId, e);
      }
    }

    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
