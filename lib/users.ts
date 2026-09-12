/**
 * The people who run the drives.
 *
 * The admin panel creates a user, gives them a password, and says which drive
 * is theirs. That is the whole of the admin's part. From then on that person
 * signs in to their own drive with their own password and does everything in
 * it — adds folders, renames and deletes them, uploads, manages revisions,
 * edits the drive's name and address — without asking anybody.
 *
 * Two things this module exists to keep:
 *
 *   - a password is never stored. What is stored is an HMAC under
 *     SESSION_SECRET (see lib/auth.ts), so a leaked row opens nothing, and
 *     nobody — the admin included — can read a password back out. It can only
 *     be replaced.
 *   - a user belongs to exactly one drive. Their password does nothing on any
 *     other drive, so signing in is always "this password, on this drive",
 *     which is one indexed read against that drive's users.
 *
 * Before D1 is configured — or before migration 006 has been run against a
 * live database — every read here answers "no users yet" rather than throwing,
 * so a deploy that lands ahead of its migration still serves the site.
 */

import { d1Query, d1Execute, isD1Configured } from "./d1";
import type { DriveKey } from "./brand";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  drive_key: string;
  password_hash: string;
  created_at: number;
  modified_at: number;
}

/**
 * A user as the admin panel renders them. Deliberately without the hash: this
 * crosses into a client component, and while the hash is not the password, it
 * is the thing a forged cookie would need.
 */
export interface DriveUser {
  id: string;
  name: string;
  email: string;
  driveKey: string;
  createdAt: number;
}

function toUser(row: UserRow): DriveUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? "",
    driveKey: row.drive_key,
    createdAt: Number(row.created_at),
  };
}

/**
 * A database that predates migration 006 has no users table. That is a
 * deploy-order problem, not data loss, so reads answer empty rather than
 * taking the site down.
 */
function isMissingTable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no such table:?\s*(main\.)?users/i.test(msg);
}

function badRequest(message: string): never {
  const err = new Error(message);
  (err as Error & { status?: number }).status = 400;
  throw err;
}

/**
 * Writes have nowhere to go without the table. Say which migration is owed
 * rather than letting SQLite's "no such table" reach the admin panel, where it
 * reads like the users are gone.
 */
async function requireTable(): Promise<void> {
  if (!isD1Configured()) {
    const err = new Error(
      "D1 is not configured, so users cannot be changed. Set the Cloudflare credentials first."
    );
    (err as Error & { status?: number }).status = 503;
    throw err;
  }
  try {
    await d1Query("SELECT 1 FROM users LIMIT 1");
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    const e = new Error(
      "This database has no users table yet. Run migrations/006_users.console.sql in the D1 console. No data has been lost."
    );
    (e as Error & { status?: number }).status = 409;
    throw e;
  }
}

const COLUMNS = "id, name, email, drive_key, password_hash, created_at, modified_at";

