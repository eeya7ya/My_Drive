/**
 * The drive registry: which drives exist, where each one answers, and who may
 * open it.
 *
 * Drives were a hardcoded record in lib/brand.ts until the admin panel needed
 * to add one. They are rows now, read on every request that names a drive —
 * one small indexed query against a table that holds a handful of rows.
 *
 * Two rules this module exists to keep:
 *
 *   - `key` is permanent. folders.drive and files.drive already store it, so
 *     renaming a drive changes its `slug` and never its key.
 *   - a slug the drive has answered to before keeps working. Old addresses go
 *     to drive_slugs on every rename, so a shared link outlives the rename.
 *
 * Before D1 is configured — or before migration 005 has been run against a
 * live database — every read here falls back to the two drives the migration
 * seeds, so a deploy that lands ahead of its migration still serves the site
 * instead of an error page.
 */

import { d1Query, d1Execute, isD1Configured } from "./d1";
import {
  Brand,
  DriveKey,
  DriveVisibility,
  FALLBACK_DRIVES,
  brandFrom,
  isReservedSlug,
  slugifyDrive,
} from "./brand";

export interface DriveRow {
  key: string;
  slug: string;
  name: string;
  tagline: string;
  title: string;
  short_name: string;
  description: string;
  numbered: number;
  powered_by: string | null;
  visibility: string;
  listed: number;
  passcode_hash: string | null;
  legacy_root: number;
  position: number;
  created_at: number;
  modified_at: number;
}

export interface DriveRequestRow {
  id: string;
  drive_key: string | null;
  name: string;
  email: string;
  note: string;
  status: string;
  created_at: number;
  handled_at: number | null;
}

/** A request as the admin panel renders it, with the drive's name resolved. */
export interface DriveRequest {
  id: string;
  driveKey: string | null;
  driveName: string | null;
  name: string;
  email: string;
  note: string;
  status: "new" | "approved" | "dismissed";
  createdAt: number;
  handledAt: number | null;
}

/** The public half of a drive row. The passcode hash never crosses this line. */
function toBrand(row: DriveRow): Brand {
  return brandFrom({
    key: row.key,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline ?? "",
    title: row.title || row.name,
    shortName: row.short_name || row.name,
    description: row.description ?? "",
    numbered: Number(row.numbered) === 1,
    poweredBy: row.powered_by || null,
    visibility: row.visibility === "private" ? "private" : "public",
    listed: Number(row.listed) === 1,
    hasPasscode: Boolean(row.passcode_hash),
    legacyRoot: Number(row.legacy_root) === 1,
    position: Number(row.position) || 0,
  });
}

/**
 * A database that predates migration 005 has no drives table. That is a
 * deploy-order problem, not data loss, so the registry answers from the
 * fallback list rather than taking the site down.
 */
function isMissingRegistry(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no such table:?\s*(main\.)?(drives|drive_slugs|drive_requests)/i.test(msg);
}

const ALL_COLUMNS =
  "key, slug, name, tagline, title, short_name, description, numbered, powered_by, " +
  "visibility, listed, passcode_hash, legacy_root, position, created_at, modified_at";

/** Every drive, in dashboard order. */
export async function listDrives(): Promise<Brand[]> {
  if (!isD1Configured()) return FALLBACK_DRIVES;
  try {
    const rows = await d1Query<DriveRow>(
      `SELECT ${ALL_COLUMNS} FROM drives ORDER BY position ASC, name ASC`
    );
    return rows.length ? rows.map(toBrand) : FALLBACK_DRIVES;
  } catch (err) {
    if (isMissingRegistry(err)) return FALLBACK_DRIVES;
    throw err;
  }
}

/** The drives the dashboard names. Unlisted ones are reachable only by URL. */
export async function listedDrives(): Promise<Brand[]> {
  return (await listDrives()).filter((d) => d.listed);
}

/** One drive by its permanent key. */
export async function getDrive(key: DriveKey): Promise<Brand | null> {
  if (!isD1Configured()) {
    return FALLBACK_DRIVES.find((d) => d.key === key) ?? null;
  }
  try {
    const rows = await d1Query<DriveRow>(
      `SELECT ${ALL_COLUMNS} FROM drives WHERE key = ? LIMIT 1`,
      [key]
    );
    if (rows.length) return toBrand(rows[0]);
    // An empty registry means the seed has not run; answer from the fallback
    // so the two drives that already have data stay reachable.
    const seeded = await listDrives();
    return seeded.find((d) => d.key === key) ?? null;
  } catch (err) {
    if (isMissingRegistry(err)) {
      return FALLBACK_DRIVES.find((d) => d.key === key) ?? null;
    }
    throw err;
  }
}

/**
 * The drive reached at a URL segment.
 *
 * `canonical` is false when the slug is one the drive used to answer to; the
 * caller redirects to the current address rather than serving two URLs for
 * one drive.
 */
