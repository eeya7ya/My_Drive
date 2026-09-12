/**
 * Editing and removing one user. Admin only.
 *
 * The password follows a two-way convention rather than the three-way one the
 * drive passcodes use: a field left out leaves it alone, a string replaces it.
 * There is no "clear", because a user with no password could not sign in — the
 * way to take somebody's access away is to delete them, or move them to
 * another drive.
 */

import { deleteUser, updateUser } from "@/lib/users";
import { hashUserPassword, requireAdmin } from "@/lib/auth";
import { getDrive } from "@/lib/drives";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function asText(value: unknown, field: string): string {
  if (typeof value !== "string") badRequest(`${field} must be text.`);
  return value;
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;

    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      badRequest("Expected a JSON object.");
    }

    let driveKey: string | undefined;
    if (body.driveKey !== undefined) {
      driveKey = asText(body.driveKey, "driveKey").trim();
      if (!(await getDrive(driveKey))) badRequest("That drive does not exist.");
    }

    let passwordHash: string | undefined;
    if (body.password !== undefined) {
      const password = asText(body.password, "password").trim();
      if (!password) badRequest("A password cannot be blank.");
      passwordHash = await hashUserPassword(password);
    }

    const user = await updateUser(
      id,
      {
        name: body.name === undefined ? undefined : asText(body.name, "name"),
        email: body.email === undefined ? undefined : asText(body.email, "email"),
        driveKey,
      },
      passwordHash
    );
    return ok({ user });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Remove a user. Their drive and everything in it is untouched — the person
 * who filled a drive leaving is not a reason to empty it.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;
    await deleteUser(id);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
