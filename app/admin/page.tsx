import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminPanel from "@/components/AdminPanel";
import { SITE } from "@/lib/brand";
import { isAdmin } from "@/lib/auth";
import { listDriveOwners, listDrives, listRequests } from "@/lib/drives";
import { usageForDrives } from "@/lib/store";
import { isD1Configured } from "@/lib/d1";
import type { DriveMember } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The panel is per-session and shows unlisted drives, so it must never be
 * cached or indexed — the drives it names are exactly the ones the dashboard
 * deliberately does not.
 */
export const metadata: Metadata = {
  title: `Admin — ${SITE.name}`,
  robots: { index: false, follow: false },
};

/**
 * The admin panel's front door.
 *
 * Signing in is a redirect rather than a rendered form, so there is one sign-in
 * page for the whole site instead of a second one living here; `next` brings
 * the admin straight back once the password is accepted.
 *
 * Everything the panel shows is read here rather than fetched by it, which is
 * what lets every write in the client end with router.refresh(): the server
 * render is the only copy of the truth, so the panel can never show a list
 * that disagrees with the database.
 *
 * `members` is the second half of what this panel is for — who runs each drive
 * and what it may store. It is assembled here rather than folded into the
 * Brand because a Brand is serialised into every visitor's page and an owner's
 * email address is not a visitor's business.
 */
export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login?next=%2Fadmin");

  const [drives, requests, owners] = await Promise.all([
    listDrives(),
    listRequests(),
    listDriveOwners(),
  ]);

  // A deployment without D1 credentials still renders the panel, with the
  // fallback drives and no numbers, rather than an error page.
  const usage = isD1Configured()
    ? await usageForDrives(drives.map((d) => d.key)).catch(() => null)
    : null;

  const members: DriveMember[] = drives.map((brand) => {
    const owner = owners.get(brand.key);
    const counted = usage?.get(brand.key);
    return {
      key: brand.key,
      name: brand.name,
      slug: brand.slug,
      ownerName: owner?.ownerName ?? "",
      ownerEmail: owner?.ownerEmail ?? "",
      hasOwner: owner?.hasOwner ?? brand.hasOwner,
      usedBytes: counted?.usedBytes ?? 0,
      quotaBytes: counted?.quotaBytes ?? 214748364800,
    };
  });

  return <AdminPanel drives={drives} members={members} requests={requests} />;
}
