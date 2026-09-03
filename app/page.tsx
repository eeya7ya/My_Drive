import Drive from "@/components/Drive";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default function Page() {
  // The canvas exposes these two as design props; same defaults here.
  // The brand comes from the environment, so the client never has to guess
  // which drive it is rendering.
  return <Drive defaultTheme="light" defaultView="grid" brand={brand()} />;
}
