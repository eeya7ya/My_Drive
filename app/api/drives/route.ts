/**
 * The drive registry as the two front doors need it: the dashboard reading the
 * list, and the admin panel adding to it.
 *
 * The read is public because the dashboard is the first page a visitor lands
 * on and has to render before anyone has signed in. What a visitor sees is
 * narrowed rather than gated — only the listed drives, and each entry carries
 * `unlocked` instead of anything at all about the passcode, so the client can
 * tell "open this" from "ask for the passcode" without ever holding the secret
 * that settles the question.
 */

import { createDrive, listDrives, listedDrives } from "@/lib/drives";
import { canOpenDrive, hashPasscode, isAdmin, requireAdmin } from "@/lib/auth";
import { ok, fail, readJson, badRequest } from "@/lib/api";
import type { DriveInput } from "@/lib/drives";
import type { DriveCard } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Every drive for an admin; only the listed ones for everybody else. */
export async function GET() {
  try {
    const admin = await isAdmin();
    const visible = admin ? await listDrives() : await listedDrives();

    // `unlocked` is asked of the access rules rather than inferred from the
    // Brand, so a card on the dashboard and the drive page behind it can never
    // disagree about whether it opens.
    const drives: DriveCard[] = await Promise.all(
      visible.map(async (brand) => ({ ...brand, unlocked: await canOpenDrive(brand) }))
    );

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

/**
 * Add a drive. Admin only, and one of the two places a plaintext passcode is
 * accepted — it is hashed here and neither stored nor echoed back, so the
 * Brand that comes out says only whether a passcode exists.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();

    const body = await readJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      badRequest("Expected a JSON object.");
    }

    // An absent or empty passcode is no passcode at all; createDrive refuses
    // the combination of that and a private drive.
    const passcode = body.passcode;
    const hash =
      passcode === undefined || passcode === null || passcode === ""
        ? null
        : await hashPasscode(asText(passcode, "passcode"));

    const drive = await createDrive(driveFieldsFrom(body), hash);
    return ok({ drive });
  } catch (err) {
    return fail(err);
  }
}
