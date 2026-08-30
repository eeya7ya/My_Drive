import { requireAdmin } from "@/lib/auth";
import { confirmFile } from "@/lib/store";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Mark a reserved file as uploaded so it becomes visible in the drive. */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;
    await confirmFile(id);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
