/**
 * Who is allowed to see and change what.
 *
 * Three kinds of session, all signed cookies rather than rows, so D1 is
 * untouched on every page load:
 *
 *   - the admin session. One admin, one password from the environment, at the
 *     level above the drives: which of them exist, who owns each one, and how
 *     much each may store. The admin does not add folders — see below.
 *   - a per-drive OWNER session. Each drive has an owner passcode, set by the
 *     admin, and whoever holds it runs that drive: its folders, its files and
 *     revisions, and the identity it wears. One drive's owner is nobody in
 *     another drive. It lasts thirty days, because the owner is whoever uses
 *     the drive daily, and is retired the moment the admin sets a new owner
 *     passcode — which is how a drive is handed to somebody else.
 *   - a per-drive ACCESS session. A private drive carries a reader's passcode;
 *     entering it mints a cookie that opens that drive and no other, so
 *     sharing one drive never discloses the rest. It grants reading, never
 *     managing.
 *
 * All three are an HMAC over an expiry stamp under SESSION_SECRET, and both
 * per-drive cookies sign the drive key alongside it so a token cannot be moved
 * sideways onto a different drive.
 *
 * Why the admin is not simply allowed everything: running a drive and
 * overseeing the drives are two jobs, usually two people, and folding them
 * into one password meant the person minding quotas was also the only person
 * who could add a folder. So the admin session does not carry a drive's
 * management rights — it carries the right to *hand them out*, by setting the
 * drive's owner passcode and sending it to the person whose drive it is. From
 * then on that person adds their own folders, and the admin is not in the way.
 *
 * There is deliberately no way for the admin to borrow a drive's controls.
 * There was one — a "take the owner's seat" shortcut — and it was worse than
 * useless: it put the admin back in the middle of the one thing this split
 * exists to get them out of. An admin who genuinely has to work inside a drive
 * sets its owner passcode and signs in with it like anybody else, which is
 * visible in the panel rather than silent.
 */

import { cookies } from "next/headers";
import { ownerHashFor, passcodeHashFor } from "./drives";
import type { Brand, DriveKey } from "./brand";

const COOKIE = "drive_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

/** A reading pass lasts longer than an admin session; it grants far less. */
const DRIVE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * An owner's sign-in lasts as long as a reading pass.
 *
 * It was twelve hours, on the reasoning that the right to change something
 * should be shorter-lived than the right to look. That reasoning is wrong for
 * whose sign-in this is: the owner uses the drive every day, and
 * making them re-enter a passcode twice a day to add a folder is how a drive
 * ends up with the admin doing its owner's work again — the exact thing this
 * split exists to stop. The admin session stays at twelve hours, because it is
 * used occasionally and reaches every drive.
 *
 * What makes the longer life defensible is that this pass is revocable in a
 * way the admin session is not: it signs the owner hash it was issued against,
 * so setting a new owner passcode retires it the moment the admin saves.
 */
const OWNER_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set a random string of at least 16 characters."
    );
  }
  return s;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return b64url(sig);
}

/** Constant-time string compare, so a wrong guess leaks nothing by timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(candidate: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    throw new Error("ADMIN_PASSWORD is not set — admin login is unavailable.");
  }
  // Hash both sides first: equal-length digests keep the compare constant-time
  // even though the raw inputs differ in length.
  const [a, b] = await Promise.all([hmac(candidate), hmac(expected)]);
  return safeEqual(a, b);
}

export async function createSession(): Promise<void> {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = String(expires);
  const token = `${payload}.${await hmac(payload)}`;

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).set(COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function isAdmin(): Promise<boolean> {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    if (!token) return false;

    const idx = token.lastIndexOf(".");
    if (idx <= 0) return false;

    const payload = token.slice(0, idx);
    const sig = token.slice(idx + 1);

    if (!safeEqual(sig, await hmac(payload))) return false;

    const expires = Number(payload);
    return Number.isFinite(expires) && Date.now() < expires;
  } catch {
    // A missing SESSION_SECRET must read as "not an admin", never as a crash
    // on a page a visitor is entitled to see.
    return false;
  }
}

/** Throws unless the caller holds a valid admin session. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    const err = new Error("Admin session required");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET);
}

/* ── per-drive sessions: the owner's seat and the reader's pass ───────────── */

