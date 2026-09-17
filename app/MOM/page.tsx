import type { Metadata } from "next";
import MomBuilder from "@/components/MomBuilder";
import "./mom.css";

/**
 * The minutes-of-meeting generator, at /MOM.
 *
 * Deliberately open: it holds nothing from the database and writes nothing to
 * it, so there is nothing here to gate. A minute is typed into the browser,
 * laid out on ADVEC's letterhead, and printed to PDF; it never reaches the
 * server, which is also why nothing a visitor types can leak from one caller
 * to the next.
 *
 * It sits at the site root rather than inside a drive so that "MOM" cannot
 * shadow a folder in one — the same reasoning that put /print there — and the
 * slug is reserved for the same reason. Its stylesheet is imported here rather
 * than globally because it carries an @page rule of its own, which the drive's
 * note printer must not inherit.
 *
 * Temporary, as asked. Nothing else in the app links to it or imports from it,
 * so the route folder, the component and the stylesheet can be deleted in one
 * go when it has served its purpose; only the ADVEC mark in public/assets and
 * the reserved slug would be left behind.
 */
export const metadata: Metadata = {
  title: "Minutes of Meeting — ADVEC",
  description: "Fill in a meeting minute on the ADVEC letterhead and save it as a PDF.",
  // An internal tool on an open address. It should not be indexed, and it has
  // nothing to say to a crawler.
  robots: { index: false, follow: false },
};

export default function MomPage() {
  return <MomBuilder />;
}
