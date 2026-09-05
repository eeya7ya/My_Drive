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

/** How many wrong guesses one caller may make at one drive, and over how long. */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;

/** Keep the table below from growing without bound as callers keep changing. */
const MAX_TRACKED_CALLERS = 4096;

/**
 * Wrong guesses, keyed by drive and caller, held in this instance's memory.
 * The deployment is serverless, so this is a speed bump rather than a
 * guarantee: a second instance counts from zero and a cold start forgets what
 * this one saw. It is still worth having, because the passcode is the only
 * thing in front of a private drive and the work behind this handler is one
 * indexed read and one HMAC — cheap enough to guess against at network speed
 * if nothing at all slows it down.
 */
const failures = new Map<string, number[]>();

function refused(): never {
  const err = new Error("That passcode did not open this drive.");
  (err as Error & { status?: number }).status = 401;
  throw err;
}

/**
 * The caller as whatever proxy sits in front of the app reports them. Each of
 * these headers is written by an edge and forged just as easily by a client,
 * so none of them is trusted on its own; they are read in turn and a caller
 * who rotates one to dodge the count is a caller who could rotate addresses
 * anyway. That is the honest limit of what a counter like this can do.
 */
function callerOf(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}

/** One caller's guesses inside the window, with the older ones dropped. */
function recentFailures(id: string, now: number): number[] {
  const times = (failures.get(id) ?? []).filter((at) => now - at < WINDOW_MS);
  if (times.length) failures.set(id, times);
  else failures.delete(id);
  return times;
}

function outOfAttempts(id: string): boolean {
  return recentFailures(id, Date.now()).length >= MAX_ATTEMPTS;
}

function noteFailure(id: string): void {
  const now = Date.now();
  // Sweeping only once the table is already large keeps the ordinary call to a
  // single lookup; entries left behind by a caller who never returns age out
  // on the next sweep.
  if (failures.size > MAX_TRACKED_CALLERS) {
    for (const other of [...failures.keys()]) recentFailures(other, now);
  }
  failures.set(id, [...recentFailures(id, now), now]);
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

    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      badRequest("Expected a JSON object.");
    }

    const passcode = body.passcode;
    if (typeof passcode !== "string" || !passcode) badRequest("Enter the passcode.");

    // A caller who has run out of attempts is refused in the same words as one
    // who guessed wrong, so the throttle itself never says whether a guess was
    // close, or that a drive is being guessed at at all. The count is asked
    // before the passcode is checked, which is what keeps the check from being
    // the cheap thing an attacker gets to repeat.
    const caller = `${brand.key}:${callerOf(req)}`;
    if (outOfAttempts(caller)) refused();

    if (!(await verifyDrivePasscode(brand.key, passcode))) {
      noteFailure(caller);
      refused();
    }

    // Only wrong guesses are counted, so someone who opens a drive and signs
    // out of it several times over an afternoon never runs into the limit.
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
