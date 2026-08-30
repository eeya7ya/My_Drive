/**
 * Folder/file persistence. Metadata in D1, bytes in R2.
 *
 * D1 bills on rows read, so the read path is deliberately flat:
 *   - getTree()  — two queries, one row per folder and one per file. No
 *                  aggregates, no correlated subqueries, no scan of
 *                  file_versions (the table that grows with every revision).
 *   - getUsage() — one row. The storage total is a counter maintained on
 *                  write, not a SUM over every revision ever uploaded.
 * A file's revision history is read only when someone opens it, and then only
 * that file's rows via the (file_id, version) index.
 *
 * Sorting and date filtering are NOT here on purpose: the whole drive already
 * ships in one payload, so the client does both for free rather than paying
 * D1 for another read per sort change.
 */

import { d1Query, d1Execute } from "./d1";
import {
  DriveFile,
  DriveFileVersion,
  FileRow,
  FileVersionRow,
  FolderRow,
  TreeNode,
  formatDate,
  formatDateTime,
  humanSize,
} from "./types";

const DEFAULT_QUOTA = 214748364800; // 200 GB — matches the design's sidebar.

function newId(): string {
  return crypto.randomUUID();
}

/** The current-revision view of a file, as one flat row from the join. */
interface FileWithVersion {
  id: string;
  folder_id: string | null;
  name: string;
  ext: string;
  version_count: number;
  created_at: number;
  modified_at: number;
  version: number;
  size_bytes: number;
  uploaded_at: number | null;
}

function toDriveFile(r: FileWithVersion): DriveFile {
  const uploadedMs = r.uploaded_at ?? r.modified_at;
  return {
    id: r.id,
    name: r.name,
    ext: r.ext,
    size: humanSize(r.size_bytes),
    sizeBytes: r.size_bytes,
    modified: formatDate(uploadedMs),
    version: r.version,
    versionCount: r.version_count,
    uploadedAt: formatDateTime(uploadedMs),
    uploadedAtMs: uploadedMs,
  };
}

/**
 * Read the whole drive in two queries and assemble the nested tree in memory.
 * Folder counts here are small (a study drive, not a filesystem), so this is
 * far cheaper than a round trip per level over D1's HTTP API.
 */
export async function getTree(): Promise<{
  tree: TreeNode[];
  rootFiles: DriveFile[];
  filesError: string | null;
}> {
  // The two reads are deliberately independent. A folder tree is the drive's
  // backbone; if the files query fails — most plausibly because the database
  // has not been migrated yet — showing the folders with a clear warning beats
  // a blank drive that looks like data loss.
  const [folders, fileResult] = await Promise.all([
    d1Query<FolderRow>("SELECT * FROM folders ORDER BY position ASC, name ASC"),
    // Joining on current_version_id reads exactly one version row per file —
    // never the whole history.
    d1Query<FileWithVersion>(
      `SELECT f.id, f.folder_id, f.name, f.ext, f.version_count,
              f.created_at, f.modified_at,
              v.version, v.size_bytes, v.uploaded_at
         FROM files f
         JOIN file_versions v ON v.id = f.current_version_id
        WHERE v.uploaded = 1
        ORDER BY f.name ASC`
    ).then(
      (rows) => ({ rows, error: null as string | null }),
      (e: unknown) => ({
        rows: [] as FileWithVersion[],
        error: e instanceof Error ? e.message : "Could not read files",
      })
    ),
  ]);

  const files = fileResult.rows;
  const filesError = fileResult.error;

  const filesByFolder = new Map<string, DriveFile[]>();
  const rootFiles: DriveFile[] = [];

  for (const f of files) {
    const df = toDriveFile(f);
    if (f.folder_id === null) {
      rootFiles.push(df);
      continue;
    }
    const list = filesByFolder.get(f.folder_id);
    if (list) list.push(df);
    else filesByFolder.set(f.folder_id, [df]);
  }

  const nodes = new Map<string, TreeNode>();
  for (const f of folders) {
    nodes.set(f.id, {
      id: f.id,
      name: f.name,
      code: f.code,
      icon: f.icon,
      modified: formatDate(f.modified_at),
      modifiedMs: f.modified_at,
      children: [],
      files: filesByFolder.get(f.id) ?? [],
    });
  }

  const tree: TreeNode[] = [];
  for (const f of folders) {
    const node = nodes.get(f.id)!;
    if (f.parent_id === null) {
      tree.push(node);
    } else {
      // A parent that vanished mid-read would orphan the row; surface it at
      // root rather than dropping it silently.
      const parent = nodes.get(f.parent_id);
      if (parent) parent.children.push(node);
      else tree.push(node);
    }
  }

  return { tree, rootFiles, filesError };
}

