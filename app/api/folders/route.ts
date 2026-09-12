import { requireDriveUser } from "@/lib/auth";
import { createFolder } from "@/lib/store";
import { parseDriveKey } from "@/lib/drives";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Create a folder in one drive.
 *
 * One of the drive's own users, not the admin. Shaping a drive — what its
 * folders are called and how they nest — is the job of the person whose drive
 * it is; the admin's job is creating that person and handing them a password.
 *
 * Being one of a drive's users implies being able to open it, so there is no
 * separate access check: requireDriveUser is the stricter of the two.
 */
export async function POST(req: Request) {
  try {
    const { drive: rawDrive, parentId, name } = await readJson<{
      drive?: string;
      parentId?: string | null;
      name?: string;
    }>(req);
    const brand = await parseDriveKey(rawDrive);
    await requireDriveUser(brand);

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
