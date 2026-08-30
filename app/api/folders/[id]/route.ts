import { requireAdmin } from "@/lib/auth";
import { deleteFolder, renameFolder } from "@/lib/store";
import { deleteObjects } from "@/lib/r2";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Rename a folder. Admin only. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;
    const { name } = await readJson<{ name?: string }>(req);
    if (typeof name !== "string") badRequest("name is required");

    await renameFolder(id, name);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

/** Delete a folder and everything under it. Admin only. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;

    const keys = await deleteFolder(id);

    // Metadata is already gone; a failure to clear the objects would only
    // orphan bytes in R2, so don't fail the request over it.
    try {
      await deleteObjects(keys);
    } catch (e) {
      console.error("[drive] R2 cleanup failed for deleted folder", id, e);
    }

    return ok({ ok: true, removedFiles: keys.length });
  } catch (err) {
    return fail(err);
  }
}