/** Both numbers come from the settings table: two rows, no aggregate. */
export async function getUsage(): Promise<{
  usedBytes: number;
  quotaBytes: number;
}> {
  const rows = await d1Query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key IN ('quota_bytes','used_bytes')"
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const quotaBytes = Number(map.get("quota_bytes") ?? DEFAULT_QUOTA);
  return {
    usedBytes: Number(map.get("used_bytes") ?? 0),
    quotaBytes: quotaBytes || DEFAULT_QUOTA,
  };
}

/** Move the running storage total. Negative delta for deletions. */
async function bumpUsedBytes(delta: number): Promise<void> {
  const n = Math.trunc(delta);
  if (!n) return;
  // MAX(0, …) keeps a drifted counter from going negative and rendering a
  // nonsense storage bar. The inner CAST … AS INTEGER matters: without it a
  // REAL operand makes the sum REAL and the counter is stored as "4500000.0",
  // which then compounds on every later write.
  await d1Execute(
    `UPDATE settings
        SET value = CAST(CAST(MAX(0, CAST(value AS INTEGER) + ?) AS INTEGER) AS TEXT)
      WHERE key = 'used_bytes'`,
    [n]
  );
}

/** Rebuild both counters from the underlying rows. Admin-triggered only. */
export async function recalcCounters(): Promise<{
  usedBytes: number;
  files: number;
}> {
  await d1Execute(
    `UPDATE settings
        SET value = CAST(CAST((SELECT COALESCE(SUM(size_bytes), 0)
                                 FROM file_versions WHERE uploaded = 1) AS INTEGER) AS TEXT)
      WHERE key = 'used_bytes'`
  );
  await d1Execute(
    `UPDATE files
        SET version_count = (SELECT COUNT(*) FROM file_versions
                              WHERE file_id = files.id AND uploaded = 1)`
  );
  const [usage, count] = await Promise.all([
    getUsage(),
    d1Query<{ c: number }>("SELECT COUNT(*) AS c FROM files"),
  ]);
  return { usedBytes: usage.usedBytes, files: Number(count[0]?.c ?? 0) };
}

/* ── folders ──────────────────────────────────────────────────────────── */

/** Reject a parent id that isn't a real folder, so we never orphan a row. */
async function assertFolderExists(id: string | null): Promise<void> {
  if (id === null) return;
  const rows = await d1Query<{ id: string }>(
    "SELECT id FROM folders WHERE id = ?",
    [id]
  );
  if (!rows.length) throw new Error("Parent folder not found");
}

export async function createFolder(
  parentId: string | null,
  rawName: string
): Promise<FolderRow> {
  await assertFolderExists(parentId);

  const base = rawName.trim() || "New Folder";

  // De-duplicate against siblings the way the design does: "Name", "Name 2"...
  const siblings = await d1Query<{ name: string }>(
    parentId === null
      ? "SELECT name FROM folders WHERE parent_id IS NULL"
      : "SELECT name FROM folders WHERE parent_id = ?",
    parentId === null ? [] : [parentId]
  );
  const taken = new Set(siblings.map((s) => s.name));
  let name = base;
  let n = 2;
  while (taken.has(name)) name = `${base} ${n++}`;

  const countRows = await d1Query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM folders"
  );
  const code = "USR-" + String(Number(countRows[0]?.c ?? 0) + 1).padStart(2, "0");

  const now = Date.now();
  const id = newId();

  await d1Execute(
    `INSERT INTO folders (id, parent_id, name, code, icon, position, created_at, modified_at)
     VALUES (?, ?, ?, ?, 'folder', 0, ?, ?)`,
    [id, parentId, name, code, now, now]
  );

  return {
    id,
    parent_id: parentId,
    name,
    code,
    icon: "folder",
    position: 0,
    created_at: now,
    modified_at: now,
  };
}

