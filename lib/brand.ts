/**
 * The identity a drive wears, and the small amount of it that is safe to hand
 * to the browser.
 *
 * One app, one database, many drives. Every folder and file row carries a
 * `drive` key, every query is scoped by it, and each drive has its own storage
 * counter — so the trees can never mix. What differs per drive is the identity:
 * the name in the sidebar, the tab title, whether folders are numbered, and
 * whether a "powered by" mark is shown.
 *
 * Drives used to be this file's hardcoded record. They are rows now (see
 * lib/drives.ts), so the admin panel can add one without a deploy. What is
 * left here is the shape, the fallback used before D1 is configured, and the
 * pure helpers that need no database.
 */

/** A drive's stable identifier — the value stored in folders.drive. */
export type DriveKey = string;

export type DriveVisibility = "public" | "private";

/**
 * Everything about a drive that a page — including the client bundle — may
 * see. Deliberately not the passcode hash: this object is serialised into the
 * page, so it holds only what a visitor is allowed to know.
 */
export interface Brand {
  /** The value stored in folders.drive and files.drive. Never changes. */
  key: DriveKey;
  /** The single URL segment the drive answers on, with no slashes. */
  slug: string;
  /** URL prefix built from the slug: "/yahya". Never ends in a slash. */
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
  /** "private" drives ask for a passcode before showing anything. */
  visibility: DriveVisibility;
  /** Whether the dashboard names the drive at all. */
  listed: boolean;
  /** Whether a passcode is actually set. A private drive without one is shut. */
  hasPasscode: boolean;
  /**
   * True for the one drive whose folders used to sit at the site root, so
   * /literature/papers can still be redirected to its new address.
   */
  legacyRoot: boolean;
  /** Dashboard order. */
  position: number;
}

/**
 * "Power Systems" -> "power-systems". The same rules as folder slugs, so a
 * drive's address reads like the rest of the URLs the app builds.
 */
export function slugifyDrive(raw: string): string {
  return (
    raw
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "drive"
  );
}

/**
 * Addresses the app answers on itself. A drive may not take one of these as
 * its slug, or it would shadow a real page and become unreachable.
 */
export const RESERVED_SLUGS = new Set([
  "api",
  "admin",
  "assets",
  "_next",
  "static",
  "favicon.ico",
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml",
  "opengraph-image",
  "icon",
  "apple-icon",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/** Build a Brand from a slug and the parts that vary, filling in the rest. */
export function brandFrom(partial: Partial<Brand> & { key: string; slug: string; name: string }): Brand {
  const slug = partial.slug;
  return {
    key: partial.key,
    slug,
    basePath: "/" + slug,
    name: partial.name,
    tagline: partial.tagline ?? "",
    title: partial.title ?? partial.name,
    shortName: partial.shortName ?? partial.name,
    description: partial.description ?? "",
    numbered: partial.numbered ?? false,
    poweredBy: partial.poweredBy ?? null,
    visibility: partial.visibility ?? "public",
    listed: partial.listed ?? true,
    hasPasscode: partial.hasPasscode ?? false,
    legacyRoot: partial.legacyRoot ?? false,
    position: partial.position ?? 0,
  };
}

/**
 * What the app shows before D1 is configured, and what the client falls back
 * to before the server has told it otherwise. These mirror the two rows
 * migration 005 seeds, so a preview without credentials still renders the
 * design rather than an error page.
 */
export const FALLBACK_DRIVES: Brand[] = [
  brandFrom({
    key: "main",
    slug: "yahya",
    name: "YAHYA KHALED",
    tagline: "Power Systems Drive",
    title: "Yahya Khaled — Power Systems Drive",
    shortName: "PS Drive",
    description: "Power systems study drive: folders, files, and admin management.",
    legacyRoot: true,
    position: 0,
  }),
  brandFrom({
    key: "advec",
    slug: "advec",
    name: "eSpark",
    tagline: "Drive",
    title: "eSpark Drive",
    shortName: "eSpark",
    description: "eSpark drive: numbered folders, files, and revisions.",
    numbered: true,
    poweredBy: "eSpark",
    position: 1,
  }),
];

/** The identity the sign-in card and the 404 page wear when no drive is named. */
export const DEFAULT_BRAND: Brand = FALLBACK_DRIVES[0];

/** The site's own name, above any one drive. */
export const SITE = {
  name: "Drive",
  title: "Drives",
  description: "Pick a drive, or ask for access to one.",
} as const;
