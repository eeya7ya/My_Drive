/**
 * A user signing in to their own drive: their password in, their session out.
 *
 * Distinct from the passcode door beside it (`../unlock`), which hands out a
 * pass to *look* at a private drive. This one is the person the drive belongs
 * to, and what it hands back is the right to change everything in it.
 *
 * The password is matched against the users of this drive only, so one
 * person's password does nothing on anybody else's drive. There is no name to
 * type: a password identifies its user within a drive, and the admin panel
 * refuses to give two of that drive's users the same one.
 *
 * Every failure answers the same way. A wrong password, a drive with no users
 * yet, and a key that names no drive at all are one 401 with one message,
 * because anything finer would turn this route into a way of asking which
 * drives exist and which of them are still unassigned.
 */

import { getDrive } from "@/lib/drives";
import { createUserSession, destroyUserSession, verifyUserPassword } from "@/lib/auth";
import { noteFailure, outOfAttempts } from "@/lib/guard";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

function refused(): never {
  const err = new Error("That password did not open this drive.");
  (err as Error & { status?: number }).status = 401;
  throw err;
}

/** Trade a password for this person's session on one drive. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { key } = await params;
    const brand = await getDrive(key);
    if (!brand) refused();

    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      badRequest("Expected a JSON object.");
    }

    const password = body.password;
    if (typeof password !== "string" || !password) badRequest("Enter your password.");

    // Asked before the password is checked, so the check is not the cheap thing
    // an attacker gets to repeat, and refused in the same words as a wrong
    // guess so the throttle itself says nothing. See lib/guard.ts for what a
    // counter like this can and cannot do on a serverless deployment.
    const door = `user:${brand.key}`;
    if (outOfAttempts(door, req)) refused();

    const user = await verifyUserPassword(brand.key, password);
    if (!user) {
      noteFailure(door, req);
      refused();
    }

    await createUserSession(user);
    return ok({ ok: true, href: brand.basePath, name: user.name });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Sign out of one drive. Any other drive's session is left alone, as is the
 * viewing pass — signing out of managing a private drive should not also shut
 * it in your face.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { key } = await params;
    await destroyUserSession(key);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
