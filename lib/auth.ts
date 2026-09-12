/**
 * Who is allowed to see and change what.
 *
 * Two passwords, and that is the whole of it:
 *
 *   - each DRIVE has one. The admin sets it in the admin panel and gives it to
 *     whoever the drive is for. They open the drive's link, enter it, and
 *     everything in there is theirs — folders, files, revisions, and the
 *     drive's own name and address. There is no separate account to manage and
 *     nothing else to be granted: the drive's password is the drive.
 *   - the ADMIN has one, from the environment. It opens the admin panel, where
 *     the drives are created, their passwords set, and their storage limits
 *     decided. It does not open a drive.
 *
 * Both sessions are an HMAC over an expiry stamp under SESSION_SECRET. A
 * drive's session signs the drive key and the drive's own password hash
 * alongside it, so a cookie cannot be moved sideways onto another drive, and
 * the admin changing a drive's password signs out everybody holding the old
 * one — immediately, which is what changing it is for.
 */

import { cookies } from "next/headers";
import { passcodeHashFor } from "./drives";
import type { Brand, DriveKey } from "./brand";

const COOKIE = "drive_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

/**
 * A drive's session lasts far longer than the admin's. It is held by the person
 * who uses the drive every day, and asking them for the password twice a day to
 * add a folder would be absurd. It stays revocable in a way the admin session
 * is not: the cookie signs the password hash it was issued against, so changing
 * the drive's password in the panel ends every session on it at once.
 */
const DRIVE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

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
 * One cookie per drive, named after the drive's permanent key. Separate
 * cookies rather than one list keeps the drives independent: changing one
 * drive's password touches nobody's session on any other.
 */
function driveCookieName(key: DriveKey): string {
  return `drive_pass_${key.replace(/[^a-z0-9_-]/gi, "_")}`;
}

/**
 * What a drive's password is stored as. The HMAC is keyed by SESSION_SECRET,
 * so the database never holds the password itself, a leaked row opens nothing,
 * and nobody — the admin included — can read a password back out. It can only
 * be replaced.
 */
export async function hashPasscode(password: string): Promise<string> {
  return hmac(`passcode:${password}`);
}

/**
 * Let somebody into one drive.
 *
 * The drive's own password hash is inside what gets signed, so a session is
 * only valid against the password it was issued for: changing the password in
 * the admin panel invalidates every session already handed out, which is what
 * changing it means and would not happen if the signature covered only the key
 * and the expiry.
 */
export async function createDriveSession(key: DriveKey): Promise<void> {
  const expires = Date.now() + DRIVE_MAX_AGE_SECONDS * 1000;
  const behind = (await passcodeHashFor(key)) ?? "";
  const token = `${expires}.${await hmac(`${key}.${behind}.${expires}`)}`;

  (await cookies()).set(driveCookieName(key), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DRIVE_MAX_AGE_SECONDS,
  });
}

/** Sign out of one drive, leaving any others alone. */
export async function destroyDriveSession(key: DriveKey): Promise<void> {
  (await cookies()).set(driveCookieName(key), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * May the caller see this drive at all?
 *
 * One question, and it is the same one that decides whether they may change
 * it: are they through the drive's password? A drive is somebody's, it sits
 * behind one password, and once they are through it everything in it is
 * theirs. There is no weaker credential that would let somebody look without
 * touching, and no drive that opens to anyone with the link.
 *
 * Not satisfied by the admin session. The admin sets the passwords and hands
 * them out; opening a drive means having its password, like anybody else.
 *
 * A drive with no password set is shut to everyone — that is the honest
 * reading of a drive that has not been given to anybody yet, and the admin
 * panel says so on its row.
 */
export async function canOpenDrive(brand: Brand): Promise<boolean> {
  try {
    const token = (await cookies()).get(driveCookieName(brand.key))?.value;
    if (!token) return false;

    const idx = token.lastIndexOf(".");
    if (idx <= 0) return false;

    const stamp = token.slice(0, idx);
    const sig = token.slice(idx + 1);

    const expires = Number(stamp);
    if (!Number.isFinite(expires) || Date.now() >= expires) return false;

    // A drive with no password cannot be open, whatever cookie is presented:
    // the empty hash must not become a signature anybody can hold.
    const behind = await passcodeHashFor(brand.key);
    if (!behind) return false;

    return safeEqual(sig, await hmac(`${brand.key}.${behind}.${stamp}`));
  } catch {
    // A missing SESSION_SECRET or an unreachable database must read as "not
    // signed in", never as a crash on a page somebody is entitled to see.
    return false;
  }
}

/** Throws 403 unless the caller is through the drive's password. */
export async function requireDriveAccess(brand: Brand): Promise<void> {
  if (await canOpenDrive(brand)) return;
  const err = new Error(
    `${brand.name} asks for its password. Open the drive and sign in — the admin sets the passwords.`
  );
  (err as Error & { status?: number }).status = 403;
  throw err;
}

/**
 * Check a typed password against the drive's own. A drive with no password set
 * accepts none, so a drive nobody has been given never falls open.
 */
export async function verifyDrivePassword(
  key: DriveKey,
  candidate: string
): Promise<boolean> {
  if (!candidate) return false;
  const stored = await passcodeHashFor(key);
  if (!stored) return false;
  return safeEqual(stored, await hashPasscode(candidate));
}

/* ── what the caller may do ───────────────────────────────────────────────── */

/**
 * Whether the caller runs this drive. The same question as whether they can
 * open it: being through a drive's password is what makes it theirs, and there
 * is nothing further to be granted.
 */
export async function isDriveUser(brand: Brand): Promise<boolean> {
  return canOpenDrive(brand);
}

/** Throws unless the caller runs this drive. */
export async function requireDriveUser(brand: Brand): Promise<void> {
  return requireDriveAccess(brand);
}

/** Both facts at once, for the payloads and pages that render by role. */
export async function driveRoles(
  brand: Brand
): Promise<{ isAdmin: boolean; isUser: boolean }> {
  const [admin, user] = await Promise.all([isAdmin(), isDriveUser(brand)]);
  return { isAdmin: admin, isUser: user };
}
