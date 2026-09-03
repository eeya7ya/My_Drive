import { requireAdmin } from "@/lib/auth";
import { createFolder } from "@/lib/store";
import { parseDrive } from "@/lib/brand";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Create a folder in one drive. Admin only. */
export async function POST(req: Request) {
  try {
    await requireAdmin();

    const { drive: rawDrive, parentId, name } = await readJson<{
      drive?: string;
      parentId?: string | null;
      name?: string;
    }>(req);
    const drive = parseDrive(rawDrive);

    if (typeof name !== "string") badRequest("name is required");
    if (parentId !== null && parentId !== undefined && typeof parentId !== "string") {
      badRequest("parentId must be a folder id or null");
    }

    const folder = await createFolder(drive, parentId ?? null, name);
    return ok(folder);
  } catch (err) {
    return fail(err);
  }
}
