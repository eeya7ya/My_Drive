import { destroySession } from "@/lib/auth";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await destroySession();
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