/**
 * The two per-drive credentials. They are handled by one set of helpers
 * because they are the same mechanism pointed at different columns — what
 * differs is which hash is signed in and how long the cookie lives.
 */
type DrivePass = "pass" | "owner";

/**
 * One cookie per drive per kind, named after the drive's permanent key.
 * Separate cookies rather than one list keeps the drives independent:
 * revoking one drive's passcode touches no other drive's passes, and taking
 * back one drive's ownership leaves its readers alone.
 */
function driveCookieName(kind: DrivePass, key: DriveKey): string {
  return `drive_${kind}_${key.replace(/[^a-z0-9_-]/gi, "_")}`;
}

/**
 * What a drive's reader passcode is stored as. The HMAC is keyed by
 * SESSION_SECRET, so the database never holds the passcode itself and a
 * leaked row does not open the drive.
 */
export async function hashPasscode(passcode: string): Promise<string> {
  return hmac(`passcode:${passcode}`);
}

/**
 * The same for the owner's passcode, under a different label — so an owner who
 * happens to choose the word the readers were given does not end up with a
 * row that matches theirs, and neither hash can be pasted into the other's
 * column to gain the other's rights.
 */
export async function hashOwnerPasscode(passcode: string): Promise<string> {
  return hmac(`owner-passcode:${passcode}`);
}

/** Whichever hash this kind of pass is signed against, or "" when unset. */
async function hashBehind(kind: DrivePass, key: DriveKey): Promise<string> {
  const stored = kind === "owner" ? await ownerHashFor(key) : await passcodeHashFor(key);
  return stored ?? "";
}

/**
 * What gets signed.
 *
 * The reader's pass keeps the exact payload it has always had, so the passes
 * already sitting in browsers stay valid across this change. The owner's is
 * labelled, which costs nothing and means the two can never be mistaken for
 * each other even if the hashes behind them somehow collided.
 */
function passPayload(kind: DrivePass, key: DriveKey, behind: string, stamp: string): string {
  return kind === "owner"
    ? `owner.${key}.${behind}.${stamp}`
    : `${key}.${behind}.${stamp}`;
}

/**
 * Mint a pass for one drive.
 *
 * The relevant passcode's own hash is inside what gets signed, so a pass is
 * only valid against the passcode it was issued for. Changing or clearing a
 * drive's passcode therefore invalidates every pass already handed out —
 * which is what revoking one means, and would not happen if the signature
 * covered only the key and the expiry. The same holds for ownership: the
 * moment the admin sets a new owner passcode, the previous owner's session
 * stops opening the drive's controls.
 */
