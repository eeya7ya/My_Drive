/** Shapes shared between the API routes and the client. */

export interface FolderRow {
  id: string;
  parent_id: string | null;
  /** Which drive the row belongs to; see lib/brand.ts. */
  drive: string;
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
  drive: string;
  name: string;
  ext: string;
  current_version_id: string | null;
  version_count: number;
  created_at: number;
  modified_at: number;
}

export interface FileVersionRow {
  id: string;
  file_id: string;
  version: number;
  size_bytes: number;
  content_type: string;
  r2_key: string;
  uploaded: number;
  created_at: number;
  uploaded_at: number | null;
}

/** One row of a file's history, as the version list renders it. */
export interface DriveFileVersion {
  id: string;
  version: number;
  size: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedAtMs: number;
  isCurrent: boolean;
}

/** A folder as the UI consumes it — nested, with its files inline. */
export interface TreeNode {
  id: string;
  name: string;
  code: string;
  icon: string;
  /**
   * Outline number from the folder's place in the tree: "1", "1.1", "1.2",
   * "2". Always computed; a numbered drive shows it, the others ignore it.
   */
  number: string;
  modified: string;
  /** Epoch ms — the client sorts and date-filters on this, never the server. */
  modifiedMs: number;
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
  /** Revision number currently shown. */
  version: number;
  /** How many revisions exist. 1 means no history to expand. */
  versionCount: number;
  /** When the current revision was uploaded, formatted for display. */
  uploadedAt: string;
  /** Epoch ms — the client sorts and date-filters on this, never the server. */
  uploadedAtMs: number;
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

/** "Aug 12, 2026 at 14:32" — a date alone cannot separate two same-day uploads. */
export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} at ${time}`;
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
