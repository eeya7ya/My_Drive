/**
 * Cloudflare R2 via its S3-compatible API.
 *
 * Uploads are presigned and go browser → R2 directly, never through Vercel.
 * That is deliberate: a Vercel serverless function caps request bodies at
 * about 4.5 MB, so routing file bytes through the app would break on anything
 * larger. The app only ever hands out a signed URL and records metadata.
 */

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let cached: S3Client | null = null;

function client(): S3Client {
  if (cached) return cached;

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 is not configured. Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY."
    );
  }

  cached = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cached;
}

function bucket(): string {
  const name = process.env.R2_BUCKET_NAME;
  if (!name) throw new Error("R2 is not configured. Set R2_BUCKET_NAME.");
  return name;
}

/** Signed PUT the browser uploads to directly. */
export async function presignUpload(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn }
  );
}

/** Signed GET for download. `filename` drives the Content-Disposition. */
export async function presignDownload(
  key: string,
  filename: string,
  expiresIn = 300
): Promise<string> {
  // Quotes and backslashes would break out of the header's quoted-string.
  const safe = filename.replace(/["\\]/g, "_");
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
    }),
    { expiresIn }
  );
}

/**
 * Signed GET served inline rather than as an attachment, so a browser renders
 * the file instead of saving it. The content type is asserted here because R2
 * returns whatever was set at upload, and an empty or wrong one sends a PDF to
 * the download bar instead of the viewer.
 */
export async function presignInline(
  key: string,
  filename: string,
  contentType: string,
  expiresIn = 900
): Promise<string> {
  const safe = filename.replace(/["\\]/g, "_");
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentType: contentType || "application/octet-stream",
      ResponseContentDisposition: `inline; filename="${safe}"`,
    }),
    { expiresIn }
  );
}

/** Read an object server-side, for the same-origin preview proxy. */
export async function getObjectStream(key: string) {
  return client().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key })
  );
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key })
  );
}

/** Bulk delete, chunked to S3's 1000-key limit per request. */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (!keys.length) return;

  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await client().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      })
    );
  }
}

/**
 * Prove the configured credentials can actually open the configured bucket.
 * ListObjectsV2 with MaxKeys=1 is the cheapest call that fails distinctly for
 * a wrong bucket name versus a bad key.
 */
export async function probeBucket(): Promise<{ bucket: string; count: number }> {
  const name = bucket();
  const out = await client().send(
    new ListObjectsV2Command({ Bucket: name, MaxKeys: 1 })
  );
  return { bucket: name, count: out.KeyCount ?? 0 };
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
  );
}
