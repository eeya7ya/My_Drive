/** Shapes shared between the API routes and the client. */

export interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  code: string;
  icon: string;
  position: number;
  created_at: number;
  modified_at: number;
}

export interface FileRow {
  id: string;
  folder_id: string | null;
  name: string;
  ext: string;
  size_bytes: number;
  content_type: string;
  r2_key: string;
  uploaded: number;
  created_at: number;
  modified_at: number;
}

/** A folder as the UI consumes it — nested, with its files inline. */
export interface TreeNode {
  id: string;
  name: string;
  code: string;
  icon: string;
  modified: string;
  children: TreeNode[];
  files: DriveFile[];
}

export interface DriveFile {
  id: string;
  name: string;
  ext: string;
  size: string;
  sizeBytes: number;
  modified: string;
}

export interface DrivePayload {
  tree: TreeNode[];
  rootFiles: DriveFile[];
  usedBytes: number;
  quotaBytes: number;
  isAdmin: boolean;
}

/** "Aug 12, 2026" — the format the design shows. */
export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Byte formatting copied from the design's `hsize`. */
export function humanSize(b: number | null | undefined): string {
  if (!b && b !== 0) return "—";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(1) + " GB";
}

/**
 * Same as `humanSize` but without a trailing ".0", so a round quota reads
 * "200 GB" — the wording the design's sidebar shows — instead of "200.0 GB".
 */
export function humanSizeTrim(b: number | null | undefined): string {
  return humanSize(b).replace(/\.0(?= )/, "");
}
