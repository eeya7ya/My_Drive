import { createMinute, listMinutes, noteWrite } from "@/lib/minutes";
import { normalise } from "@/lib/mom";
import { ok, fail, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The saved minutes: the list, and saving a new one.
 *
 * No access check, by the owner's decision: /MOM is an open route and so is
 * its table. That means anyone who reaches this address can list every saved
 * minute and add another, so what stands in for a gate is in lib/minutes.ts —
 * a per-caller write throttle and a ceiling on how many minutes may exist —
 * and in lib/mom.ts, which cuts every field of an incoming save to a length a
 * minute plausibly needs before it can reach a row.
 */
export async function GET() {
  try {
    return ok(await listMinutes());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    noteWrite(req);
    // Nothing is trusted from the body: normalise returns a document whatever
    // it is handed, so a save cannot store a shape the sheet cannot render.
    const body = await readJson<unknown>(req);
    return ok(await createMinute(normalise(body)));
  } catch (err) {
    return fail(err);
  }
}
