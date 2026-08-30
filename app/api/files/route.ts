import { reserveFile, getUsage } from "@/lib/store";
import { presignUpload } from "@/lib/r2";
import { ok, fail, readJson, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB — R2's single-PUT ceiling.

/**
 * Reserve a revision and hand back a presigned PUT.
 * The browser uploads straight to R2, then calls the confirm route.
 * Re-uploading an existing name in the same folder creates revision N+1.
 *
 * Deliberately NOT admin-gated: anyone who can see the drive can add to it.
 * Creating, renaming and deleting stay with the admin, so a visitor can only
 * ever add — never remove or restructure. The quota is enforced here because
 * it is now the only bound on what an anonymous upload can consume.
 */
export async function POST(req: Request) {
  try {
    const { folderId, name, size, contentType } = await readJson<{
      folderId?: string | null;
      name?: string;
      size?: number;
      contentType?: string;
    }>(req);

    if (typeof name !== "string" || !name.trim()) badRequest("name is required");
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
      badRequest("size must be a non-negative number");
    }
    if (size > MAX_BYTES) {
      badRequest("File is larger than the 5 GB single-upload limit");
    }
    if (folderId !== null && folderId !== undefined && typeof folderId !== "string") {
      badRequest("folderId must be a folder id or null");
    }

    const { usedBytes, quotaBytes } = await getUsage();
    if (usedBytes + size > quotaBytes) {
      badRequest(
        "The drive is full — this upload would exceed its storage quota."
      );
    }

    const type = contentType || "application/octet-stream";
    const { fileId, versionId, version, r2Key } = await reserveFile(
      folderId ?? null,
      name,
      size,
      type
    );
    const uploadUrl = await presignUpload(r2Key, type);

    return ok({ fileId, versionId, version, uploadUrl });
  } catch (err) {
    return fail(err);
  }
}
