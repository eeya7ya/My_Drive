/**
 * The users the admin creates: list them, add one.
 *
 * This is the whole of what the admin panel does about people. A user is a
 * name, a password, and the drive that is theirs; once created, that person
 * signs in on their own drive and does everything in it without coming back
 * here.
 *
 * Admin only, both verbs. The list carries no password hashes — it crosses
 * into a client component, and while a hash is not a password it is the thing
 * a forged cookie would need.
 */

import { createUser, listUsers } from "@/lib/users";
import { hashUserPassword, requireAdmin } from "@/lib/auth";
import { getDrive } from "@/lib/drives";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return ok({ users: await listUsers() });
  } catch (err) {
    return fail(err);
  }
}

function asText(value: unknown, field: string): string {
  if (typeof value !== "string") badRequest(`${field} must be text.`);
  return value;
}

export async function POST(req: Request) {
  try {
    await requireAdmin();

    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      badRequest("Expected a JSON object.");
    }

    // The drive is checked here rather than left to the foreign key, so a typo
    // is a sentence the admin can act on instead of a constraint error.
    const driveKey = asText(body.driveKey, "driveKey").trim();
    if (!(await getDrive(driveKey))) badRequest("That drive does not exist.");

    // Trimmed on the way in because the sign-in form trims what is typed and
    // the server compares hashes exactly — a password saved with a space around
    // it could never be entered again.
    const password = asText(body.password, "password").trim();
    if (!password) badRequest("Give this user a password.");

    const user = await createUser(
      {
        name: body.name === undefined ? undefined : asText(body.name, "name"),
        email: body.email === undefined ? undefined : asText(body.email, "email"),
        driveKey,
      },
      await hashUserPassword(password)
    );
    return ok({ user });
  } catch (err) {
    return fail(err);
  }
}
