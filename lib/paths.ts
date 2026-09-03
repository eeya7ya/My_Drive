/**
 * URL <-> drive-location mapping.
 *
 * A folder's link mirrors its breadcrumb: "My Drive › writing › presentations"
 * is /writing/presentations. A file appends its own name.
 *
 * Resolution runs in the browser against the tree already fetched by
 * /api/drive, so opening a deep link costs no extra D1 reads — the drive is
 * loaded once either way.
 *
 * Trade-off worth knowing: because the path is built from names, renaming a
 * folder changes its link and old links to it stop resolving. Names are what
 * make a link worth sharing, so that is the deliberate choice; the app falls
 * back to My Drive rather than erroring when a path no longer matches.
 */

import { TreeNode } from "./types";

/** "IEC 61850 & GOOSE" -> "iec-61850-goose". Stable, lowercase, URL-safe. */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

/** Split a pathname into decoded, non-empty segments. */
export function segmentsOf(pathname: string): string[] {
  return pathname
    .split("/")
    .map((s) => decodeURIComponent(s).trim())
    .filter(Boolean);
}

export interface Resolved {
  /** Folder ids from root to the deepest folder matched. */
  folderPath: string[];
  /** Id of the file named by the final segment, when one matched. */
  fileId: string | null;
  /** True when every segment resolved; false means we fell back to a prefix. */
  exact: boolean;
}

/**
 * Walk `segments` down the tree. Folders match first; a final segment that
 * matches no folder is tried against the files of the folder reached.
 */
export function resolveSegments(
  tree: TreeNode[],
  rootFiles: { id: string; name: string }[],
  segments: string[]
): Resolved {
  const folderPath: string[] = [];
  let level = tree;
  let files = rootFiles;

  for (let i = 0; i < segments.length; i++) {
    const seg = slugify(segments[i]);
    const folder = level.find((n) => slugify(n.name) === seg);

    if (folder) {
      folderPath.push(folder.id);
      level = folder.children;
      files = folder.files;
      continue;
    }

    // Not a folder — the last segment may name a file in the folder we reached.
    if (i === segments.length - 1) {
      const file = files.find((f) => slugify(f.name) === seg);
      if (file) return { folderPath, fileId: file.id, exact: true };
    }

    // Unresolvable: keep what matched so a stale link still lands nearby.
    return { folderPath, fileId: null, exact: false };
  }

  return { folderPath, fileId: null, exact: true };
}

/**
 * Strip a drive's base path ("/advec") off a pathname, so the remaining
 * segments name folders. A pathname outside the base path is left as-is.
 */
export function stripBasePath(pathname: string, basePath: string): string {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(basePath + "/")) return pathname.slice(basePath.length);
  return pathname;
}

/**
 * Build the href for a folder path (ids), optionally focusing a file.
 * `basePath` is the drive's prefix, "" for the main drive.
 */
export function hrefFor(
  tree: TreeNode[],
  folderPath: string[],
  fileName?: string | null,
  basePath = ""
): string {
  const parts: string[] = [];
  let level = tree;

  for (const id of folderPath) {
    const node: TreeNode | undefined = level.find((n) => n.id === id);
    if (!node) break;
    parts.push(slugify(node.name));
    level = node.children;
  }

  if (fileName) parts.push(slugify(fileName));
  // The drive root is its base path itself ("/advec"), or "/" for the main drive.
  if (!parts.length) return basePath || "/";
  return basePath + "/" + parts.join("/");
}