export async function renameFolder(id: string, rawName: string): Promise<void> {
  const name = rawName.trim();
  if (!name) throw new Error("Folder name cannot be empty");
  const changed = await d1Execute(
    "UPDATE folders SET name = ?, modified_at = ? WHERE id = ?",
    [name, Date.now(), id]
  );
  if (!changed) throw new Error("Folder not found");
}

/** Every folder id in the subtree rooted at `id`, including `id` itself. */
async function subtreeIds(id: string): Promise<string[]> {
  const rows = await d1Query<{ id: string }>(
    `WITH RECURSIVE sub(id) AS (
       SELECT ?
       UNION ALL
       SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
     )
     SELECT id FROM sub`,
    [id]
  );
  return rows.map((r) => r.id);
}

/**
 * Delete a folder and everything under it. Returns the R2 keys of every
 * revision that went with it so the caller can clear the objects.
 */
export async function deleteFolder(id: string): Promise<string[]> {
  const ids = await subtreeIds(id);
  if (!ids.length) throw new Error("Folder not found");

  const placeholders = ids.map(() => "?").join(",");

  // Every revision of every file in the subtree, with sizes so the storage
  // counter can be corrected in the same pass.
  const versions = await d1Query<{ r2_key: string; size_bytes: number; uploaded: number }>(
    `SELECT v.r2_key, v.size_bytes, v.uploaded
       FROM file_versions v
       JOIN files f ON f.id = v.file_id
      WHERE f.folder_id IN (${placeholders})`,
    ids
  );

  await d1Execute(
    `DELETE FROM file_versions
      WHERE file_id IN (SELECT id FROM files WHERE folder_id IN (${placeholders}))`,
    ids
  );
  await d1Execute(`DELETE FROM files WHERE folder_id IN (${placeholders})`, ids);
  await d1Execute(`DELETE FROM folders WHERE id IN (${placeholders})`, ids);

  const freed = versions
    .filter((v) => v.uploaded === 1)
    .reduce((sum, v) => sum + v.size_bytes, 0);
  await bumpUsedBytes(-freed);

  return versions.map((v) => v.r2_key);
}

/* ── files and revisions ──────────────────────────────────────────────── */

/**
 * Reserve a revision before the browser uploads to R2.
 *
 * If the folder already holds a file with this name, this becomes its next
 * revision rather than a second file. The row stays `uploaded = 0` — invisible
 * to the drive and uncounted in storage — until the upload is confirmed, so an
 * abandoned upload never appears as a phantom file or a phantom revision.
 */
