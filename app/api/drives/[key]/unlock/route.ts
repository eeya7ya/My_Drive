/**
 * The door to a private drive: a passcode in, a pass for that one drive out.
 *
 * Every failure here answers the same way. A wrong passcode, a drive that has
 * no passcode set, and a key that names no drive at all are one 401 with one
 * message, because anything finer would turn this route into a way to ask
 * which unlisted drives exist and which of them are still half-configured.
 *
 * A public drive answers with success and mints nothing — there is no lock to
 * open — so a client that guesses wrong about a drive still lands somewhere
 * sensible instead of on an error.
 */

import { getDrive } from "@/lib/drives";
import { createDriveSession, destroyDriveSession, verifyDrivePasscode } from "@/lib/auth";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

function refused(): never {
  const err = new Error("That passcode did not open this drive.");
  (err as Error & { status?: number }).status = 401;
  throw err;
}

/** Trade a passcode for this viewer's pass to one drive. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { key } = await params;
    const brand = await getDrive(key);
    if (!brand) refused();

    // Asked before the passcode is even read: an open drive has nothing to
    // check, and saying so costs nothing a visitor could not already see.
    if (brand.visibility !== "private") {
      return ok({ ok: true, href: brand.basePath });
    }

    const { passcode } = await readJson<{ passcode?: unknown }>(req);
    if (typeof passcode !== "string" || !passcode) badRequest("Enter the passcode.");

    if (!(await verifyDrivePasscode(brand.key, passcode))) refused();

    await createDriveSession(brand.key);
    return ok({ ok: true, href: brand.basePath });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Hand the pass back. One drive's cookie is dropped and the others are left
 * alone, so signing out of a drive someone shared with you does not close the
 * rest.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { key } = await params;
    await destroyDriveSession(key);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
