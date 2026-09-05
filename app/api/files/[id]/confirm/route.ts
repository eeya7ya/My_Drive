import { confirmFile, driveOfFile } from "@/lib/store";
import { getDrive } from "@/lib/drives";
import { requireDriveAccess } from "@/lib/auth";
import { ok, fail, readJson, badRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mark a reserved revision uploaded so it becomes the drive's current copy.
 *
 * Open to the same callers as the reserve route: gating this one alone would
 * let a visitor start an upload that could never complete, leaving orphaned
 * bytes in R2 and an unconfirmed row in D1. Which means the same access check
 * as well — the reserve route decides who may add to a private drive, and this
 * one must not become the back door that finishes what it refused.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;

    const owner = await driveOfFile(id);
    const brand = owner ? await getDrive(owner) : null;
    if (!brand) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    await requireDriveAccess(brand);

    const { versionId } = await readJson<{ versionId?: string }>(req);
    if (typeof versionId !== "string" || !versionId) {
      badRequest("versionId is required");
    }

    await confirmFile(id, versionId);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
