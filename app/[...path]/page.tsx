import { redirect } from "next/navigation";
import Drive from "@/components/Drive";
import { driveFor } from "@/lib/brand";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Deep links into the main drive: /writing/presentations,
 * /writing/thesis/draft.pdf, and so on. (/advec/… is matched by the eSpark
 * route first, since a static segment beats a catch-all.)
 *
 * The drive is private, so a visitor is sent to sign in and brought back to
 * the same link afterwards. The server renders the same shell for every
 * path — the Drive component resolves the location against the tree it
 * fetches once, so a shared link costs no more D1 reads than opening the
 * drive normally does.
 */
export default async function DrivePathPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const brand = driveFor("main");
  if (brand.private && !(await isAdmin())) {
    const { path } = await params;
    const here = "/" + path.map(encodeURIComponent).join("/");
    redirect(`/admin/login?next=${encodeURIComponent(here)}`);
  }
  return <Drive defaultTheme="light" defaultView="grid" brand={brand} />;
}
