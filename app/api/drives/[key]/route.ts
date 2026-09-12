/**
 * Editing and removing one drive, addressed by the key it will carry forever.
 *
 * The key is in the path rather than the body because it is the one field a
 * drive cannot change — every folder and file row already stores it — so it
 * reads as the address of the thing rather than as another editable field.
 *
 * One route, two callers, and the interesting part is which fields each of
 * them may send:
 *
 *   - the drive's OWNER may change the drive itself — what it is called, where
 *     it answers, whether its folders are numbered, and the passcode its
 *     readers are given. That is the drive they run.
 *   - the ADMIN may change the drive's place among the others — who owns it,
 *     whether the dashboard lists it, where it sits in the order — and, via
 *     `quotaBytes`, how much it may store.
 *
 * The lists live in lib/drives.ts (OWNER_FIELDS / ADMIN_FIELDS) so there is
 * one answer to "whose field is that?", and a body that reaches for the other
 * role's fields is refused by name rather than quietly ignored: a panel that
 * sent a field it was not allowed to send should hear about it, not watch the
 * save succeed and the value stay as it was.
 *
 * Both passcodes follow the three-way convention the panels depend on: a field
 * left out leaves it as it was, null clears it, and a string sets it. Without
 * that, a form that sends everything on every save would wipe the passcode of
 * any drive whose form did not repeat it.
 */

import {
  ADMIN_FIELDS,
  OWNER_FIELDS,
  deleteDrive,
  getDrive,
  updateDrive,
} from "@/lib/drives";
import {
  hashOwnerPasscode,
  hashPasscode,
  isAdmin,
  isDriveOwner,
  requireAdmin,
} from "@/lib/auth";
import { setQuota } from "@/lib/store";
import { ok, fail, readJson, badRequest } from "@/lib/api";
import type { DriveInput } from "@/lib/drives";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

function asText(value: unknown, field: string): string {
  if (typeof value !== "string") badRequest(`${field} must be text.`);
  return value;
}

function asFlag(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") badRequest(`${field} must be true or false.`);
  return value;
}

/**
 * Lift the drive fields out of a JSON body one at a time and by name, so a
 * property nobody asked for can never reach a column and a wrong type is a 400
 * rather than a strange row. Absent means absent here: only the fields the
 * body actually carries are handed on, which is what makes a one-field save
 * possible. The picker is repeated in the collection route because a route
 * file may export only its handlers.
 */
function driveFieldsFrom(body: Record<string, unknown>): DriveInput {
  const out: DriveInput = {};

  if (body.slug !== undefined) out.slug = asText(body.slug, "slug");
  if (body.name !== undefined) out.name = asText(body.name, "name");
  if (body.tagline !== undefined) out.tagline = asText(body.tagline, "tagline");
  if (body.title !== undefined) out.title = asText(body.title, "title");
  if (body.shortName !== undefined) out.shortName = asText(body.shortName, "shortName");
  if (body.description !== undefined) out.description = asText(body.description, "description");
  if (body.numbered !== undefined) out.numbered = asFlag(body.numbered, "numbered");
  if (body.poweredBy !== undefined) {
    out.poweredBy = body.poweredBy === null ? null : asText(body.poweredBy, "poweredBy");
  }
  if (body.visibility !== undefined) {
    const visibility = asText(body.visibility, "visibility");
    if (visibility !== "public" && visibility !== "private") {
      badRequest('visibility must be "public" or "private".');
    }
    out.visibility = visibility;
  }
  if (body.listed !== undefined) out.listed = asFlag(body.listed, "listed");
  if (body.position !== undefined) {
    if (typeof body.position !== "number" || !Number.isFinite(body.position)) {
      badRequest("position must be a number.");
    }
    out.position = body.position;
  }
  if (body.ownerName !== undefined) out.ownerName = asText(body.ownerName, "ownerName");
  if (body.ownerEmail !== undefined) out.ownerEmail = asText(body.ownerEmail, "ownerEmail");

  return out;
}