export async function reserveFile(
  folderId: string | null,
  name: string,
  sizeBytes: number,
  contentType: string
): Promise<{ fileId: string; versionId: string; version: number; r2Key: string }> {
  await assertFolderExists(folderId);

  const clean = name.trim() || "untitled";
  const ext = clean.includes(".")
    ? clean.split(".").pop()!.toLowerCase()
    : "file";
  const now = Date.now();

  const existing = await d1Query<{ id: string }>(
    folderId === null
      ? "SELECT id FROM files WHERE folder_id IS NULL AND name = ?"
      : "SELECT id FROM files WHERE folder_id = ? AND name = ?",
    folderId === null ? [clean] : [folderId, clean]
  );

  let fileId: string;
  let version: number;

  if (existing.length) {
    fileId = existing[0].id;
    // Highest version so far, counting reserved-but-unconfirmed rows so two
    // uploads in flight can't claim the same number.
    const maxRows = await d1Query<{ m: number | null }>(
      "SELECT MAX(version) AS m FROM file_versions WHERE file_id = ?",
      [fileId]
    );
    version = Number(maxRows[0]?.m ?? 0) + 1;
  } else {
    fileId = newId();
    version = 1;
    await d1Execute(
      `INSERT INTO files (id, folder_id, name, ext, current_version_id, version_count, created_at, modified_at)
       VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`,
      [fileId, folderId, clean, ext, now, now]
    );
  }

  const versionId = newId();
  const r2Key = `${folderId ?? "root"}/${fileId}/v${version}/${clean}`;

  await d1Execute(
    `INSERT INTO file_versions (id, file_id, version, size_bytes, content_type, r2_key, uploaded, created_at, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
    [versionId, fileId, version, sizeBytes, contentType, r2Key, now]
  );

  return { fileId, versionId, version, r2Key };
}

/**
 * Mark a reserved revision uploaded and make it the one the drive shows.
 * This is where both counters move.
 */
export async function confirmFile(
  fileId: string,
  versionId: string
): Promise<void> {
  const rows = await d1Query<FileVersionRow>(
    "SELECT * FROM file_versions WHERE id = ? AND file_id = ?",
    [versionId, fileId]
  );
  const v = rows[0];
  if (!v) throw new Error("Revision not found");
  if (v.uploaded === 1) return; // Idempotent: a retried confirm is a no-op.

  const now = Date.now();

  await d1Execute(
    "UPDATE file_versions SET uploaded = 1, uploaded_at = ? WHERE id = ?",
    [now, versionId]
  );
  // ext is set from the name at reserve time and on rename; confirming a
  // revision must not touch it.
  await d1Execute(
    `UPDATE files
        SET current_version_id = ?, version_count = version_count + 1,
            modified_at = ?
      WHERE id = ?`,
    [versionId, now, fileId]
  );
  await bumpUsedBytes(v.size_bytes);
}

function extOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "file";
}

/** One file's history, newest first. Read only when someone opens it. */
export async function listVersions(
  fileId: string
): Promise<DriveFileVersion[]> {
  const [rows, fileRows] = await Promise.all([
    d1Query<FileVersionRow>(
      `SELECT * FROM file_versions
        WHERE file_id = ? AND uploaded = 1
        ORDER BY version DESC`,
      [fileId]
    ),
    d1Query<{ current_version_id: string | null }>(
      "SELECT current_version_id FROM files WHERE id = ?",
      [fileId]
    ),
  ]);

  const currentId = fileRows[0]?.current_version_id ?? null;

  return rows.map((r) => {
    const ms = r.uploaded_at ?? r.created_at;
    return {
      id: r.id,
      version: r.version,
      size: humanSize(r.size_bytes),
      sizeBytes: r.size_bytes,
      uploadedAt: formatDateTime(ms),
      uploadedAtMs: ms,
      isCurrent: r.id === currentId,
    };
  });
}

/** Point a file back at an earlier revision. Moves a pointer; copies nothing. */
export async function restoreVersion(
  fileId: string,
  versionId: string
): Promise<void> {
  const rows = await d1Query<{ id: string }>(
    "SELECT id FROM file_versions WHERE id = ? AND file_id = ? AND uploaded = 1",
    [versionId, fileId]
  );
  if (!rows.length) throw new Error("Revision not found");

  const changed = await d1Execute(
    "UPDATE files SET current_version_id = ?, modified_at = ? WHERE id = ?",
    [versionId, Date.now(), fileId]
  );
  if (!changed) throw new Error("File not found");
}

export async function renameFile(id: string, rawName: string): Promise<void> {
  const name = rawName.trim();
  if (!name) throw new Error("File name cannot be empty");
  const changed = await d1Execute(
    "UPDATE files SET name = ?, ext = ?, modified_at = ? WHERE id = ?",
    [name, extOf(name), Date.now(), id]
  );
  if (!changed) throw new Error("File not found");
}

/** The R2 key for a specific revision, or the current one when unspecified. */
export async function resolveDownload(
  fileId: string,
  versionId?: string | null
): Promise<{
  r2Key: string;
  name: string;
  version: number;
  contentType: string;
  sizeBytes: number;
} | null> {
  const rows = await d1Query<{
    r2_key: string;
    name: string;
    version: number;
    content_type: string;
    size_bytes: number;
  }>(
    versionId
      ? `SELECT v.r2_key, f.name, v.version, v.content_type, v.size_bytes
           FROM file_versions v JOIN files f ON f.id = v.file_id
          WHERE v.id = ? AND v.file_id = ? AND v.uploaded = 1`
      : `SELECT v.r2_key, f.name, v.version, v.content_type, v.size_bytes
           FROM files f JOIN file_versions v ON v.id = f.current_version_id
          WHERE f.id = ? AND v.uploaded = 1`,
    versionId ? [versionId, fileId] : [fileId]
  );
  const r = rows[0];
  return r
    ? {
        r2Key: r.r2_key,
        name: r.name,
        version: r.version,
        contentType: r.content_type,
        sizeBytes: r.size_bytes,
      }
    : null;
}

/** Delete a file and every revision; returns their R2 keys. */
export async function deleteFile(id: string): Promise<string[]> {
  const versions = await d1Query<{ r2_key: string; size_bytes: number; uploaded: number }>(
    "SELECT r2_key, size_bytes, uploaded FROM file_versions WHERE file_id = ?",
    [id]
  );
  if (!versions.length) {
    const exists = await d1Query<{ id: string }>(
      "SELECT id FROM files WHERE id = ?",
      [id]
    );
    if (!exists.length) return [];
  }

  await d1Execute("DELETE FROM file_versions WHERE file_id = ?", [id]);
  await d1Execute("DELETE FROM files WHERE id = ?", [id]);

  const freed = versions
    .filter((v) => v.uploaded === 1)
    .reduce((sum, v) => sum + v.size_bytes, 0);
  await bumpUsedBytes(-freed);

  return versions.map((v) => v.r2_key);
}

/**
 * Delete one older revision. Refuses the current one — that is what deleting
 * the file is for, and silently dropping it would leave the drive pointing at
 * nothing.
 */
export async function deleteVersion(
  fileId: string,
  versionId: string
): Promise<string | null> {
  const rows = await d1Query<{
    r2_key: string;
    size_bytes: number;
    uploaded: number;
    current_version_id: string | null;
  }>(
    `SELECT v.r2_key, v.size_bytes, v.uploaded, f.current_version_id
       FROM file_versions v JOIN files f ON f.id = v.file_id
      WHERE v.id = ? AND v.file_id = ?`,
    [versionId, fileId]
  );
  const v = rows[0];
  if (!v) throw new Error("Revision not found");
  if (v.current_version_id === versionId) {
    throw new Error(
      "That is the current revision — restore another one first, or delete the file."
    );
  }

  await d1Execute("DELETE FROM file_versions WHERE id = ?", [versionId]);
  if (v.uploaded === 1) {
    await d1Execute(
      "UPDATE files SET version_count = MAX(0, version_count - 1) WHERE id = ?",
      [fileId]
    );
    await bumpUsedBytes(-v.size_bytes);
  }
  return v.r2_key;
}

/** Drop revisions reserved but never confirmed, so they don't leak rows. */
export async function pruneStaleReservations(
  olderThanMs = 86400000
): Promise<void> {
  await d1Execute(
    "DELETE FROM file_versions WHERE uploaded = 0 AND created_at < ?",
    [Date.now() - olderThanMs]
  );
  // A file whose only revision was abandoned has no current version and would
  // otherwise sit invisible forever.
  await d1Execute(
    `DELETE FROM files
      WHERE current_version_id IS NULL
        AND id NOT IN (SELECT DISTINCT file_id FROM file_versions)`
  );
}
