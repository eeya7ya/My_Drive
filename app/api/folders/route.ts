import { requireDriveOwner } from "@/lib/auth";
import { createFolder } from "@/lib/store";
import { parseDriveKey } from "@/lib/drives";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Create a folder in one drive.
 *
 * The drive's owner, not the admin. Shaping a drive — what its folders are
 * called and how they nest — is the job of whoever runs it; the admin's job is
 * which drives exist, who owns them and how much each may hold. So the check
 * here is against this drive's owner seat, and an admin who wants to add a
 * folder takes that seat first.
 *
 * Owning a drive implies being able to open it, so there is no separate access
 * check: requireDriveOwner is the stricter of the two questions.
 */
export async function POST(req: Request) {
  try {
    const { drive: rawDrive, parentId, name } = await readJson<{
      drive?: string;
      parentId?: string | null;
      name?: string;
    }>(req);
    const brand = await parseDriveKey(rawDrive);
    await requireDriveOwner(brand);

    if (typeof name !== "string") badRequest("name is required");
    if (parentId !== null && parentId !== undefined && typeof parentId !== "string") {
      badRequest("parentId must be a folder id or null");
    }

    const folder = await createFolder(brand.key, parentId ?? null, name);
    return ok(folder);
  } catch (err) {
    return fail(err);
  }
}
