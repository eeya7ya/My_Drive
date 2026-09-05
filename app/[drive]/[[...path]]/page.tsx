import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Drive from "@/components/Drive";
import UnlockForm from "@/components/UnlockForm";
import { SITE } from "@/lib/brand";
import { canOpenDrive } from "@/lib/auth";
import { legacyRootDrive, resolveDriveSlug } from "@/lib/drives";
import { slugify } from "@/lib/paths";
import { rootEntryNames } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Every drive, at its own address: /yahya, /advec, and whatever the admin adds
 * next. The deep links come through here too — /advec/alternator/testing is
 * this same route with `path` filled in, because the tree is resolved in the
 * browser against the payload /api/drive returns once.
 *
 * The first segment is the interesting one. It has to mean exactly one of four
 * things, and the order matters:
 *
 * A slug a drive answers to now is the drive. A slug it used to answer to is a
 * redirect to the address it answers to today, so a link shared before a rename
 * still lands and no drive is ever served from two URLs. A segment that names
 * one of the legacy root drive's own top-level entries is a link from when that
 * drive sat at "/", and is redirected under its new base path. Anything else is
 * a 404 — which is the whole point of this file, because the route it replaces
 * rendered the main drive for every unmatched address, so /story looked like a
 * real page that happened to be empty.
 *
 * The legacy check is last and costs two small queries, and only on a path that
 * matched no drive at all, so the common case still reads a single row.
 */

type Params = Promise<{ drive: string; path?: string[] }>;

/**
 * generateMetadata and the page body both need the drive, and each runs its own
 * pass over the params. Caching the lookup per request keeps that one registry
 * read rather than two.
 */
const resolve = cache(async (slug: string) => resolveDriveSlug(slug));

/**
 * Rebuild the trailing path exactly as it arrived. Next hands the segments back
 * decoded, so a redirect has to re-encode them or a folder with a space in its
 * name would be sent to a broken address.
 */
function tail(path: string[] | undefined): string {
  if (!path || !path.length) return "";
  return "/" + path.map(encodeURIComponent).join("/");
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { drive } = await params;
  const hit = await resolve(drive);

  // A retired slug is about to be redirected, and a segment that matches
  // nothing is about to 404; neither is worth naming.
  if (!hit || !hit.canonical) return { title: SITE.title };

  const brand = hit.brand;

  // A locked drive discloses nothing — not its name in the tab, not its
  // description to a crawler, and not the manifest that would carry both.
  if (!(await canOpenDrive(brand))) {
    return {
      title: `Private drive — ${SITE.name}`,
      description: "This drive asks for a passcode.",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: brand.title,
    description: brand.description,
    manifest: `${brand.basePath}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: brand.shortName, statusBarStyle: "default" },
  };
}

export default async function DrivePage({ params }: { params: Params }) {
  const { drive, path } = await params;
  const rest = tail(path);

  const hit = await resolve(drive);

  if (hit) {
    if (!hit.canonical) permanentRedirect(hit.brand.basePath + rest);

    // The gate is the whole page. Rendering the drive behind a dialog would
    // have already put the folder names in the HTML.
    if (!(await canOpenDrive(hit.brand))) {
      return <UnlockForm brand={hit.brand} next={hit.brand.basePath + rest} />;
    }

    return <Drive defaultTheme="light" defaultView="grid" brand={hit.brand} />;
  }

  // No drive answers here. It may still be a link from when one of them was
  // served at the site root — /literature/papers/x.pdf — in which case the
  // first segment names one of that drive's own top-level entries.
  const legacy = await legacyRootDrive();
  if (legacy) {
    const wanted = slugify(drive);
    const names = await rootEntryNames(legacy.key);
    if (names.some((name) => slugify(name) === wanted)) {
      permanentRedirect(`${legacy.basePath}/${encodeURIComponent(drive)}${rest}`);
    }
  }

  notFound();
}
