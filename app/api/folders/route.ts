import { requireAdmin } from "@/lib/auth";
import { createFolder } from "@/lib/store";
import { parseDriveKey } from "@/lib/drives";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Create a folder in one drive. Admin only, which is why there is no per-drive
 * access check here — the admin holds a pass to every drive by definition, so
 * one would only ever answer the question twice.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();

    const { drive: rawDrive, parentId, name } = await readJson<{
      drive?: string;
      parentId?: string | null;
      name?: string;
    }>(req);
    const brand = await parseDriveKey(rawDrive);

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
