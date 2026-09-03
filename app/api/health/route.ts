import { requireAdmin } from "@/lib/auth";
import { d1Query } from "@/lib/d1";
import { probeBucket } from "@/lib/r2";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Diagnostics for a deployment that is configured but not working.
 *
 * Reports whether each setting is PRESENT — never its value — and then
 * actually exercises D1 and R2, because "the variable is set" and "the
 * credential works" are different claims and only the second one matters.
 *
 * Admin-gated: the schema shape and bucket name are not secrets, but they are
 * nobody else's business either.
 */

function present(name: string): boolean {
  return Boolean(process.env[name]);
}

export async function GET() {
  try {
    await requireAdmin();

    const config = {
      CLOUDFLARE_ACCOUNT_ID: present("CLOUDFLARE_ACCOUNT_ID"),
      CLOUDFLARE_API_TOKEN: present("CLOUDFLARE_API_TOKEN"),
      CLOUDFLARE_D1_DATABASE_ID: present("CLOUDFLARE_D1_DATABASE_ID"),
      R2_ACCESS_KEY_ID: present("R2_ACCESS_KEY_ID"),
      R2_SECRET_ACCESS_KEY: present("R2_SECRET_ACCESS_KEY"),
      R2_BUCKET_NAME: present("R2_BUCKET_NAME"),
      ADMIN_PASSWORD: present("ADMIN_PASSWORD"),
      SESSION_SECRET: present("SESSION_SECRET"),
    };
    const missing = Object.entries(config)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    // D1: can we query, and does the schema match what the code expects?
    let d1: Record<string, unknown> = { ok: false };
    try {
      const tables = await d1Query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      const names = tables.map((t) => t.name);
      const cols = await d1Query<{ name: string }>("PRAGMA table_info(files)");
      const fileCols = cols.map((c) => c.name);

      // The exact shape that decides whether an upload can be recorded.
      const legacy = ["r2_key", "size_bytes", "content_type", "uploaded"].filter(
        (c) => fileCols.includes(c)
      );
      d1 = {
        ok: true,
        tables: names,
        filesColumns: fileCols,
        hasFileVersions: names.includes("file_versions"),
        legacyColumnsStillPresent: legacy,
        hasDriveColumn: fileCols.includes("drive"),
        migrationsNeeded: [
          !names.includes("file_versions") ? "001_file_versions" : null,
          legacy.length ? "002_drop_legacy_file_columns" : null,
          !fileCols.includes("drive") ? "003_drives" : null,
        ].filter(Boolean),
      };
    } catch (e) {
      d1 = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // R2: do these credentials actually open this bucket?
    let r2: Record<string, unknown> = { ok: false };
    try {
      const probe = await probeBucket();
      r2 = { ok: true, bucket: probe.bucket, objectsSeen: probe.count };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r2 = {
        ok: false,
        error: msg,
        // The S3 API's failures are terse; name the usual cause.
        likelyCause: /NoSuchBucket/i.test(msg)
          ? "R2_BUCKET_NAME does not match a bucket in this account"
          : /SignatureDoesNotMatch|InvalidAccessKeyId|Unauthorized|403/i.test(msg)
            ? "R2 access key or secret is wrong, or the token lacks Object Read & Write"
            : /not configured/i.test(msg)
              ? "An R2 environment variable is missing — see config above"
              : "Unrecognised R2 error; the message above is verbatim",
      };
    }

    const uploadsShouldWork =
      d1 &&
      (d1 as { ok?: boolean }).ok === true &&
      ((d1 as { migrationsNeeded?: string[] }).migrationsNeeded?.length ?? 0) === 0 &&
      (r2 as { ok?: boolean }).ok === true;

    return ok({
      uploadsShouldWork,
      missingConfig: missing,
      d1,
      r2,
    });
  } catch (err) {
    return fail(err);
  }
}
