/**
 * The owner's door to one drive: a passcode in, that drive's owner seat out.
 *
 * Distinct from the passcode door next to it (`../unlock`), which hands out a
 * reading pass. This one hands out the right to change the drive — its
 * folders, its files, its identity — and is the reason the admin password no
 * longer has to be shared with everybody who maintains a drive.
 *
 * Every failure answers the same way. A wrong passcode, a drive the admin has
 * not yet given an owner, and a key that names no drive at all are one 401
 * with one message, because anything finer would turn this route into a way of
 * asking which drives exist and which of them are unclaimed.
 */

import { getDrive } from "@/lib/drives";
import {
  claimOwnerSession,
  createOwnerSession,
  destroyOwnerSession,
  isAdmin,
  verifyOwnerPasscode,
} from "@/lib/auth";
import { noteFailure, outOfAttempts } from "@/lib/guard";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

function refused(): never {
  const err = new Error("That passcode did not open this drive's controls.");
  (err as Error & { status?: number }).status = 401;
  throw err;
}

/**
 * Take the owner's seat at one drive.
 *
 * Two ways in. A passcode is the ordinary one, and is counted against the
 * throttle. An admin may instead ask for the seat with `{ takeOver: true }`
 * and no passcode: they can already set the drive's owner passcode to whatever
 * they like, so refusing would cost a round trip and buy nothing — and asking
 * for it explicitly is what keeps the admin from silently being every drive's
 * owner all the time.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { key } = await params;
    const brand = await getDrive(key);
    if (!brand) refused();

    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      badRequest("Expected a JSON object.");
    }

    if (body.takeOver === true) {
      // Anyone who is not the admin is refused in the same words as a wrong
      // passcode, so asking for the seat this way is not a way of finding out
      // that the shortcut exists or that a session is nearly an admin's.
      try {
        await claimOwnerSession(brand.key);
      } catch {
        refused();
      }
      return ok({ ok: true, href: brand.basePath, viaAdmin: true });
    }

    const passcode = body.passcode;
    if (typeof passcode !== "string" || !passcode) badRequest("Enter the owner passcode.");

    // Asked before the passcode is checked, so the check is not the cheap
    // thing an attacker gets to repeat, and refused in the same words as a
    // wrong guess so the throttle itself says nothing.
    const door = `owner:${brand.key}`;
    if (outOfAttempts(door, req)) refused();

    if (!(await verifyOwnerPasscode(brand.key, passcode))) {
      noteFailure(door, req);
      refused();
    }

    await createOwnerSession(brand.key);
    return ok({ ok: true, href: brand.basePath });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Leave the owner's seat. The drive's reading pass is left in place, so an
 * owner who stops managing a private drive is not also shut out of looking at
 * it, and the admin session — if this was an admin's take-over — is untouched.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { key } = await params;
    await destroyOwnerSession(key);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

/** Whether the caller currently holds this drive's seat, and may ask for it. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { key } = await params;
    const brand = await getDrive(key);
    if (!brand) refused();
    return ok({ hasOwner: brand.hasOwner, canTakeOver: await isAdmin() });
  } catch (err) {
    return fail(err);
  }
}
