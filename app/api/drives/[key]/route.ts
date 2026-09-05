/**
 * Editing and removing one drive, addressed by the key it will carry forever.
 *
 * The key is in the path rather than the body because it is the one field a
 * drive cannot change — every folder and file row already stores it — so it
 * reads as the address of the thing rather than as another editable field.
 *
 * The passcode follows a three-way convention the admin panel depends on: a
 * field left out leaves the passcode as it was, null clears it, and a string
 * sets it. Without that, a panel that sends the whole form on every save would
 * wipe the passcode of any drive whose form did not repeat it.
 */

import { deleteDrive, updateDrive } from "@/lib/drives";
import { hashPasscode, requireAdmin } from "@/lib/auth";
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

  return out;
}

/** Change any subset of a drive's fields. Admin only. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { key } = await params;

    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      badRequest("Expected a JSON object.");
    }

    // undefined leaves the passcode alone; null and the empty string both mean
    // "there is no passcode now", since a form that has been emptied is asking
    // for exactly that.
    let hash: string | null | undefined;
    if (body.passcode !== undefined) {
      hash =
        body.passcode === null || body.passcode === ""
          ? null
          : await hashPasscode(asText(body.passcode, "passcode"));
    }
    // `key` is the address, not a field — a body that repeats it is ignored
    // rather than obeyed, since renaming it would orphan every row.
    const drive = await updateDrive(key, driveFieldsFrom(body), hash);
    return ok({ drive });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Remove a drive from the registry. Admin only, and refused by lib/drives.ts
 * while the drive still holds folders or files — losing a registry row is a
 * mistake that can be undone, losing a tree is not.
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
