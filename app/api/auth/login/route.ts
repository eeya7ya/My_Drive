import { createSession, verifyPassword } from "@/lib/auth";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { password } = await readJson<{ password?: string }>(req);
    if (typeof password !== "string" || !password) {
      badRequest("Password is required");
    }

    if (!(await verifyPassword(password))) {
      return fail(
        Object.assign(new Error("Incorrect password"), { status: 401 })
      );
    }

    await createSession();
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
