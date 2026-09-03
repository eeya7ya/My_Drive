/**
 * Which drive this deployment is.
 *
 * One codebase serves more than one drive. Each deployment points at its own
 * D1 database and R2 bucket, and `DRIVE_VARIANT` picks the identity the app
 * wears on top of that data: the name in the sidebar, the page title, whether
 * folders are numbered, and whether a "powered by" mark is shown.
 *
 * The variants are presets rather than a dozen separate variables so a second
 * deployment is one environment variable away from the first — nothing else
 * about the setup changes.
 */

export type DriveVariant = "yahya" | "espark";

export interface Brand {
  variant: DriveVariant;
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

const PRESETS: Record<DriveVariant, Brand> = {
  yahya: {
    variant: "yahya",
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
    variant: "espark",
    name: "eSpark",
    tagline: "Drive",
    title: "eSpark Drive",
    shortName: "eSpark",
    description: "eSpark drive: numbered folders, files, and revisions.",
    numbered: true,
    poweredBy: "eSpark",
  },
};

/**
 * Server-side only: reads the environment. Client components receive the
 * result as a prop from the page that renders them.
 */
export function brand(): Brand {
  const raw = (process.env.DRIVE_VARIANT || "yahya").trim().toLowerCase();
  if (raw in PRESETS) return PRESETS[raw as DriveVariant];
  // A typo in the variable should be loud, not silently the default drive.
  throw new Error(
    `DRIVE_VARIANT is "${raw}" but must be one of: ${Object.keys(PRESETS).join(", ")}.`
  );
}

/** What the client falls back to before it has been told otherwise. */
export const DEFAULT_BRAND: Brand = PRESETS.yahya;
