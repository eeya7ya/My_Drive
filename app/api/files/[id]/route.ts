import { requireAdmin } from "@/lib/auth";
import { deleteFile, renameFile } from "@/lib/store";
import { deleteObject } from "@/lib/r2";
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

/** Delete a file and its R2 object. Admin only. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;

    const key = await deleteFile(id);
    if (key) {
      try {
        await deleteObject(key);
      } catch (e) {
        console.error("[drive] R2 cleanup failed for deleted file", id, e);
      }
    }

    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
