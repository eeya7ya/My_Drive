import { requireFileOwner } from "@/lib/owner";
import { deleteFile, renameFile } from "@/lib/store";
import { deleteObjects } from "@/lib/r2";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Rename a file. The owner of the drive it is in.
 *
 * Anyone who can see a drive may add to it — see the upload route — but only
 * its owner may rename or remove what is there, so adding a file is never a
 * way of taking one away.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireFileOwner(id);
    const { name } = await readJson<{ name?: string }>(req);
    if (typeof name !== "string") badRequest("name is required");

    await renameFile(id, name);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

/** Delete a file and every one of its revisions. The drive's owner only. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireFileOwner(id);

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
