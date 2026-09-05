/**
 * Answering one access request.
 *
 * Marking a request rather than deleting it is the default on purpose: the
 * admin panel shows what has already been dealt with, and a request that was
 * approved is the only record of why someone has a passcode. Deleting stays
 * available for the ones that were never a request at all.
 */

import { deleteRequest, setRequestStatus } from "@/lib/drives";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type RequestStatus = "new" | "approved" | "dismissed";

function isStatus(value: unknown): value is RequestStatus {
  return value === "new" || value === "approved" || value === "dismissed";
}

/** Move a request between waiting, approved and dismissed. Admin only. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;

    const { status } = await readJson<{ status?: unknown }>(req);
    if (!isStatus(status)) badRequest('status must be "new", "approved" or "dismissed".');

    await setRequestStatus(id, status);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

/** Remove a request for good. Admin only. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;
    await deleteRequest(id);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
