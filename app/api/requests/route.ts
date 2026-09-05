/**
 * Access requests: the one thing on this site a stranger may write.
 *
 * That makes it the surface worth being careful about. The body is measured
 * and refused before it is parsed, the fields lib/drives.ts does not know
 * about are dropped, and the reply is the same short acknowledgement whatever
 * happened underneath — including when the drive someone named does not
 * exist, since a form that answered differently for a real key would be a way
 * to discover the drives the dashboard deliberately does not list.
 *
 * Requests are rows rather than mail, so the admin panel is the single place
 * they are read and answered.
 */

import { createRequest, getDrive, listRequests } from "@/lib/drives";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Generous next to a name, an email and a note, and far below anything worth
 * buffering. lib/drives.ts trims each field to its own limit; this is only the
 * bound on what the server agrees to hold in memory first.
 */
const MAX_BODY_BYTES = 8 * 1024;

function tooLarge(): never {
  const err = new Error("That message is longer than this form accepts.");
  (err as Error & { status?: number }).status = 413;
  throw err;
}

/** Read a JSON object, refusing an oversized body before parsing costs anything. */
async function readSmallJson(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) tooLarge();

  // A chunked request declares no length, so the text is measured as well —
  // in characters rather than bytes, which is close enough for a cap whose
  // only job is to stop a body that was never a form submission.
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) tooLarge();

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    badRequest("Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    badRequest("Expected a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/** Everything anyone has asked for, newest first. Admin only. */
export async function GET() {
  try {
    await requireAdmin();
    return ok({ requests: await listRequests() });
  } catch (err) {
    return fail(err);
  }
}

/** Raise a request from the dashboard. Public and unauthenticated by design. */
export async function POST(req: Request) {
  try {
    const body = await readSmallJson(req);

    // A key that names nothing is recorded as no drive rather than refused, so
    // the answer a stranger gets never depends on which drives exist. The
    // request still reaches the admin, who can see from the note what it was
    // meant to be about.
    let driveKey: string | null = null;
    if (typeof body.driveKey === "string" && body.driveKey) {
      driveKey = (await getDrive(body.driveKey))?.key ?? null;
    }

    await createRequest({
      driveKey,
      name: typeof body.name === "string" ? body.name : "",
      email: typeof body.email === "string" ? body.email : "",
      note: typeof body.note === "string" ? body.note : "",
    });

    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
