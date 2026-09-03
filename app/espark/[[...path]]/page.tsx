import type { Metadata } from "next";
import Drive from "@/components/Drive";
import { driveFor } from "@/lib/brand";

export const dynamic = "force-dynamic";

const brand = driveFor("espark");

/** The eSpark drive's own tab title, icon and manifest. */
export const metadata: Metadata = {
  title: brand.title,
  description: brand.description,
  manifest: "/espark/manifest.webmanifest",
  appleWebApp: { capable: true, title: brand.shortName, statusBarStyle: "default" },
};

/**
 * The eSpark drive: /espark is its root, /espark/alternator/testing a deep
 * link. It shares nothing with the main drive but the code — every request
 * it makes names its own drive, and the store only returns that drive's rows.
 */
export default function ESparkPage() {
  return <Drive defaultTheme="light" defaultView="grid" brand={brand} />;
}
