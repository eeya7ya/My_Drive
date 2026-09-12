/**
 * "Whose drive is this row in, and do you run it?"
 *
 * The folder, file and revision routes are addressed by row id rather than by
 * drive — `/api/files/abc123` says nothing about which drive abc123 lives in —
 * so each of them has to look the drive up before it can decide whether the
 * caller may change anything. That is one indexed lookup on a primary key and
 * the same three lines in five route files, so it lives here instead.
 *
 * A row that does not exist is a 404 and is answered before the permission
 * question, because "no such file" is not something an owner's seat would
 * change and the alternative — 403 for anything you do not own, including
 * things that are not there — would turn these routes into a way of asking
 * which ids exist.
 */

import { requireDriveOwner } from "./auth";
import { getDrive } from "./drives";
import { driveOfFile, driveOfFolder, driveOfVersion } from "./store";
import type { Brand, DriveKey } from "./brand";

function notFound(what: string): never {
  const err = new Error(`That ${what} no longer exists.`);
  (err as Error & { status?: number }).status = 404;
  throw err;
}

/**
 * The drive a row belongs to, as a Brand — which is what the owner check needs,
 * since its refusal names the drive and has to know whether it has an owner at
 * all. A row whose drive key matches no registry row is treated as missing:
 * it cannot be managed by anyone, and saying so is better than a 500.
 */
async function driveOf(key: DriveKey | null, what: string): Promise<Brand> {
  if (!key) notFound(what);
  const brand = await getDrive(key);
  if (!brand) notFound(what);
  return brand;
}

/** Throws unless the caller owns the drive this folder is in. */
export async function requireFolderOwner(id: string): Promise<Brand> {
  const brand = await driveOf(await driveOfFolder(id), "folder");
  await requireDriveOwner(brand);
  return brand;
}

/** Throws unless the caller owns the drive this file is in. */
export async function requireFileOwner(id: string): Promise<Brand> {
  const brand = await driveOf(await driveOfFile(id), "file");
  await requireDriveOwner(brand);
  return brand;
}

/** Throws unless the caller owns the drive this revision's file is in. */
export async function requireVersionOwner(versionId: string): Promise<Brand> {
  const brand = await driveOf(await driveOfVersion(versionId), "revision");
  await requireDriveOwner(brand);
  return brand;
}
