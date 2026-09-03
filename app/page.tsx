import Drive from "@/components/Drive";
import { driveFor } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** The main drive, at "/". The eSpark drive lives under app/espark. */
export default function Page() {
  // The canvas exposes these two as design props; same defaults here.
  return <Drive defaultTheme="light" defaultView="grid" brand={driveFor("main")} />;
}
