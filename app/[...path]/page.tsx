import Drive from "@/components/Drive";
import { driveFor } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * Deep links into the main drive: /writing/presentations,
 * /writing/thesis/draft.pdf, and so on. (/advec/… is matched by the eSpark
 * route first, since a static segment beats a catch-all.)
 *
 * The server renders the same shell for every path — the Drive component
 * resolves the location against the tree it fetches once. That keeps a shared
 * link from costing any more D1 reads than opening the drive normally does.
 */
export default function DrivePathPage() {
  return <Drive defaultTheme="light" defaultView="grid" brand={driveFor("main")} />;
}
