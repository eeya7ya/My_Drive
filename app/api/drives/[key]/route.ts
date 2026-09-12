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
 *   - the drive's USER — anyone who can open it, which for a private drive
 *     means they hold the passcode the admin gave them — may change the drive
 *     itself: what it is called, where it answers, whether its folders are
 *     numbered. That is the drive they run.
 *   - the ADMIN may change who is in the drive (its visibility and its
 *     passcode — the membership), whether the dashboard lists it, where it
 *     sits in the order, who it is recorded as being for, and — via
 *     `quotaBytes` — how much it may store.
 *
 * The lists live in lib/drives.ts (USER_FIELDS / ADMIN_FIELDS) so there is one
 * answer to "whose field is that?", and a body that reaches for the other
 * level's fields is refused by name rather than quietly ignored: a panel that
 * sent a field it was not allowed to send should hear about it, not watch the
 * save succeed and the value stay as it was.
 *
 * The passcode follows the three-way convention the admin panel depends on: a
 * field left out leaves it as it was, null clears it, and a string sets it.
 * Without that, a form that sends everything on every save would wipe the
 * passcode of any drive whose form did not repeat it.
 */

import {
  ADMIN_FIELDS,
  USER_FIELDS,
  deleteDrive,
  getDrive,
  updateDrive,
} from "@/lib/drives";
import { hashPasscode, isAdmin, isDriveUser, requireAdmin } from "@/lib/auth";
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

/** Refuse a body that reaches past the caller's level, naming what it reached for. */
function assertFieldsAllowed(
  body: Record<string, unknown>,
  allowed: readonly string[],
  level: "user" | "admin"
): void {
  const forbidden: string[] = [...ADMIN_FIELDS, ...USER_FIELDS].filter(
    (field) => body[field] !== undefined && !allowed.includes(field)
  );
  if (body.passcode !== undefined && !allowed.includes("passcode")) forbidden.push("passcode");
  if (body.quotaBytes !== undefined && !allowed.includes("quotaBytes")) {
    forbidden.push("quotaBytes");
  }
  if (!forbidden.length) return;

  badRequest(
    level === "user"
      ? `${forbidden.join(", ")} ${forbidden.length === 1 ? "is" : "are"} the admin's to set — ${forbidden.length === 1 ? "it decides" : "they decide"} who may enter this drive and how much it may hold.`
      : `${forbidden.join(", ")} ${forbidden.length === 1 ? "belongs" : "belong"} to whoever runs this drive, and ${forbidden.length === 1 ? "is" : "are"} changed from inside it.`
  );
}

/**
 * Change any subset of a drive's fields — the subset this caller's level owns.
 *
 * The drive's user is asked about first, and an admin who can open the drive
 * is one of them, so an admin editing an open drive's name is not told their
 * own drive's name is somebody else's to set. What the admin cannot do in the
 * same breath is change the membership: that is checked against the admin
 * session below, and the two field sets do not overlap.
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

    // Which set is being written decides which question is asked, so an admin
    // can set a drive's passcode without first entering the drive, and a
    // drive's user can rename it without being an admin.
    const wantsAdminField =
      body.passcode !== undefined ||
      body.quotaBytes !== undefined ||
      ADMIN_FIELDS.some((field) => body[field] !== undefined);

    if (wantsAdminField) {
      await requireAdmin();
      assertFieldsAllowed(body, [...ADMIN_FIELDS, "passcode", "quotaBytes"], "admin");
    } else {
      const [user, admin] = await Promise.all([isDriveUser(brand), isAdmin()]);
      if (!user && !admin) {
        const err = new Error(
          `${brand.name} is private. Enter its passcode to open it and change it.`
        );
        (err as Error & { status?: number }).status = 403;
        throw err;
      }
      assertFieldsAllowed(body, USER_FIELDS, "user");
    }

    // undefined leaves the passcode alone; null and the empty string both mean
    // "there is no passcode now", since a form that has been emptied is asking
    // for exactly that. Setting it retires every pass already issued to the
    // drive, which is how the admin takes somebody out of one.
    let hash: string | null | undefined;
    if (body.passcode !== undefined) {
      hash =
        body.passcode === null || body.passcode === ""
          ? null
          : await hashPasscode(asText(body.passcode, "passcode"));
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
    const drive = await updateDrive(key, driveFieldsFrom(body), hash);
    return ok({ drive });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Remove a drive from the registry. Admin only — which drives exist is the
 * level above the drives, and a drive's user deleting it out from under the
 * dashboard is not part of running one. Refused by lib/drives.ts while the
 * drive still holds folders or files: losing a registry row is a mistake that
 * can be undone, losing a tree is not.
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
