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

    const [{ tree, rootFiles, filesError }, usage] = await Promise.all([
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

    // A missing file_versions table means the database predates the revisions
    // migration. Say so in words the operator can act on — the raw SQLite
    // error reads like the data is gone, when only the query failed.
    if (filesError) {
      const needsMigration = /no such table|no such column/i.test(filesError);
      return ok({
        ...payload,
        notice: needsMigration
          ? "Folders are shown, but files could not be read: this database has not been migrated yet. Run migrations/001_file_versions.console.sql in the D1 console. No data has been lost."
          : `Files could not be read: ${filesError}`,
      });
    }

    return ok(payload);
  } catch (err) {
    return fail(err);
  }
}
