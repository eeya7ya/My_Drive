import { requireAdmin } from "@/lib/auth";
import { restoreVersion } from "@/lib/store";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; versionId: string }> };

/** Make an older revision current again. Moves a pointer; copies no bytes. */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id, versionId } = await params;
    await restoreVersion(id, versionId);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
