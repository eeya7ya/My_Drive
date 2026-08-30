/** Folder/file persistence. Metadata in D1, bytes in R2. */

import { d1Query, d1Execute } from "./d1";
import {
  DriveFile,
  FileRow,
  FolderRow,
  TreeNode,
  formatDate,
  humanSize,
} from "./types";

const DEFAULT_QUOTA = 214748364800; // 200 GB — matches the design's sidebar.

function newId(): string {
  return crypto.randomUUID();
}

function toDriveFile(r: FileRow): DriveFile {
  return {
    id: r.id,
    name: r.name,
    ext: r.ext,
    size: humanSize(r.size_bytes),
    sizeBytes: r.size_bytes,
    modified: formatDate(r.modified_at),
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
}> {
  const [folders, files] = await Promise.all([
    d1Query<FolderRow>(
      "SELECT * FROM folders ORDER BY position ASC, name ASC"
    ),
    d1Query<FileRow>(
      "SELECT * FROM files WHERE uploaded = 1 ORDER BY name ASC"
    ),
  ]);

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

  return { tree, rootFiles };
}

export async function getUsage(): Promise<{
  usedBytes: number;
  quotaBytes: number;
}> {
  const [sumRows, quotaRows] = await Promise.all([
    d1Query<{ total: number | null }>(
      "SELECT SUM(size_bytes) AS total FROM files WHERE uploaded = 1"
    ),
    d1Query<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'quota_bytes'"
    ),
  ]);

  const usedBytes = Number(sumRows[0]?.total ?? 0);
  const quotaBytes = Number(quotaRows[0]?.value ?? DEFAULT_QUOTA);
  return { usedBytes, quotaBytes: quotaBytes || DEFAULT_QUOTA };
}

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
 * Delete a folder and everything under it. Returns the R2 keys of the files
 * that went with it so the caller can clear the objects.
 */
export async function deleteFolder(id: string): Promise<string[]> {
  const ids = await subtreeIds(id);
  if (!ids.length) throw new Error("Folder not found");

  const placeholders = ids.map(() => "?").join(",");

  const keyRows = await d1Query<{ r2_key: string }>(
    `SELECT r2_key FROM files WHERE folder_id IN (${placeholders})`,
    ids
  );

  await d1Execute(`DELETE FROM files WHERE folder_id IN (${placeholders})`, ids);
  await d1Execute(`DELETE FROM folders WHERE id IN (${placeholders})`, ids);

  return keyRows.map((r) => r.r2_key);
}

/**
 * Reserve a file row before the browser uploads to R2. The row stays
 * `uploaded = 0` — invisible to the drive — until the upload is confirmed, so
 * an abandoned upload never shows up as a phantom file.
 */
export async function reserveFile(
  folderId: string | null,
  name: string,
  sizeBytes: number,
  contentType: string
): Promise<{ id: string; r2Key: string }> {
  await assertFolderExists(folderId);

  const clean = name.trim() || "untitled";
  const ext = clean.includes(".")
    ? clean.split(".").pop()!.toLowerCase()
    : "file";

  const id = newId();
  const r2Key = `${folderId ?? "root"}/${id}/${clean}`;
  const now = Date.now();

  await d1Execute(
    `INSERT INTO files (id, folder_id, name, ext, size_bytes, content_type, r2_key, uploaded, created_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, folderId, clean, ext, sizeBytes, contentType, r2Key, now, now]
  );

  return { id, r2Key };
}

export async function confirmFile(id: string): Promise<void> {
  const changed = await d1Execute(
    "UPDATE files SET uploaded = 1, modified_at = ? WHERE id = ?",
    [Date.now(), id]
  );
  if (!changed) throw new Error("File not found");
}

export async function renameFile(id: string, rawName: string): Promise<void> {
  const name = rawName.trim();
  if (!name) throw new Error("File name cannot be empty");
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "file";
  const changed = await d1Execute(
    "UPDATE files SET name = ?, ext = ?, modified_at = ? WHERE id = ?",
    [name, ext, Date.now(), id]
  );
  if (!changed) throw new Error("File not found");
}

export async function getFile(id: string): Promise<FileRow | null> {
  const rows = await d1Query<FileRow>("SELECT * FROM files WHERE id = ?", [id]);
  return rows[0] ?? null;
}

/** Delete a file row; returns its R2 key so the object can be removed too. */
export async function deleteFile(id: string): Promise<string | null> {
  const file = await getFile(id);
  if (!file) return null;
  await d1Execute("DELETE FROM files WHERE id = ?", [id]);
  return file.r2_key;
}

/** Drop uploads reserved but never confirmed, so they don't leak rows. */
export async function pruneStaleReservations(olderThanMs = 86400000): Promise<void> {
  await d1Execute("DELETE FROM files WHERE uploaded = 0 AND created_at < ?", [
    Date.now() - olderThanMs,
  ]);
}
