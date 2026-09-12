/**
 * The drive's door: its password in, a session on that drive out.
 *
 * One password per drive, set by the admin and given to whoever the drive is
 * for. Entering it opens the drive and hands over everything in it — there is
 * nothing further to be granted, and no weaker credential that would let
 * somebody look without touching.
 *
 * Every failure answers the same way. A wrong password, a drive nobody has
 * been given a password for yet, and a key that names no drive at all are one
 * 401 with one message, because anything finer would turn this route into a
 * way of asking which drives exist and which of them are unassigned.
 */

import { getDrive } from "@/lib/drives";
import { createDriveSession, destroyDriveSession, verifyDrivePassword } from "@/lib/auth";
import { noteFailure, outOfAttempts } from "@/lib/guard";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

function refused(): never {
  const err = new Error("That password did not open this drive.");
  (err as Error & { status?: number }).status = 401;
  throw err;
}

/** Trade the drive's password for a session on it. */
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
    if (typeof password !== "string" || !password) badRequest("Enter the password.");

    // Asked before the password is checked, so the check is not the cheap thing
    // an attacker gets to repeat, and refused in the same words as a wrong
    // guess so the throttle itself says nothing. See lib/guard.ts for what a
    // counter like this can and cannot do on a serverless deployment.
    const door = `drive:${brand.key}`;
    if (outOfAttempts(door, req)) refused();

    if (!(await verifyDrivePassword(brand.key, password))) {
      noteFailure(door, req);
      refused();
    }

    // Only wrong guesses are counted, so somebody who opens a drive and signs
    // out of it several times over an afternoon never runs into the limit.
    await createDriveSession(brand.key);
    return ok({ ok: true, href: brand.basePath });
  } catch (err) {
    return fail(err);
  }
}

/** Sign out of one drive. Any other drive's session is left alone. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { key } = await params;
    await destroyDriveSession(key);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
