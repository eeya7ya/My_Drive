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
 *   - the drive's own USERS may change the drive itself — what it is called,
 *     where it answers, whether its folders are numbered. That is the drive
 *     they run.
 *   - the ADMIN may set the drive's password — which is what gives the drive
 *     to somebody — and change whether the dashboard lists it, where it sits
 *     in the order, and how much it may store.
 *
 * The two lists are below, so there is one answer to "whose field is that?",
 * and a body that reaches for the other level's fields is refused by name
 * rather than quietly ignored: a panel that sent a field it was not allowed to
 * send should hear about it, not watch the save succeed and the value stay as
 * it was.
 *
 * The password is the admin's and not the drive's own, deliberately: it is how
 * somebody is let into the drive in the first place, so whoever is already
 * inside must not be able to quietly change the lock behind them.
 */

import { deleteDrive, getDrive, updateDrive } from "@/lib/drives";
import { hashPasscode, requireAdmin, requireDriveUser } from "@/lib/auth";
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
  if (body.listed !== undefined) out.listed = asFlag(body.listed, "listed");
  if (body.position !== undefined) {
    if (typeof body.position !== "number" || !Number.isFinite(body.position)) {
      badRequest("position must be a number.");
    }
    out.position = body.position;
  }
  return out;
}

/**
 * Which fields belong to which level, in one place, so adding a field means
 * choosing a side for it here rather than in three handlers.
 *
 * The drive's users get the drive itself — what it is called, where it
 * answers, how it looks, and the passcode a visitor is given to look at it.
 * The admin gets the two things that are about the drive's place among the
 * others rather than about the drive: its password, whether the dashboard
 * lists it and in what order, and — via `quotaBytes` — how much it may store.
 */
const USER_FIELDS = [
  "name",
  "tagline",
  "title",
  "shortName",
  "description",
  "slug",
  "numbered",
  "poweredBy",
] as const;

const ADMIN_FIELDS = ["listed", "position", "quotaBytes", "password"] as const;

/** Refuse a body that reaches past the caller's level, naming what it reached for. */
function assertFieldsAllowed(
  body: Record<string, unknown>,
  allowed: readonly string[],
  level: "user" | "admin"
): void {
  const forbidden: string[] = [...ADMIN_FIELDS, ...USER_FIELDS].filter(
    (field) => body[field] !== undefined && !allowed.includes(field)
  );
  if (!forbidden.length) return;

  badRequest(
    level === "user"
      ? `${forbidden.join(", ")} ${forbidden.length === 1 ? "is" : "are"} the admin's to set — the dashboard listing and the drive's storage limit are theirs.`
      : `${forbidden.join(", ")} ${forbidden.length === 1 ? "belongs" : "belong"} to the drive's own users, and ${forbidden.length === 1 ? "is" : "are"} changed from inside the drive.`
  );
}

/**
 * Change any subset of a drive's fields — the subset this caller's level owns.
 *
 * Which set the body touches decides which question is asked, so the admin
 * sets a quota without signing in to the drive, and the drive's own user
 * renames it without being an admin. Neither check is satisfied by the other
 * role's session. Sending both sets in one request is a 400: they are two
 * different people's decisions, and merging them would mean whichever check
 * ran first silently granted the other.
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

    let passcodeHash: string | undefined;
    const wantsAdminField = ADMIN_FIELDS.some((field) => body[field] !== undefined);

    if (wantsAdminField) {
      await requireAdmin();
      assertFieldsAllowed(body, ADMIN_FIELDS, "admin");

      // Setting this signs out everybody currently in the drive, because their
      // session was signed against the hash it replaces. That is the point of
      // changing a password.
      if (body.password !== undefined) {
        const password = asText(body.password, "password").trim();
        if (!password) badRequest("A password cannot be blank.");
        passcodeHash = await hashPasscode(password);
      }
    } else {
      // Not satisfied by the admin session. Renaming a drive is its users'
      // business, the same as adding a folder is, and an admin who genuinely
      // has to do it makes themselves a user of that drive — which is visible
      // in the panel rather than silent.
      await requireDriveUser(brand);
      assertFieldsAllowed(body, USER_FIELDS, "user");
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
    const drive = await updateDrive(key, driveFieldsFrom(body), passcodeHash);
    return ok({ drive });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Remove a drive from the registry. Admin only — which drives exist is the
 * level above the drives, and a user deleting their own drive out from under
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
