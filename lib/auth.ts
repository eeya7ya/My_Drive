/**
 * Who is allowed to see and change what.
 *
 * Two kinds of session, both signed cookies rather than rows, so D1 is
 * untouched on every page load:
 *
 *   - the admin session. One admin, one password from the environment. The
 *     admin creates users, gives them passwords, and sets how much each drive
 *     may store. That is all it is for — it does not add folders.
 *   - a USER session. The admin creates a user against one drive; that person
 *     signs in on their own drive with their own password and does everything
 *     in it. One drive's user is nobody on any other drive.
 * There is no third kind, and no second password. A drive sits behind its
 * users' passwords and nothing else: no separate viewing passcode, no drive
 * that opens to anyone with the link. Getting in and being able to change
 * everything are the same act, because that is what somebody means when they
 * say a drive is theirs.
 *
 * Both are an HMAC over an expiry stamp under SESSION_SECRET. The user session
 * signs the drive key, the user id and the user's own password hash alongside
 * it, so a cookie cannot be moved sideways onto another drive and changing
 * somebody's password — or deleting them — signs them out at once.
 *
 * Why the admin is not simply allowed everything: running a drive and
 * overseeing the drives are two jobs, usually two people, and folding them
 * into one password meant the person minding storage was also the only person
 * who could add a folder. The admin's part is creating the user and handing
 * them their password; after that the drive runs without them, and there is no
 * shortcut that lends a drive's controls back to the admin.
 */

import { cookies } from "next/headers";
import { passcodeHashFor } from "./drives";
import { getUser, userWithPassword } from "./users";
import type { UserRow } from "./users";
import type { Brand, DriveKey } from "./brand";

const COOKIE = "drive_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

/**
 * A user's session lasts as long as a drive pass, and far longer than the
 * admin's. It is held by the person who uses the drive every day; asking them
 * for their password twice a day to add a folder is how a drive ends up back
 * with the admin doing its user's work. It stays revocable in a way the admin
 * session is not: the cookie signs the password hash it was issued against, so
 * the admin changing or deleting the user ends it immediately.
 */
const USER_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

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

/* ── getting into a drive ─────────────────────────────────────────────────── */

/**
 * May the caller see this drive at all?
 *
 * One answer, and it is the same one that decides whether they may change it:
 * are they signed in as one of the drive's users? A drive is somebody's, it
 * sits behind their password, and once they are through that password
 * everything in it is theirs. There is no second, weaker credential that lets
 * somebody look without touching — there was one, and having two passwords for
 * one drive was worse than useless.
 *
 * Not satisfied by the admin session either. The admin creates the users and
 * hands out the passwords; looking inside somebody's drive means being one of
 * its users, which is visible in the panel rather than silent.
 */
export async function canOpenDrive(brand: Brand): Promise<boolean> {
  return Boolean(await currentUser(brand.key));
}

/** Throws 403 unless the caller may open the drive. */
export async function requireDriveAccess(brand: Brand): Promise<void> {
  if (await canOpenDrive(brand)) return;
  const err = new Error(
    `${brand.name} asks for a password. Open the drive and sign in — the admin creates the users and hands out the passwords.`
  );
  (err as Error & { status?: number }).status = 403;
  throw err;
}

/* ── users: the people who run the drives ─────────────────────────────────── */

/**
 * One cookie per drive, so somebody who runs two drives is signed in to both
 * independently and signing out of one leaves the other alone.
 */
function userCookieName(key: DriveKey): string {
  return `drive_user_${key.replace(/[^a-z0-9_-]/gi, "_")}`;
}

/**
 * What a user's password is stored as. Keyed by SESSION_SECRET, and labelled
 * differently from a drive's passcode so the same word used for both does not
 * produce the same row, and neither hash can be pasted into the other's column
 * to gain the other's rights.
 */
export async function hashUserPassword(password: string): Promise<string> {
  return hmac(`user-password:${password}`);
}

/**
 * Sign somebody in on their own drive.
 *
 * The user's id and their password's hash are both inside what gets signed, so
 * the cookie is only valid for that person with that password: the admin
 * changing it, or deleting them, retires the session at once rather than
 * leaving somebody signed in to a drive they have been taken off.
 */
export async function createUserSession(user: UserRow): Promise<void> {
  const expires = Date.now() + USER_MAX_AGE_SECONDS * 1000;
  const payload = `user.${user.drive_key}.${user.id}.${user.password_hash}.${expires}`;
  const token = `${expires}.${user.id}.${await hmac(payload)}`;

  (await cookies()).set(userCookieName(user.drive_key), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: USER_MAX_AGE_SECONDS,
  });
}

/** Sign out of one drive, leaving any others — and any drive pass — alone. */
export async function destroyUserSession(key: DriveKey): Promise<void> {
  (await cookies()).set(userCookieName(key), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * The user signed in on this drive, or null.
 *
 * Costs one indexed read of the users table, and only when a cookie is
 * actually present — a visitor with no session never touches D1 for this.
 */
export async function currentUser(key: DriveKey): Promise<UserRow | null> {
  try {
    const token = (await cookies()).get(userCookieName(key))?.value;
    if (!token) return null;

    // stamp.userId.signature — the id is carried in the clear so the row can be
    // fetched before the signature is checked; it is inside the signed payload
    // too, so swapping it invalidates the token.
    const first = token.indexOf(".");
    const last = token.lastIndexOf(".");
    if (first <= 0 || last <= first) return null;

    const stamp = token.slice(0, first);
    const id = token.slice(first + 1, last);
    const sig = token.slice(last + 1);

    const expires = Number(stamp);
    if (!Number.isFinite(expires) || Date.now() >= expires) return null;

    const user = await getUser(id);
    if (!user || user.drive_key !== key) return null;

    const payload = `user.${user.drive_key}.${user.id}.${user.password_hash}.${stamp}`;
    if (!safeEqual(sig, await hmac(payload))) return null;

    return user;
  } catch {
    // A missing SESSION_SECRET or an unmigrated database must read as "nobody
    // is signed in", never as a crash on a page a visitor is entitled to see.
    return null;
  }
}

/** Check a typed password against this drive's users; the row, or null. */
export async function verifyUserPassword(
  key: DriveKey,
  candidate: string
): Promise<UserRow | null> {
  if (!candidate) return null;
  return userWithPassword(key, await hashUserPassword(candidate));
}

/* ── what a caller may do with a drive ────────────────────────────────────── */

/**
 * Whether the caller runs this drive — that is, whether they are signed in as
 * one of its users.
 *
 * Deliberately not true for the admin. The admin creates the users and hands
 * out the passwords; adding a folder is the user's job, and an admin who
 * genuinely has to work inside a drive makes themselves a user of it, which is
 * visible in the panel rather than silent.
 */
export async function isDriveUser(brand: Brand): Promise<boolean> {
  return Boolean(await currentUser(brand.key));
}

/** Throws 403 unless the caller runs this drive. */
export async function requireDriveUser(brand: Brand): Promise<void> {
  if (await isDriveUser(brand)) return;
  const err = new Error(
    `Only ${brand.name}'s own users can change it. Sign in with your password — the admin creates the users and hands out the passwords.`
  );
  (err as Error & { status?: number }).status = 403;
  throw err;
}

/** Both facts at once, for the payloads and pages that render by role. */
export async function driveRoles(
  brand: Brand
): Promise<{ isAdmin: boolean; isUser: boolean; userName: string | null }> {
  const [admin, user] = await Promise.all([isAdmin(), currentUser(brand.key)]);
  return { isAdmin: admin, isUser: Boolean(user), userName: user?.name ?? null };
}