/** Refuse a body that reaches past the caller's role, naming what it reached for. */
function assertFieldsAllowed(
  body: Record<string, unknown>,
  allowed: readonly string[],
  role: "owner" | "admin"
): void {
  const forbidden: string[] = [...ADMIN_FIELDS, ...OWNER_FIELDS].filter(
    (field) => body[field] !== undefined && !allowed.includes(field)
  );
  if (body.passcode !== undefined && !allowed.includes("passcode")) forbidden.push("passcode");
  if (body.ownerPasscode !== undefined && !allowed.includes("ownerPasscode")) {
    forbidden.push("ownerPasscode");
  }
  if (body.quotaBytes !== undefined && !allowed.includes("quotaBytes")) {
    forbidden.push("quotaBytes");
  }
  if (!forbidden.length) return;

  badRequest(
    role === "owner"
      ? `${forbidden.join(", ")} ${forbidden.length === 1 ? "is" : "are"} the admin's to set, not the drive owner's.`
      : `${forbidden.join(", ")} ${forbidden.length === 1 ? "belongs" : "belong"} to the drive's owner, and ${forbidden.length === 1 ? "is" : "are"} changed from inside the drive by whoever holds its owner passcode.`
  );
}

/**
 * Change any subset of a drive's fields — the subset this caller's role owns.
 *
 * The owner is asked about first, so an admin who has signed in with a drive's
 * owner passcode is treated as its owner here rather than being told the name
 * of the drive they are standing in is somebody else's to set.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { key } = await params;

    const brand = await getDrive(key);
    if (!brand) {
      const err = new Error(`Unknown drive "${key}"`);
      (err as Error & { status?: number }).status = 404;
      throw err;
    }

    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      badRequest("Expected a JSON object.");
    }

    const owner = await isDriveOwner(brand);
    const admin = owner ? false : await isAdmin();
    if (!owner && !admin) {
      const err = new Error(
        `Only ${brand.name}'s owner can change it. Sign in with the drive's owner passcode.`
      );
      (err as Error & { status?: number }).status = 403;
      throw err;
    }

    // An owner also holds the reader's passcode, since deciding who may look
    // at the drive they run is part of running it.
    const allowed: readonly string[] = owner
      ? [...OWNER_FIELDS, "passcode"]
      : [...ADMIN_FIELDS, "ownerPasscode", "quotaBytes"];
    assertFieldsAllowed(body, allowed, owner ? "owner" : "admin");

    // undefined leaves a passcode alone; null and the empty string both mean
    // "there is no passcode now", since a form that has been emptied is asking
    // for exactly that.
    let hash: string | null | undefined;
    if (body.passcode !== undefined) {
      hash =
        body.passcode === null || body.passcode === ""
          ? null
          : await hashPasscode(asText(body.passcode, "passcode"));
    }

    // The admin handing the drive to somebody — or taking it back. Clearing it
    // leaves a drive nobody can manage until the next owner is named, which is
    // the right state for a drive between owners.
    let ownerHash: string | null | undefined;
    if (body.ownerPasscode !== undefined) {
      ownerHash =
        body.ownerPasscode === null || body.ownerPasscode === ""
          ? null
          : await hashOwnerPasscode(asText(body.ownerPasscode, "ownerPasscode"));
    }

    // The quota is not a drives column — it is a settings row, maintained
    // beside the storage counter it is the denominator of — so it is written
    // separately, and first: if the number is refused, nothing else has
    // changed yet.
    if (body.quotaBytes !== undefined) {
      if (typeof body.quotaBytes !== "number" || !Number.isFinite(body.quotaBytes)) {
        badRequest("quotaBytes must be a number of bytes.");
      }
      await setQuota(brand.key, body.quotaBytes);
    }

    // `key` is the address, not a field — a body that repeats it is ignored
    // rather than obeyed, since renaming it would orphan every row.
    const fields = driveFieldsFrom(body);
    const drive = await updateDrive(key, fields, hash, ownerHash);
    return ok({ drive });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Remove a drive from the registry. Admin only — which drives exist is the
 * level above the drives, and an owner deleting their own drive out from under
 * the dashboard is not a thing running a drive should include. Refused by
 * lib/drives.ts while the drive still holds folders or files: losing a registry
 * row is a mistake that can be undone, losing a tree is not.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { key } = await params;
    await deleteDrive(key);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