/** Every user, newest drive order, for the admin panel. */
export async function listUsers(): Promise<DriveUser[]> {
  if (!isD1Configured()) return [];
  try {
    const rows = await d1Query<UserRow>(
      `SELECT ${COLUMNS} FROM users ORDER BY drive_key ASC, name ASC`
    );
    return rows.map(toUser);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** How many people run this drive. Zero means nobody can change anything in it. */
export async function countUsersOf(drive: DriveKey): Promise<number> {
  if (!isD1Configured()) return 0;
  try {
    const rows = await d1Query<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users WHERE drive_key = ?",
      [drive]
    );
    return Number(rows[0]?.c ?? 0);
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}

/** One user by id, hash included — only the session check has a use for that. */
export async function getUser(id: string): Promise<UserRow | null> {
  if (!isD1Configured()) return null;
  try {
    const rows = await d1Query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * Whoever on this drive has this password hash, or null.
 *
 * The hash is computed by the caller (lib/auth.ts owns SESSION_SECRET) and
 * matched by the (drive_key, password_hash) index, so a sign-in costs one
 * indexed read no matter how many users exist. Two people on one drive sharing
 * a password would be indistinguishable, which is why the panel warns rather
 * than allowing it silently — see `passwordTakenOn`.
 */
export async function userWithPassword(
  drive: DriveKey,
  passwordHash: string
): Promise<UserRow | null> {
  if (!isD1Configured()) return null;
  try {
    const rows = await d1Query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE drive_key = ? AND password_hash = ? LIMIT 1`,
      [drive, passwordHash]
    );
    return rows[0] ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** Whether somebody on this drive already uses this password. */
async function passwordTakenOn(
  drive: DriveKey,
  passwordHash: string,
  exceptId?: string
): Promise<boolean> {
  const hit = await userWithPassword(drive, passwordHash);
  return Boolean(hit && hit.id !== exceptId);
}

export interface UserInput {
  name?: string;
  email?: string;
  driveKey?: string;
}

function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) badRequest("A user needs a name.");
  if (name.length > 200) badRequest("That name is too long.");
  return name;
}

function cleanEmail(raw: unknown): string {
  const email = typeof raw === "string" ? raw.trim() : "";
  if (!email) return "";
  // Deliberately loose: enough to catch a typo, not enough to reject an
  // address that is unusual but real.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) badRequest("That email address looks wrong.");
  return email.slice(0, 320);
}

/**
 * Add a user to a drive.
 *
 * The password arrives already hashed, so this module never sees one. It is
 * required: a user without a password could not sign in, which would make the
 * row a note to self rather than an account.
 */
export async function createUser(
  input: UserInput,
  passwordHash: string
): Promise<DriveUser> {
  await requireTable();

  const name = cleanName(input.name);
  const email = cleanEmail(input.email);
  const driveKey = (input.driveKey ?? "").trim();
  if (!driveKey) badRequest("Say which drive this user runs.");
  if (!passwordHash) badRequest("A user needs a password.");

  if (await passwordTakenOn(driveKey, passwordHash)) {
    badRequest(
      "Somebody on that drive already uses that password. Two people with the same one cannot be told apart, so give this user a different password."
    );
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  await d1Execute(
    `INSERT INTO users (id, name, email, drive_key, password_hash, created_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, email, driveKey, passwordHash, now, now]
  );

  const created = await getUser(id);
  if (!created) throw new Error("The user was written but could not be read back.");
  return toUser(created);
}

/**
 * Edit a user. Only the fields present are touched, so the panel can send one
 * change at a time.
 *
 * `passwordHash` follows the convention the panel depends on: undefined leaves
 * the password alone, a string replaces it. There is no "clear" — a user with
 * no password could not sign in, and the way to take somebody's access away is
 * to delete them or move them off the drive.
 */
export async function updateUser(
  id: string,
  patch: UserInput,
  passwordHash?: string
): Promise<DriveUser> {
  await requireTable();

  const current = await getUser(id);
  if (!current) {
    const err = new Error("That user no longer exists.");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    params.push(value);
  };

  if (patch.name !== undefined) push("name", cleanName(patch.name));
  if (patch.email !== undefined) push("email", cleanEmail(patch.email));

  // Moving somebody to another drive takes their old drive away and gives them
  // the new one, which is the same thing the admin would otherwise do by
  // deleting and recreating them — and this way their name survives it.
  const driveKey = patch.driveKey?.trim();
  if (driveKey && driveKey !== current.drive_key) push("drive_key", driveKey);

  if (passwordHash !== undefined) {
    if (!passwordHash) badRequest("A user needs a password.");
    // Checked against the drive they will be on once this save lands, not the
    // one they are on now.
    if (await passwordTakenOn(driveKey || current.drive_key, passwordHash, id)) {
      badRequest(
        "Somebody on that drive already uses that password. Two people with the same one cannot be told apart, so choose a different one."
      );
    }
    push("password_hash", passwordHash);
  }

  if (!sets.length) return toUser(current);

  push("modified_at", Date.now());
  params.push(id);
  await d1Execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);

  const updated = await getUser(id);
  if (!updated) throw new Error("The user was updated but could not be read back.");
  return toUser(updated);
}

/**
 * Remove a user. Their drive and everything in it is untouched — deleting the
 * person who ran a drive is not a reason to delete what they put in it.
 */
export async function deleteUser(id: string): Promise<void> {
  await requireTable();
  const changed = await d1Execute("DELETE FROM users WHERE id = ?", [id]);
  if (!changed) {
    const err = new Error("That user no longer exists.");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
}
