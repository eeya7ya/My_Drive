import { requireAdmin } from "@/lib/auth";
import { deleteFile, renameFile } from "@/lib/store";
import { deleteObjects } from "@/lib/r2";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Rename a file. Admin only. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;
    const { name } = await readJson<{ name?: string }>(req);
    if (typeof name !== "string") badRequest("name is required");

    await renameFile(id, name);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

/** Delete a file and every one of its revisions. Admin only. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;

    const keys = await deleteFile(id);
    if (keys.length) {
      try {
        await deleteObjects(keys);
      } catch (e) {
        console.error("[drive] R2 cleanup failed for deleted file", id, e);
      }
    }

    return ok({ ok: true, removedVersions: keys.length });
  } catch (err) {
    return fail(err);
  }
}