export async function resolveDriveSlug(
  slug: string
): Promise<{ brand: Brand; canonical: boolean } | null> {
  const wanted = slug.toLowerCase();

  if (!isD1Configured()) {
    const hit = FALLBACK_DRIVES.find((d) => d.slug === wanted);
    return hit ? { brand: hit, canonical: true } : null;
  }

  try {
    const rows = await d1Query<DriveRow>(
      `SELECT ${ALL_COLUMNS} FROM drives WHERE slug = ? LIMIT 1`,
      [wanted]
    );
    if (rows.length) return { brand: toBrand(rows[0]), canonical: true };

    const old = await d1Query<{ drive_key: string }>(
      "SELECT drive_key FROM drive_slugs WHERE slug = ? LIMIT 1",
      [wanted]
    );
    if (old.length) {
      const brand = await getDrive(old[0].drive_key);
      if (brand) return { brand, canonical: false };
    }
    return null;
  } catch (err) {
    if (isMissingRegistry(err)) {
      const hit = FALLBACK_DRIVES.find((d) => d.slug === wanted);
      return hit ? { brand: hit, canonical: true } : null;
    }
    throw err;
  }
}

/**
 * The drive whose folders used to sit at the site root. Its old links —
 * /literature/papers/x.pdf — are redirected under its new address instead of
 * being served, so no URL means two different things.
 */
export async function legacyRootDrive(): Promise<Brand | null> {
  return (await listDrives()).find((d) => d.legacyRoot) ?? null;
}

/**
 * The drive a request names, as a key that certainly exists.
 *
 * Callers pass whatever arrived in `?drive=` or a JSON body. An unknown key is
 * a 400, never a silent fall-through into another drive's rows. An absent key
 * means the legacy root drive, so a client written before drives were named
 * keeps working.
 */
