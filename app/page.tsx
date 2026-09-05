import type { Metadata } from "next";
import Dashboard from "@/components/Dashboard";
import { SITE } from "@/lib/brand";
import { canOpenDrive, isAdmin } from "@/lib/auth";
import { listDrives } from "@/lib/drives";
import type { DriveCard } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The site's front door. It used to be the main drive itself, which is why
 * every unknown address quietly rendered that drive; "/" now names the drives
 * and lets a visitor open one or ask for access, and each drive answers at its
 * own slug instead.
 */
export const metadata: Metadata = {
  title: SITE.title,
  description: SITE.description,
};

/**
 * A visitor sees the drives the admin chose to list; an admin sees every one,
 * including the unlisted, because the dashboard is also where they are managed
 * from. `unlocked` is resolved here rather than in the client so a private
 * drive's card can say "locked" without the browser ever holding the means to
 * decide that for itself.
 */
export default async function DashboardPage() {
  const admin = await isAdmin();
  const drives = (await listDrives()).filter((d) => d.listed || admin);

  const cards: DriveCard[] = await Promise.all(
    drives.map(async (brand) => ({ ...brand, unlocked: await canOpenDrive(brand) }))
  );

  return <Dashboard drives={cards} isAdmin={admin} />;
}
