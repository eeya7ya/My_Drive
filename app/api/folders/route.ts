import { requireAdmin } from "@/lib/auth";
import { createFolder } from "@/lib/store";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Create a folder. Admin only. */
export async function POST(req: Request) {
  try {
    await requireAdmin();

    const { parentId, name } = await readJson<{
      parentId?: string | null;
      name?: string;
    }>(req);

    if (typeof name !== "string") badRequest("name is required");
    if (parentId !== null && parentId !== undefined && typeof parentId !== "string") {
      badRequest("parentId must be a folder id or null");
    }

    const folder = await createFolder(parentId ?? null, name);
    return ok(folder);
  } catch (err) {
    return fail(err);
  }
}
