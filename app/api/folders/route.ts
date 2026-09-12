import { requireDriveUser } from "@/lib/auth";
import { createFolder } from "@/lib/store";
import { parseDriveKey } from "@/lib/drives";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Create a folder in one drive.
 *
 * Whoever is in the drive, not the admin. Shaping a drive — what its folders
 * are called and how they nest — is the job of the person whose drive it is,
 * and they should not have to wait for anybody to make one. The admin's job is
 * which drives exist, who is in each of them, and how much each may hold.
 *
 * So the check is that the caller can open this drive, which for a private
 * drive means they hold the passcode the admin gave them.
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
