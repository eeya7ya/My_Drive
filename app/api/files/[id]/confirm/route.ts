import { requireAdmin } from "@/lib/auth";
import { confirmFile } from "@/lib/store";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Mark a reserved revision uploaded so it becomes the drive's current copy. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;
    const { versionId } = await readJson<{ versionId?: string }>(req);
    if (typeof versionId !== "string" || !versionId) {
      badRequest("versionId is required");
    }

    await confirmFile(id, versionId);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
