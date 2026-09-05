/**
 * Who is allowed to see and change what.
 *
 * Two independent kinds of session, both signed cookies rather than rows, so
 * D1 is untouched on every page load:
 *
 *   - the admin session. One admin, one password from the environment, who
 *     manages every drive and can open all of them.
 *   - a per-drive access session. A private drive carries a passcode set in
 *     the admin panel; entering it mints a cookie that opens that drive and
 *     no other, so sharing one drive never discloses the rest.
 *
 * Both are an HMAC over an expiry stamp under SESSION_SECRET, and the drive
 * cookie signs the drive key alongside it so a token cannot be moved sideways
 * onto a different drive.
 */

import { cookies } from "next/headers";
import { passcodeHashFor } from "./drives";
import type { Brand, DriveKey } from "./brand";

const COOKIE = "drive_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

/** A drive pass lasts longer than an admin session; it grants far less. */
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

/* ── per-drive access ─────────────────────────────────────────────────────── */

/**
 * One cookie per drive, named after the drive's permanent key. Separate
 * cookies rather than one list keeps the drives independent: revoking one
 * drive's passcode touches no other drive's passes.
 */
function driveCookieName(key: DriveKey): string {
  return `drive_pass_${key.replace(/[^a-z0-9_-]/gi, "_")}`;
}

/**
 * What a drive's passcode is stored as. The HMAC is keyed by SESSION_SECRET,
 * so the database never holds the passcode itself and a leaked row does not
 * open the drive.
 */
export async function hashPasscode(passcode: string): Promise<string> {
  return hmac(`passcode:${passcode}`);
}

/**
 * Mint the pass that opens one drive.
 *
 * The passcode's own hash is inside what gets signed, so a pass is only valid
 * against the passcode it was issued for. Changing or clearing a drive's
 * passcode therefore invalidates every pass already handed out — which is what
 * an admin means by revoking one, and would not happen if the signature
 * covered only the key and the expiry.
 */
export async function createDriveSession(key: DriveKey): Promise<void> {
  const expires = Date.now() + DRIVE_MAX_AGE_SECONDS * 1000;
  const secretOfDrive = (await passcodeHashFor(key)) ?? "";
  const payload = `${key}.${secretOfDrive}.${expires}`;
  const token = `${expires}.${await hmac(payload)}`;

  (await cookies()).set(driveCookieName(key), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DRIVE_MAX_AGE_SECONDS,
  });
}

/** Drop one drive's pass, leaving any others in place. */
export async function destroyDriveSession(key: DriveKey): Promise<void> {
  (await cookies()).set(driveCookieName(key), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Whether the caller holds a valid, unexpired pass for this drive. */
async function hasDrivePass(key: DriveKey): Promise<boolean> {
  try {
    const token = (await cookies()).get(driveCookieName(key))?.value;
    if (!token) return false;

    const idx = token.lastIndexOf(".");
    if (idx <= 0) return false;

    const stamp = token.slice(0, idx);
    const sig = token.slice(idx + 1);

    // The drive key is inside the signed payload, so a pass for one drive
    // cannot be replayed against another by renaming the cookie; the passcode
    // hash is in there too, so a rotated passcode retires the old passes.
    const secretOfDrive = (await passcodeHashFor(key)) ?? "";
    if (!safeEqual(sig, await hmac(`${key}.${secretOfDrive}.${stamp}`))) return false;

    const expires = Number(stamp);
    return Number.isFinite(expires) && Date.now() < expires;
  } catch {
    return false;
  }
}

/**
 * May the caller see this drive at all?
 *
 * A public drive is open to everyone. A private one needs either the admin
 * session or that drive's pass. A private drive whose passcode has been
 * cleared is shut to everyone but the admin — that is the safe reading of a
 * half-configured drive, and the admin panel refuses to create one.
 */
export async function canOpenDrive(brand: Brand): Promise<boolean> {
  if (brand.visibility !== "private") return true;
  if (await isAdmin()) return true;
  return hasDrivePass(brand.key);
}

/** Throws 403 unless the caller may see the drive. */
export async function requireDriveAccess(brand: Brand): Promise<void> {
  if (await canOpenDrive(brand)) return;
  const err = new Error("This drive is private. Enter its passcode to open it.");
  (err as Error & { status?: number }).status = 403;
  throw err;
}

/**
 * Check a passcode against the stored hash. A drive with no passcode set
 * accepts none, so an unfinished private drive never falls open.
 */
export async function verifyDrivePasscode(
  key: DriveKey,
  candidate: string
): Promise<boolean> {
  const stored = await passcodeHashFor(key);
  if (!stored) return false;
  return safeEqual(stored, await hashPasscode(candidate));
}
