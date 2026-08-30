import { getTree, getUsage } from "@/lib/store";
import { isAdmin } from "@/lib/auth";
import { isD1Configured } from "@/lib/d1";
import { ok, fail } from "@/lib/api";
import { DrivePayload } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The whole drive in one call: tree, root files, usage, and viewer role. */
export async function GET() {
  try {
    const admin = await isAdmin();

    // Before Cloudflare credentials are set the app should still render the
    // design rather than an error page.
    if (!isD1Configured()) {
      const payload: DrivePayload = {
        tree: [],
        rootFiles: [],
        usedBytes: 0,
        quotaBytes: 214748364800,
        isAdmin: admin,
      };
      return ok({ ...payload, unconfigured: true });
    }

    const [{ tree, rootFiles }, usage] = await Promise.all([
      getTree(),
      getUsage(),
    ]);

    const payload: DrivePayload = {
      tree,
      rootFiles,
      usedBytes: usage.usedBytes,
      quotaBytes: usage.quotaBytes,
      isAdmin: admin,
    };
    return ok(payload);
  } catch (err) {
    return fail(err);
  }
}
