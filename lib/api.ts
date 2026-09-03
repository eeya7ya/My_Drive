/** Shared helpers for the route handlers. */

import { NextResponse } from "next/server";
import { requireDriveAccess } from "./auth";
import { fileDrive } from "./store";

export function ok<T>(data: T) {
  return NextResponse.json(data);
}

/**
 * Turn a thrown error into a JSON response. Configuration problems surface
 * their message so the operator can fix the deployment; everything else is
 * reported without leaking internals.
 */
export function fail(err: unknown, fallbackStatus = 500) {
  const status =
    (err as { status?: number } | null)?.status ?? fallbackStatus;
  const message =
    err instanceof Error ? err.message : "Unexpected server error";

  if (status >= 500) console.error("[drive]", err);

  return NextResponse.json({ error: message }, { status });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    const err = new Error("Request body must be valid JSON");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
}

/**
 * Refuse a file request unless its drive is open to the caller. A file id
 * alone must never be enough to fetch bytes out of a private drive.
 */
export async function requireFileAccess(fileId: string): Promise<void> {
  const drive = await fileDrive(fileId);
  if (drive === null) {
    const err = new Error("File not found");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  await requireDriveAccess(drive);
}

export function badRequest(message: string): never {
  const err = new Error(message);
  (err as Error & { status?: number }).status = 400;
  throw err;
}