async function mintPass(kind: DrivePass, key: DriveKey, maxAge: number): Promise<void> {
  const expires = Date.now() + maxAge * 1000;
  const behind = await hashBehind(kind, key);
  const token = `${expires}.${await hmac(passPayload(kind, key, behind, String(expires)))}`;

  (await cookies()).set(driveCookieName(kind, key), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

async function clearPass(kind: DrivePass, key: DriveKey): Promise<void> {
  (await cookies()).set(driveCookieName(kind, key), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Whether the caller holds a valid, unexpired pass of this kind for this drive. */
async function holdsPass(kind: DrivePass, key: DriveKey): Promise<boolean> {
  try {
    const token = (await cookies()).get(driveCookieName(kind, key))?.value;
    if (!token) return false;

    const idx = token.lastIndexOf(".");
    if (idx <= 0) return false;

    const stamp = token.slice(0, idx);
    const sig = token.slice(idx + 1);

    // The drive key is inside the signed payload, so a pass for one drive
    // cannot be replayed against another by renaming the cookie; the passcode
    // hash is in there too, so a rotated passcode retires the old passes.
    const behind = await hashBehind(kind, key);
    if (!safeEqual(sig, await hmac(passPayload(kind, key, behind, stamp)))) return false;

    const expires = Number(stamp);
    return Number.isFinite(expires) && Date.now() < expires;
  } catch {
    return false;
  }
}

/** Mint the pass that opens one private drive for reading. */
export async function createDriveSession(key: DriveKey): Promise<void> {
  return mintPass("pass", key, DRIVE_MAX_AGE_SECONDS);
}

/** Drop one drive's reading pass, leaving any others in place. */
export async function destroyDriveSession(key: DriveKey): Promise<void> {
  return clearPass("pass", key);
}

/** Sign in as one drive's owner, after its passcode has been accepted. */
export async function createOwnerSession(key: DriveKey): Promise<void> {
  return mintPass("owner", key, OWNER_MAX_AGE_SECONDS);
}

/**
 * Leave the owner's seat, keeping any reading pass. Signing out of managing a
 * drive should not also shut a private drive in the owner's face.
 */
export async function destroyOwnerSession(key: DriveKey): Promise<void> {
  return clearPass("owner", key);
}

/**
 * May the caller see this drive at all?
 *
 * A public drive is open to everyone. A private one needs the admin session,
 * that drive's reading pass, or its owner's seat — an owner who can restructure
 * the drive but not open it would be absurd. A private drive whose passcode
 * has been cleared is shut to everyone but those two — that is the safe reading
 * of a half-configured drive, and the admin panel refuses to create one.
 */
export async function canOpenDrive(brand: Brand): Promise<boolean> {
  if (brand.visibility !== "private") return true;
  if (await isAdmin()) return true;
  if (await holdsPass("pass", brand.key)) return true;
  return holdsPass("owner", brand.key);
}

/** Throws 403 unless the caller may see the drive. */
export async function requireDriveAccess(brand: Brand): Promise<void> {
  if (await canOpenDrive(brand)) return;
  const err = new Error("This drive is private. Enter its passcode to open it.");
  (err as Error & { status?: number }).status = 403;
  throw err;
}

/**
 * Check a reader's passcode against the stored hash. A drive with no passcode
 * set accepts none, so an unfinished private drive never falls open.
 */
export async function verifyDrivePasscode(
  key: DriveKey,
  candidate: string
): Promise<boolean> {
  const stored = await passcodeHashFor(key);
  if (!stored) return false;
  return safeEqual(stored, await hashPasscode(candidate));
}

/**
 * The same for the owner's passcode. A drive the admin has not yet given an
 * owner accepts nothing, so an unassigned drive cannot be claimed by guessing.
 */
export async function verifyOwnerPasscode(
  key: DriveKey,
  candidate: string
): Promise<boolean> {
  const stored = await ownerHashFor(key);
  if (!stored) return false;
  return safeEqual(stored, await hashOwnerPasscode(candidate));
}

/* ── who the caller is, for this drive ────────────────────────────────────── */

/** Whether the caller holds this drive's owner seat. */
export async function isDriveOwner(brand: Brand): Promise<boolean> {
  return holdsPass("owner", brand.key);
}

/**
 * Throws unless the caller owns this drive.
 *
 * Deliberately not satisfied by the admin session: adding a folder is the
 * owner's job, and an admin who wants to do it takes the seat first. The
 * message says which of the three situations the caller is in, because
 * "forbidden" alone would leave an admin staring at a drive they administer
 * with no idea what to do next.
 */
export async function requireDriveOwner(brand: Brand): Promise<void> {
  if (await isDriveOwner(brand)) return;

  const message = !brand.hasOwner
    ? `${brand.name} has no owner yet. An admin assigns one in the admin panel before its folders and files can be managed.`
    : (await isAdmin())
      ? `Managing ${brand.name} is its owner's job, not the admin's. Sign in with the drive's owner passcode — set it in the admin panel if you need to.`
      : `Only ${brand.name}'s owner can change this. Sign in with the drive's owner passcode.`;

  const err = new Error(message);
  (err as Error & { status?: number }).status = 403;
  throw err;
}

/** Both roles at once, for the payloads and pages that render by role. */
export async function driveRoles(
  brand: Brand
): Promise<{ isAdmin: boolean; isOwner: boolean }> {
  const [admin, owner] = await Promise.all([isAdmin(), isDriveOwner(brand)]);
  return { isAdmin: admin, isOwner: owner };
}
