import { confirmFile } from "@/lib/store";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mark a reserved revision uploaded so it becomes the drive's current copy.
 *
 * Open to the same callers as the reserve route: gating this one alone would
 * let a visitor start an upload that could never complete, leaving orphaned
 * bytes in R2 and an unconfirmed row in D1.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
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
