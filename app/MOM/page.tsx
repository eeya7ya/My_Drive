import type { Metadata } from "next";
import MomBuilder from "@/components/MomBuilder";
import "./mom.css";

/**
 * The minutes-of-meeting generator, at /MOM.
 *
 * Open, by the owner's decision, and now with a table behind it: a minute is
 * typed into the browser, laid out on ADVEC's letterhead, printed to PDF, and
 * saved to D1 so it can be reopened from any machine. Since there is no
 * sign-in, that means anyone who reaches this address can list, open, edit and
 * delete every saved minute. What stands in for a gate is lib/mom.ts, which
 * cuts an incoming save down to a document of known shape and bounded size,
 * and lib/minutes.ts, which rations writes per caller and caps how many
 * minutes may exist at all.
 *
 * It sits at the site root rather than inside a drive so that "MOM" cannot
 * shadow a folder in one — the same reasoning that put /print there — and the
 * slug is reserved for the same reason. Its stylesheet is imported here rather
 * than globally because it carries an @page rule of its own, which the drive's
 * note printer must not inherit.
 *
 * Temporary, as asked. Nothing else in the app links to it or imports from it,
 * so the route folder, the component, the stylesheet, app/api/mom, lib/mom.ts
 * and lib/minutes.ts can be deleted in one go when it has served its purpose;
 * what would be left behind is the ADVEC mark in public/assets, the reserved
 * slug, and a `minutes` table to drop.
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
