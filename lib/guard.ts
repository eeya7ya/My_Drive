/**
 * A speed bump in front of the passcodes.
 *
 * A drive's passcode is the one typed secret in this app, and the work behind
 * checking it is a single indexed read and one HMAC. That is cheap enough to
 * guess against at network speed if nothing at all slows it down, so wrong
 * guesses are counted per drive and per caller.
 *
 * The deployment is serverless, so this is a speed bump rather than a
 * guarantee: a second instance counts from zero and a cold start forgets what
 * this one saw. It is still worth having, because the passcode is the only
 * thing in front of a private drive — and, since being in a drive is what
 * lets somebody run it, the only thing in front of its folders too.
 *
 * The counter is keyed by "door" rather than by drive so that a second kind of
 * typed secret, if one is ever added, cannot spend the attempts belonging to
 * this one.
 */

/** How many wrong guesses one caller may make at one door, and over how long. */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;

/** Keep the table below from growing without bound as callers keep changing. */
const MAX_TRACKED_CALLERS = 4096;

/** Wrong guesses, keyed by door and caller, held in this instance's memory. */
const failures = new Map<string, number[]>();

/**
 * The caller as whatever proxy sits in front of the app reports them. Each of
 * these headers is written by an edge and forged just as easily by a client,
 * so none of them is trusted on its own; they are read in turn and a caller
 * who rotates one to dodge the count is a caller who could rotate addresses
 * anyway. That is the honest limit of what a counter like this can do.
 */
export function callerOf(req: Request): string {
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

/**
 * Whether this caller has used up their guesses at this door.
 *
 * Ask it *before* checking the passcode: that is what keeps the check from
 * being the cheap thing an attacker gets to repeat. A caller who is out of
 * attempts must be refused in exactly the same words as one who simply
 * guessed wrong, so the throttle itself never says whether a guess was close,
 * or that a drive is being guessed at at all.
 */
export function outOfAttempts(door: string, req: Request): boolean {
  return recentFailures(`${door}:${callerOf(req)}`, Date.now()).length >= MAX_ATTEMPTS;
}

/** Record a wrong guess. Only wrong ones are counted, so ordinary use is free. */
export function noteFailure(door: string, req: Request): void {
  const id = `${door}:${callerOf(req)}`;
  const now = Date.now();
  // Sweeping only once the table is already large keeps the ordinary call to a
  // single lookup; entries left behind by a caller who never returns age out
  // on the next sweep.
  if (failures.size > MAX_TRACKED_CALLERS) {
    for (const other of [...failures.keys()]) recentFailures(other, now);
  }
  failures.set(id, [...recentFailures(id, now), now]);
}
