import { getTree, getUsage } from "@/lib/store";
import { isAdmin, requireDriveAccess } from "@/lib/auth";
import { isD1Configured } from "@/lib/d1";
import { parseDriveKey } from "@/lib/drives";
import { ok, fail } from "@/lib/api";
import { DrivePayload } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * One drive in one call: its tree, root files, usage, and the viewer's role.
 * `?drive=` names the drive; an unknown key is a 400, never the wrong tree.
 *
 * This is the call the drive page makes for its contents, so it is also where
 * a private drive is kept private — without the check here the tree was
 * readable by anyone who knew the key, whatever the page in front of it did.
 */
export async function GET(req: Request) {
  try {
    const brand = await parseDriveKey(new URL(req.url).searchParams.get("drive"));
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

    // Below the fallback rather than above it: the branch above describes an
    // empty drive, so there is nothing there worth refusing, and a
    // half-configured deploy should still render for everyone.
    await requireDriveAccess(brand);

    const [{ tree, rootFiles, filesError }, usage] = await Promise.all([
      getTree(brand.key),
      getUsage(brand.key),
    ]);

    const payload: DrivePayload = {
      tree,
      rootFiles,
      usedBytes: usage.usedBytes,
      quotaBytes: usage.quotaBytes,
      isAdmin: admin,
    };

    // A missing table or column means the database predates a migration.
    // Say so in words the operator can act on — the raw SQLite error reads
    // like the data is gone, when only the query failed.
    if (filesError) {
      const needsDrives = /no such column.*drive/i.test(filesError);
      const needsMigration = /no such table|no such column/i.test(filesError);
      return ok({
        ...payload,
        notice: needsDrives
          ? "Files could not be read: this database has no drive column yet. Run migrations/003_drives.console.sql in the D1 console. No data has been lost."
          : needsMigration
            ? "Folders are shown, but files could not be read: this database has not been migrated yet. Run migrations/001_file_versions.console.sql in the D1 console. No data has been lost."
            : `Files could not be read: ${filesError}`,
      });
    }

    return ok(payload);
  } catch (err) {
    return fail(err);
  }
}
