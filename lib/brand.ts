/**
 * The drives this deployment serves.
 *
 * One app, one database, more than one drive. Every folder and file row
 * carries a `drive` key, every query is scoped by it, and each drive has its
 * own storage counter — so the trees can never mix. A drive is reached at
 * its own path: the main drive at "/", the eSpark drive at "/espark".
 *
 * What differs per drive is the identity it wears: the name in the sidebar,
 * the tab title, whether folders are numbered, and whether a "powered by"
 * mark is shown.
 */

export type DriveKey = "main" | "espark";

export interface Brand {
  /** The value stored in folders.drive and files.drive. */
  key: DriveKey;
  /** URL prefix, "" for the main drive or "/espark". Never ends in a slash. */
  basePath: string;
  /** The large line in the sidebar and on the sign-in card. */
  name: string;
  /** The small letterspaced line beneath it. */
  tagline: string;
  /** Browser tab and PWA name. */
  title: string;
  /** Home-screen name; iOS truncates anything long. */
  shortName: string;
  description: string;
  /**
   * Number folders in outline style — 1, 1.1, 1.2, 2 — in the order they sit
   * in the tree, and show that number wherever a folder is named.
   */
  numbered: boolean;
  /** Text of the mark in the bottom-right corner, or null for none. */
  poweredBy: string | null;
}

export const DRIVES: Record<DriveKey, Brand> = {
  main: {
    key: "main",
    basePath: "",
    name: "YAHYA KHALED",
    tagline: "Power Systems Drive",
    title: "Yahya Khaled — Power Systems Drive",
    shortName: "PS Drive",
    description:
      "Power systems study drive: folders, files, and admin management.",
    numbered: false,
    poweredBy: null,
  },
  espark: {
    key: "espark",
    basePath: "/espark",
    name: "eSpark",
    tagline: "Drive",
    title: "eSpark Drive",
    shortName: "eSpark",
    description: "eSpark drive: numbered folders, files, and revisions.",
    numbered: true,
    poweredBy: "eSpark",
  },
};

export const DRIVE_KEYS = Object.keys(DRIVES) as DriveKey[];

export function isDriveKey(x: unknown): x is DriveKey {
  return typeof x === "string" && x in DRIVES;
}

export function driveFor(key: DriveKey): Brand {
  return DRIVES[key];
}

/**
 * The drive a request is for, from `?drive=` or a `drive` body field. The
 * main drive is the default so older clients keep working; an unknown key is
 * a 400, never a silent fall-through into the wrong tree.
 */
export function parseDrive(raw: unknown): DriveKey {
  if (raw === undefined || raw === null || raw === "") return "main";
  if (isDriveKey(raw)) return raw;
  const err = new Error(`Unknown drive "${String(raw)}"`);
  (err as Error & { status?: number }).status = 400;
  throw err;
}

/** The drive whose basePath a pathname sits under. */
export function driveForPath(pathname: string): Brand {
  for (const b of Object.values(DRIVES)) {
    if (!b.basePath) continue;
    if (pathname === b.basePath || pathname.startsWith(b.basePath + "/")) return b;
  }
  return DRIVES.main;
}

/** What the client falls back to before it has been told otherwise. */
export const DEFAULT_BRAND: Brand = DRIVES.main;
