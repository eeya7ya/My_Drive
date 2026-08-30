import Drive from "@/components/Drive";

export const dynamic = "force-dynamic";

/**
 * Deep links: /writing/presentations, /writing/thesis/draft.pdf, and so on.
 *
 * The server renders the same shell for every path — the Drive component
 * resolves the location against the tree it fetches once. That keeps a shared
 * link from costing any more D1 reads than opening the drive normally does.
 */
export default function DrivePathPage() {
  return <Drive defaultTheme="light" defaultView="grid" />;
}