export async function parseDriveKey(raw: unknown): Promise<Brand> {
  if (raw === undefined || raw === null || raw === "") {
    const root = await legacyRootDrive();
    if (root) return root;
    const err = new Error("No drive named, and no default drive is configured");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  if (typeof raw === "string") {
    const brand = await getDrive(raw);
    if (brand) return brand;
  }
  const err = new Error(`Unknown drive "${String(raw)}"`);
  (err as Error & { status?: number }).status = 400;
  throw err;
}

/** The stored passcode hash, read only by the access check in lib/auth.ts. */
export async function passcodeHashFor(key: DriveKey): Promise<string | null> {
  if (!isD1Configured()) return null;
  try {
    const rows = await d1Query<{ passcode_hash: string | null }>(
      "SELECT passcode_hash FROM drives WHERE key = ? LIMIT 1",
      [key]
    );
    return rows[0]?.passcode_hash ?? null;
  } catch (err) {
    if (isMissingRegistry(err)) return null;
    throw err;
  }
}

export interface DriveInput {
  key?: string;
  slug?: string;
  name?: string;
  tagline?: string;
  title?: string;
  shortName?: string;
  description?: string;
  numbered?: boolean;
  poweredBy?: string | null;
  visibility?: DriveVisibility;
  listed?: boolean;
  position?: number;
}

function badRequest(message: string): never {
  const err = new Error(message);
  (err as Error & { status?: number }).status = 400;
  throw err;
}

/**
 * Reads fall back to the seeded pair when the registry is missing, but a write
 * has nowhere to go. Say which migration is owed rather than letting SQLite's
 * "no such table" reach the admin panel, where it reads like the drives are
 * gone.
 */
async function requireRegistry(): Promise<void> {
  if (!isD1Configured()) {
    const err = new Error(
      "D1 is not configured, so drives cannot be changed. Set the Cloudflare credentials first."
    );
    (err as Error & { status?: number }).status = 503;
    throw err;
  }
  try {
    await d1Query("SELECT 1 FROM drives LIMIT 1");
  } catch (err) {
    if (!isMissingRegistry(err)) throw err;
    const e = new Error(
      "This database has no drives table yet. Run migrations/005_drive_registry.console.sql in the D1 console. No data has been lost."
    );
    (e as Error & { status?: number }).status = 409;
    throw e;
  }
}

/** Reject a slug that would shadow a first-party page or another drive. */
async function assertSlugFree(slug: string, exceptKey?: string): Promise<void> {
  if (!slug) badRequest("A drive needs an address.");
  if (isReservedSlug(slug)) {
    badRequest(`"${slug}" is used by the site itself — choose another address.`);
  }
  const taken = await d1Query<{ key: string }>(
    "SELECT key FROM drives WHERE slug = ? LIMIT 1",
    [slug]
  );
  if (taken.length && taken[0].key !== exceptKey) {
    badRequest(`Another drive already answers at /${slug}.`);
  }
  // A slug retired by one drive must not be claimed by another, or an old
  // link would quietly deliver someone to the wrong drive.
  const historic = await d1Query<{ drive_key: string }>(
    "SELECT drive_key FROM drive_slugs WHERE slug = ? LIMIT 1",
    [slug]
  );
  if (historic.length && historic[0].drive_key !== exceptKey) {
    badRequest(`/${slug} used to belong to another drive, so it cannot be reused.`);
  }
}

/**
 * Add a drive. Its key is derived from the slug and fixed forever after, since
 * every folder and file row will carry it.
 */
export async function createDrive(
  input: DriveInput,
  passcodeHash: string | null
): Promise<Brand> {
  await requireRegistry();

  const name = (input.name ?? "").trim();
  if (!name) badRequest("A drive needs a name.");

  const slug = slugifyDrive(input.slug?.trim() || name);
  await assertSlugFree(slug);

  const key = slugifyDrive(input.key?.trim() || slug);
  const clash = await d1Query<{ key: string }>(
    "SELECT key FROM drives WHERE key = ? LIMIT 1",
    [key]
  );
  if (clash.length) badRequest(`A drive with the key "${key}" already exists.`);

  const visibility: DriveVisibility = input.visibility === "private" ? "private" : "public";
  if (visibility === "private" && !passcodeHash) {
    badRequest("A private drive needs a passcode.");
  }

  const now = Date.now();
  const next = await d1Query<{ n: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM drives"
  );

  await d1Execute(
    `INSERT INTO drives
       (key, slug, name, tagline, title, short_name, description, numbered, powered_by,
        visibility, listed, passcode_hash, legacy_root, position, created_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      key,
      slug,
      name,
      input.tagline ?? "",
      input.title?.trim() || name,
      input.shortName?.trim() || name,
      input.description ?? "",
      input.numbered ? 1 : 0,
      input.poweredBy || null,
      visibility,
      input.listed === false ? 0 : 1,
      passcodeHash,
      input.position ?? Number(next[0]?.n ?? 0),
      now,
      now,
    ]
  );

  const created = await getDrive(key);
  if (!created) throw new Error("The drive was written but could not be read back.");
  return created;
}

/**
 * Edit a drive. Only the fields present are touched, so the admin panel can
 * send one change at a time.
 *
 * `passcodeHash` follows a three-way convention: undefined leaves the passcode
 * alone, null clears it, a string sets it.
 */
export async function updateDrive(
  key: DriveKey,
  patch: DriveInput,
  passcodeHash?: string | null
): Promise<Brand> {
  await requireRegistry();

  const current = await getDrive(key);
  if (!current) {
    const err = new Error(`Unknown drive "${key}"`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    params.push(value);
  };

  if (patch.slug !== undefined) {
    const slug = slugifyDrive(patch.slug.trim());
    if (slug !== current.slug) {
      await assertSlugFree(slug, key);
      // Keep the address it is leaving, so links already shared still land.
      await d1Execute(
        "INSERT OR IGNORE INTO drive_slugs (slug, drive_key, created_at) VALUES (?, ?, ?)",
        [current.slug, key, Date.now()]
      );
      push("slug", slug);
    }
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) badRequest("A drive needs a name.");
    push("name", name);
  }
  if (patch.tagline !== undefined) push("tagline", patch.tagline);
  if (patch.title !== undefined) push("title", patch.title.trim() || current.title);
  if (patch.shortName !== undefined) push("short_name", patch.shortName.trim() || current.shortName);
  if (patch.description !== undefined) push("description", patch.description);
  if (patch.numbered !== undefined) push("numbered", patch.numbered ? 1 : 0);
  if (patch.poweredBy !== undefined) push("powered_by", patch.poweredBy || null);
  if (patch.listed !== undefined) push("listed", patch.listed ? 1 : 0);
  if (patch.position !== undefined) push("position", patch.position);

  if (passcodeHash !== undefined) push("passcode_hash", passcodeHash);

  // A drive left private with no passcode is shut to everyone, the people it
  // was closed for included. Judge the state the write would leave behind
  // rather than the field that happens to be in this request: clearing the
  // passcode of a drive that stays private is the same mistake as closing a
  // drive that has none.
  const nextVisibility: DriveVisibility =
    patch.visibility === undefined
      ? current.visibility
      : patch.visibility === "private"
        ? "private"
        : "public";

  if (nextVisibility === "private") {
    const willHave = passcodeHash !== undefined ? passcodeHash : await passcodeHashFor(key);
    if (!willHave) {
      badRequest(
        patch.visibility === undefined
          ? "Removing the passcode would shut this private drive to everyone. Make it public first, or set a new passcode."
          : "Set a passcode before making this drive private."
      );
    }
  }

  if (patch.visibility !== undefined) push("visibility", nextVisibility);

  if (!sets.length) return current;

  push("modified_at", Date.now());
  params.push(key);
  await d1Execute(`UPDATE drives SET ${sets.join(", ")} WHERE key = ?`, params);

  const updated = await getDrive(key);
  if (!updated) throw new Error("The drive was updated but could not be read back.");
  return updated;
}

/**
 * Remove a drive from the registry.
 *
 * Its folders and files are left alone on purpose: dropping a registry row is
 * a reversible mistake, deleting a tree is not. A drive that still holds rows
 * has to be emptied first, so this can never be the way data disappears.
 */
export async function deleteDrive(key: DriveKey): Promise<void> {
  await requireRegistry();

  const current = await getDrive(key);
  if (!current) {
    const err = new Error(`Unknown drive "${key}"`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  if (current.legacyRoot) {
    badRequest("The drive that owns the site's old root links cannot be removed.");
  }

  const [folders, files] = await Promise.all([
    d1Query<{ c: number }>("SELECT COUNT(*) AS c FROM folders WHERE drive = ?", [key]),
    d1Query<{ c: number }>("SELECT COUNT(*) AS c FROM files WHERE drive = ?", [key]),
  ]);
  const held = Number(folders[0]?.c ?? 0) + Number(files[0]?.c ?? 0);
  if (held > 0) {
    badRequest(
      `This drive still holds ${held} folder${held === 1 ? "" : "s"} and files. Empty it first, or hide it instead.`
    );
  }

  await d1Execute("DELETE FROM drive_slugs WHERE drive_key = ?", [key]);
  await d1Execute("DELETE FROM drives WHERE key = ?", [key]);
}

/* ── access requests ──────────────────────────────────────────────────────── */

const MAX_NOTE = 2000;

/** Record a request raised from the dashboard. Public, so it is kept small. */
export async function createRequest(input: {
  driveKey?: string | null;
  name?: string;
  email?: string;
  note?: string;
}): Promise<void> {
  await requireRegistry();

  const name = (input.name ?? "").trim().slice(0, 200);
  const email = (input.email ?? "").trim().slice(0, 320);
  const note = (input.note ?? "").trim().slice(0, MAX_NOTE);

  if (!name) badRequest("Please give a name.");
  // Deliberately loose: enough to catch a typo, not enough to reject an
  // address that is unusual but real.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) badRequest("Please give an email address.");

  let driveKey: string | null = null;
  if (input.driveKey) {
    const brand = await getDrive(input.driveKey);
    if (!brand) badRequest("That drive does not exist.");
    driveKey = brand.key;
  }

  const now = Date.now();
  await d1Execute(
    `INSERT INTO drive_requests (id, drive_key, name, email, note, status, created_at, handled_at)
     VALUES (?, ?, ?, ?, ?, 'new', ?, NULL)`,
    [crypto.randomUUID(), driveKey, name, email, note, now]
  );
}

/** Every request, newest first, with drive names resolved for the panel. */
export async function listRequests(): Promise<DriveRequest[]> {
  if (!isD1Configured()) return [];
  try {
    const rows = await d1Query<DriveRequestRow>(
      "SELECT * FROM drive_requests ORDER BY created_at DESC LIMIT 500"
    );
    const drives = await listDrives();
    const nameOf = new Map(drives.map((d) => [d.key, d.name]));
    return rows.map((r) => ({
      id: r.id,
      driveKey: r.drive_key,
      driveName: r.drive_key ? (nameOf.get(r.drive_key) ?? r.drive_key) : null,
      name: r.name,
      email: r.email,
      note: r.note,
      status: r.status === "approved" || r.status === "dismissed" ? r.status : "new",
      createdAt: Number(r.created_at),
      handledAt: r.handled_at === null ? null : Number(r.handled_at),
    }));
  } catch (err) {
    if (isMissingRegistry(err)) return [];
    throw err;
  }
}

/** How many requests are still waiting — the badge on the admin panel. */
export async function countNewRequests(): Promise<number> {
  if (!isD1Configured()) return 0;
  try {
    const rows = await d1Query<{ c: number }>(
      "SELECT COUNT(*) AS c FROM drive_requests WHERE status = 'new'"
    );
    return Number(rows[0]?.c ?? 0);
  } catch (err) {
    if (isMissingRegistry(err)) return 0;
    throw err;
  }
}

export async function setRequestStatus(
  id: string,
  status: "new" | "approved" | "dismissed"
): Promise<void> {
  const changed = await d1Execute(
    "UPDATE drive_requests SET status = ?, handled_at = ? WHERE id = ?",
    [status, status === "new" ? null : Date.now(), id]
  );
  if (!changed) {
    const err = new Error("That request no longer exists.");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
}

export async function deleteRequest(id: string): Promise<void> {
  await d1Execute("DELETE FROM drive_requests WHERE id = ?", [id]);
}
