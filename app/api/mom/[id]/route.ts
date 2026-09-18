import { deleteMinute, getMinute, noteWrite, updateMinute } from "@/lib/minutes";
import { normalise } from "@/lib/mom";
import { ok, fail } from "@/lib/api";
import { readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/** Open a saved minute back into the form. */
export async function GET(_req: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const found = await getMinute(id);
    if (!found) return missing();
    return ok(found);
  } catch (err) {
    return fail(err);
  }
}

/** Overwrite one. */
export async function PUT(req: Request, { params }: { params: Params }) {
  try {
    noteWrite(req);
    const { id } = await params;
    const body = await readJson<unknown>(req);
    const saved = await updateMinute(id, normalise(body));
    if (!saved) return missing();
    return ok(saved);
  } catch (err) {
    return fail(err);
  }
}

/** Delete one. */
export async function DELETE(req: Request, { params }: { params: Params }) {
  try {
    noteWrite(req);
    const { id } = await params;
    if (!(await deleteMinute(id))) return missing();
    return ok({ deleted: true });
  } catch (err) {
    return fail(err);
  }
}

/**
 * The same answer for a minute that never existed and one somebody else has
 * since deleted — which, on an open route, is a thing that can happen while
 * the form is still open on it.
 */
function missing() {
  const err = new Error("That minute is no longer saved.");
  (err as Error & { status?: number }).status = 404;
  return fail(err);
}
