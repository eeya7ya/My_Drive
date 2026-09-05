import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminPanel from "@/components/AdminPanel";
import { SITE } from "@/lib/brand";
import { isAdmin } from "@/lib/auth";
import { listDrives, listRequests } from "@/lib/drives";

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
 * Both lists are read here rather than fetched by the panel, which is what lets
 * every write in the client end with router.refresh(): the server render is the
 * only copy of the drive registry, so the panel can never show a list that
 * disagrees with the database.
 */
export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login?next=%2Fadmin");

  const [drives, requests] = await Promise.all([listDrives(), listRequests()]);

  return <AdminPanel drives={drives} requests={requests} />;
}
