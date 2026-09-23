import { requireFileOwner } from "@/lib/owner";
import { deleteFile, moveFile, renameFile } from "@/lib/store";
import { deleteObjects } from "@/lib/r2";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Rename a file, or move it to another folder. The owner of the drive it is in.
 *
 * Anyone who can see a drive may add to it — see the upload route — but only
 * its owner may rename, move or remove what is there, so adding a file is
 * never a way of taking one away.
 *
 * `folderId` moves it: a folder id of the same drive, or null for the drive's
 * root. The answer carries the name it ended up with, which differs from the
 * old one only when the destination already held a file of that name.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireFileOwner(id);
    const body = await readJson<{ name?: string; folderId?: string | null }>(req);

    if (body.folderId !== undefined) {
      if (body.folderId !== null && typeof body.folderId !== "string") {
        badRequest("folderId must be a folder id or null");
      }
      const { name } = await moveFile(id, body.folderId || null);
      return ok({ ok: true, name });
    }

    if (typeof body.name !== "string") badRequest("name is required");
    await renameFile(id, body.name);
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
