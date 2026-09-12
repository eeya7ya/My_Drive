/**
 * The drive registry as the two front doors need it: the dashboard reading the
 * list, and the admin panel adding to it.
 *
 * The read is public because the dashboard is the first page a visitor lands
 * on and has to render before anyone has signed in. What a visitor sees is
 * narrowed rather than gated — only the listed drives, and only their public
 * identity. Every card leads to that drive's sign-in, so there is nothing here
 * that needs to know anybody's password.
 */

import { createDrive, listDrives, listedDrives } from "@/lib/drives";
import { isAdmin, requireAdmin } from "@/lib/auth";
import { setQuota } from "@/lib/store";
import { ok, fail, readJson, badRequest } from "@/lib/api";
import type { DriveInput } from "@/lib/drives";
import type { DriveCard } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Every drive for an admin; only the listed ones for everybody else. */
export async function GET() {
  try {
    const admin = await isAdmin();
    const visible = admin ? await listDrives() : await listedDrives();

    // Every drive is behind a password, so the dashboard does not ask whether
    // this visitor is through one: it shows the drives and each card leads to
    // its sign-in. Saying which drives somebody is already signed in to would
    // also tell an onlooker at the same screen more than the page needs to.
    const drives: DriveCard[] = visible.map((brand) => ({ ...brand }));

    return ok({ drives, isAdmin: admin });
  } catch (err) {
    return fail(err);
  }
}

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
 * rather than a strange row. The picker is repeated in the per-drive route
 * because a route file may export only its handlers, and a shared module for
 * twenty lines would read worse than the copy.
 */
function driveFieldsFrom(body: Record<string, unknown>): DriveInput {
  const out: DriveInput = {};

  if (body.key !== undefined) out.key = asText(body.key, "key");
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
 * Add a drive. Admin only, because which drives exist is the level above the
 * drives.
 *
 * A drive arrives with nobody running it; the admin then creates a user
 * against it (POST /api/users) and hands that person their password. Until
 * they do, nobody can add a folder to it, which is honest — the drive exists
 * and has not been given to anyone.
 *
 * A new drive is closed until somebody can sign in to it, which is the honest
 * state for a drive that has not been given to anyone yet.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();

    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      badRequest("Expected a JSON object.");
    }

    // No passcode: a drive is opened by its users' passwords, and those are
    // created against it afterwards with POST /api/users.
    const drive = await createDrive(driveFieldsFrom(body), null);

    // The quota is a settings row rather than a drives column, so it is written
    // after the drive exists. Left out, the drive takes the default the
    // storage counter falls back to.
    if (body.quotaBytes !== undefined) {
      if (typeof body.quotaBytes !== "number" || !Number.isFinite(body.quotaBytes)) {
        badRequest("quotaBytes must be a number of bytes.");
      }
      await setQuota(drive.key, body.quotaBytes);
    }

    return ok({ drive });
  } catch (err) {
    return fail(err);
  }
}
